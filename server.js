const http = require("http");
const https = require("https");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { appendEventLog } = require("./lib/event-log");
const { rowsFromPayload, summarizeRows, computeLeaderboard, buildSummary } = require("./lib/summary");
const { buildBattleReport } = require("./lib/island-report");
const {
  buildLeaderboardEndpoint,
  LEADERBOARD_ENTRY_LIMIT,
  LEADERBOARD_RANK_ONLY_LIMIT,
} = require("./lib/leaderboard-endpoint");
const {
  corsHeaders: localCorsHeaders,
  requireTrustedOrigin: requireLocalTrustedOrigin,
  sendJson,
} = require("./lib/http-security");
const { createStaticFileHandler } = require("./lib/static-files");
const {
  applyLeaderboardForUpload,
  applyUploadUpstream,
  isCurrentUpload,
  shouldRefreshLeaderboard,
} = require("./lib/upload-state");

const PORT = Number(process.env.OPENTOKEN_ISLAND_PORT || 4174);
const ROOT = __dirname;
const HOME = process.env.HOME || os.homedir();
const CONFIG_PATH = path.join(HOME, ".opentoken", "config.json");
const STATE_PATH = path.join(HOME, ".opentoken", "island-state.json");
const EVENT_LOG_PATH = path.join(HOME, ".opentoken", "island-events.log");
const DEFAULT_UPSTREAM_ORIGIN = "https://scys.com";
const MAX_UPLOAD_BODY_BYTES = 5 * 1024 * 1024;

const LEADERBOARD_MAX_ATTEMPTS = 4;
const LEADERBOARD_RETRY_DELAY_MS = 900;
const PENDING_LEADERBOARD_REFRESH_MS = 60000;
const CONFIRMED_LEADERBOARD_REFRESH_MS = 300000;
const EXPECTED_BINARY_PROBE_ERRORS = new Set(["ENOENT", "EACCES", "EPERM", "ENOTDIR"]);
const serveStatic = createStaticFileHandler(ROOT);

let state = loadState();
let leaderboardRefreshPromise = null;
const OPENTOKEN = process.env.OPENTOKEN_BIN || state.opentokenBin || findOpenTokenBinary() || "opentoken";

function parseJsonFileOrEmpty(filePath, { tolerateCorruption = false, warn = console.warn } = {}) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error; // EACCES and other IO problems are real — surface them
  }
  if (raw.trim() === "") return {}; // empty file (e.g. interrupted write) is not corruption
  try {
    return JSON.parse(raw);
  } catch (error) {
    if (tolerateCorruption) {
      // The state file is a server-owned, rebuildable cache. A truncated write must
      // not brick startup — warn loudly (never silent) and fall back to empty.
      warn(`[server] ignoring corrupt JSON at ${filePath}, using empty state: ${error.message}`);
      return {};
    }
    throw new Error(`Failed to parse JSON at ${filePath}: ${error.message}`);
  }
}

// State is a rebuildable cache → tolerate corruption (warn + reset).
function loadState() {
  return parseJsonFileOrEmpty(STATE_PATH, { tolerateCorruption: true });
}

function findOpenTokenBinary() {
  const candidates = [
    path.join(HOME, ".local", "bin", "opentoken"),
    "/opt/homebrew/bin/opentoken",
    "/usr/local/bin/opentoken",
  ];
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch (error) {
      if (!EXPECTED_BINARY_PROBE_ERRORS.has(error.code)) throw error;
    }
  }
  return "";
}

function saveState() {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  const tempPath = `${STATE_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(state, null, 2) + "\n");
  fs.renameSync(tempPath, STATE_PATH);
}

function logIslandEvent(message, details = {}) {
  appendEventLog(EVENT_LOG_PATH, {
    layer: "server",
    event: message,
    flow: details.flow || "",
    details,
  });
}

function queueIslandEvent(reason = "manual", { showIsland = true } = {}) {
  const previousId = Number(state.islandEvent?.id || 0);
  const event = {
    id: Math.max(Date.now(), previousId + 1),
    createdAt: new Date().toISOString(),
    reason,
    showIsland,
  };
  state.islandEvent = event;
  saveState();
  logIslandEvent("queued island event", event);
  return event;
}

function currentIslandEvent() {
  return state.islandEvent || { id: 0, createdAt: "", reason: "none" };
}

function redactUploadPath(pathname = "") {
  return String(pathname).replace(/(\/tokenrank\/api\/subapp\/u\/)[^/?#]+/, "$1<account>");
}

function logHttpRequest(req, url) {
  if (
    url.pathname === "/api/logs/event"
    || url.pathname === "/api/island-event"
    || url.pathname === "/api/health"
    || (!url.pathname.startsWith("/api/") && !url.pathname.startsWith("/tokenrank/api/subapp/u/"))
  ) {
    return;
  }
  logIslandEvent("http request received", {
    flow: "http.request",
    method: req.method,
    path: redactUploadPath(url.pathname),
    query: url.pathname === "/api/summary" ? { refresh: url.searchParams.get("refresh") === "1" } : {},
  });
}

function readConfig() {
  return parseJsonFileOrEmpty(CONFIG_PATH);
}

function writeConfig(config) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}

function isLocalWebhook(webhook) {
  try {
    const url = new URL(webhook);
    return ["127.0.0.1", "localhost"].includes(url.hostname) && Number(url.port) === PORT;
  } catch {
    return false;
  }
}

function localWebhookFor(upstreamUrl) {
  const upstream = new URL(upstreamUrl);
  return `http://127.0.0.1:${PORT}${upstream.pathname}${upstream.search}`;
}

function upstreamFromLocal(localUrl) {
  const local = new URL(localUrl);
  return `${DEFAULT_UPSTREAM_ORIGIN}${local.pathname}${local.search}`;
}

function ensureProxyConfig() {
  const config = readConfig();
  const current = String(config.webhook_url || "");
  let stateChanged = false;

  if (!state.apiToken) {
    state.apiToken = crypto.randomUUID();
    stateChanged = true;
  }

  if (!state.opentokenBin && OPENTOKEN !== "opentoken") {
    state.opentokenBin = OPENTOKEN;
    stateChanged = true;
  }

  if (current) {
    if (isLocalWebhook(current)) {
      if (!state.upstreamUrl) {
        state.upstreamUrl = upstreamFromLocal(current);
        stateChanged = true;
      }
    } else {
      state.upstreamUrl = current;
      stateChanged = true;
      const localWebhook = localWebhookFor(current);
      if (config.webhook_url !== localWebhook) {
        config.webhook_url = localWebhook;
        writeConfig(config);
      }
    }
  } else if (state.upstreamUrl) {
    config.webhook_url = localWebhookFor(state.upstreamUrl);
    writeConfig(config);
  }

  if (stateChanged) saveState();
  const upstreamUrl = state.upstreamUrl || "";
  return {
    upstreamUrl,
    localWebhookUrl: upstreamUrl ? localWebhookFor(upstreamUrl) : current,
    proxied: Boolean(current && isLocalWebhook(readConfig().webhook_url || current)),
  };
}

function requireTrustedOrigin(req, res) {
  return requireLocalTrustedOrigin(req, res, PORT);
}

function hasValidApiToken(req) {
  ensureProxyConfig();
  return Boolean(state.apiToken)
    && String(req.headers["x-opentoken-island-token"] || "") === String(state.apiToken);
}

function requireApiToken(req, res) {
  if (hasValidApiToken(req)) return true;
  json(req, res, 403, { ok: false, error: "Invalid local client token" });
  return false;
}

function run(cmd, args, timeout = 30000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        code: error && typeof error.code === "number" ? error.code : 0,
        stdout: stdout || "",
        stderr: stderr || "",
        message: error ? error.message : "",
      });
    });
  });
}

function openPath(targetPath) {
  const opener = process.platform === "win32"
    ? { cmd: "cmd", args: ["/C", "start", "", targetPath] }
    : process.platform === "darwin"
      ? { cmd: "open", args: [targetPath] }
      : { cmd: "xdg-open", args: [targetPath] };

  return run(opener.cmd, opener.args, 15000).then((result) => ({
    ok: result.ok,
    output: result.ok ? "opened" : (result.stderr || result.message || "Could not open logs").trim(),
  }));
}

function readBody(req, limit = MAX_UPLOAD_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let tooLarge = false;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > limit) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      if (!tooLarge) chunks.push(chunk);
    });
    req.on("error", reject);
    req.on("end", () => {
      if (tooLarge) {
        const error = new Error("Request body too large");
        error.statusCode = 413;
        reject(error);
        return;
      }
      resolve(Buffer.concat(chunks));
    });
  });
}

function requestText(method, targetUrl, body = "", headers = {}) {
  return new Promise((resolve) => {
    const target = new URL(targetUrl);
    const transport = target.protocol === "https:" ? https : http;
    const requestHeaders = { ...headers };
    if (body && !requestHeaders["content-length"]) {
      requestHeaders["content-length"] = Buffer.byteLength(body);
    }

    const req = transport.request(
      target,
      {
        method,
        headers: requestHeaders,
        timeout: 30000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            headers: res.headers,
            body: text,
            json: safeJson(text),
          });
        });
      }
    );

    req.on("error", (error) => {
      resolve({ ok: false, status: 0, headers: {}, body: "", json: null, error: error.message });
    });
    req.on("timeout", () => {
      req.destroy(new Error("Request timed out"));
    });
    if (body) req.write(body);
    req.end();
  });
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function leaderboardEntries(result) {
  return Array.isArray(result?.json?.entries) ? result.json.entries : [];
}

function confirmedMyRank(myRank, summary) {
  const score = Number(summary?.total || 0);
  const myRankScore = Number(myRank?.score || 0);
  const rank = Number(myRank?.rank || 0);
  if (
    !Number.isFinite(score)
    || !Number.isFinite(myRankScore)
    || !Number.isFinite(rank)
    || score <= 0
    || myRankScore < score
    || rank <= 0
  ) {
    return 0;
  }
  return rank;
}

function leaderboardWindowContainsOwn(entries, ownRank, userId, summary) {
  const confirmedUserId = String(userId || "").trim();
  const score = Number(summary?.total || 0);
  return entries.some((entry) => {
    const entryScore = Number(entry.score || 0);
    const entryRank = Number(entry.rank || 0);
    if (!Number.isFinite(score) || !Number.isFinite(entryScore) || score <= 0 || entryScore < score) return false;
    if (!Number.isFinite(entryRank) || entryRank <= 0) return false;
    const entryUserId = String(entry.userId || "").trim();
    if (confirmedUserId && entryUserId) return entryUserId === confirmedUserId;
    return ownRank > 0 && Number(entry.rank || 0) === ownRank;
  });
}

async function requestLeaderboard(userId, limit) {
  const endpoint = buildLeaderboardEndpoint(userId, { limit });
  return requestText("GET", endpoint, "", { accept: "application/json" });
}

async function refreshLeaderboard(summary, previousRank = null, uploadId = "") {
  let lastResult = null;

  for (let attempt = 0; attempt < LEADERBOARD_MAX_ATTEMPTS; attempt += 1) {
    const confirmedUserId = String(state.userId || "").trim();
    let result = confirmedUserId
      ? await requestLeaderboard(confirmedUserId, LEADERBOARD_RANK_ONLY_LIMIT)
      : null;
    lastResult = result;
    let entries = [];
    let myRank = result?.json?.myRank;
    const ownRank = confirmedMyRank(myRank, summary);

    if (!confirmedUserId || ownRank === 0 || ownRank <= LEADERBOARD_ENTRY_LIMIT) {
      result = await requestLeaderboard(confirmedUserId, LEADERBOARD_ENTRY_LIMIT);
      lastResult = result;
      entries = leaderboardEntries(result);
      const fullMyRank = result.json?.myRank;
      const fullOwnRank = confirmedMyRank(fullMyRank, summary) || ownRank;
      const fullWindowHasOwn = !confirmedUserId
        || leaderboardWindowContainsOwn(entries, fullOwnRank, confirmedUserId, summary);
      if (!entries.length || !fullWindowHasOwn) {
        entries = [];
        myRank = null;
      } else {
        myRank = fullMyRank || (ownRank > 0 ? myRank : null);
      }
    }

    const board = computeLeaderboard(entries, summary, previousRank, state.userId, {
      limit: LEADERBOARD_ENTRY_LIMIT,
      myRank,
      allowHigherMyRankScore: Boolean(confirmedUserId),
      allowHigherUserIdScore: Boolean(confirmedUserId),
    });

    if (board) {
      const leaderboard = { updatedAt: new Date().toISOString(), uploadId, ...board };
      if (!applyLeaderboardForUpload(state, { uploadId, leaderboard })) return null;
      if (board.own.userId) state.userId = board.own.userId;
      saveState();
      return state.leaderboard;
    }

    if (attempt < LEADERBOARD_MAX_ATTEMPTS - 1) await sleep(LEADERBOARD_RETRY_DELAY_MS);
  }

  const leaderboard = {
    updatedAt: new Date().toISOString(),
    board: "total",
    range: "today",
    uploadId,
    entriesCount: leaderboardEntries(lastResult).length,
    error: lastResult?.error || "Current upload was not found in leaderboard yet",
  };
  if (!applyLeaderboardForUpload(state, { uploadId, leaderboard })) return null;
  saveState();
  return state.leaderboard;
}

function markLeaderboardRefreshAttempt(uploadId = "") {
  const checkedAt = new Date().toISOString();
  const current = String(state.leaderboard?.uploadId || "") === String(uploadId || "")
    ? state.leaderboard || {}
    : {};
  const leaderboard = {
    ...current,
    uploadId,
    board: current.board || "total",
    range: current.range || "today",
    lastRefreshAttemptAt: checkedAt,
  };
  if (!applyLeaderboardForUpload(state, { uploadId, leaderboard })) return false;
  saveState();
  return true;
}

function previousRankForUpload(uploadId = "") {
  if (String(state.leaderboard?.uploadId || "") !== String(uploadId || "")) return null;
  const rank = Number(state.leaderboard?.own?.rank || 0);
  return Number.isFinite(rank) && rank > 0 ? rank : null;
}

function scheduleLeaderboardRefresh(upload) {
  if (leaderboardRefreshPromise) return;
  const uploadId = upload.uploadId || "";
  const previousRank = previousRankForUpload(uploadId);
  if (!markLeaderboardRefreshAttempt(uploadId)) return;
  leaderboardRefreshPromise = refreshLeaderboard(upload.summary, previousRank, uploadId)
    .catch((error) => {
      logIslandEvent("leaderboard auto refresh failed", { error: error.message });
    })
    .finally(() => {
      leaderboardRefreshPromise = null;
    });
}

function accountStatus() {
  const proxy = ensureProxyConfig();
  const webhook = proxy.upstreamUrl || "";
  const match = webhook.match(/\/u\/([^/?#]+)/);
  const accountId = match ? match[1] : "";
  return {
    connected: Boolean(webhook),
    proxied: proxy.proxied,
    accountId: accountId ? `${accountId.slice(0, 8)}...${accountId.slice(-6)}` : "",
    host: webhook ? new URL(webhook).host : "",
    localHost: proxy.localWebhookUrl ? new URL(proxy.localWebhookUrl).host : "",
    configPath: CONFIG_PATH,
  };
}

async function handleUploadProxy(req, res, url) {
  if (!requireTrustedOrigin(req, res)) return;
  const proxy = ensureProxyConfig();
  const upstreamUrl = proxy.upstreamUrl || `${DEFAULT_UPSTREAM_ORIGIN}${url.pathname}${url.search}`;
  const redactedPath = redactUploadPath(url.pathname);
  let bodyBuffer;
  try {
    bodyBuffer = await readBody(req);
  } catch (error) {
    return json(req, res, error.statusCode || 400, {
      ok: false,
      error: error.statusCode === 413 ? "Request body too large" : "Could not read request body",
    });
  }
  const body = bodyBuffer.toString("utf8");
  const payload = safeJson(body);
  const summary = summarizeRows(rowsFromPayload(payload));
  const previousRank = previousRankForUpload(state.lastUpload?.uploadId || "");
  const uploadId = crypto.randomUUID();

  const uploadRecord = {
    uploadId,
    capturedAt: new Date().toISOString(),
    path: redactedPath,
    payload,
    summary,
  };
  state.lastUpload = uploadRecord;
  state.leaderboard = null;
  saveState();
  logIslandEvent("captured upload payload", {
    path: redactedPath,
    date: summary.date,
    total: summary.total,
    rowCount: summary.rowCount,
  });
  if (isCurrentUpload(state, uploadId)) {
    queueIslandEvent("upload-captured", { showIsland: false });
  }

  const upstream = await requestText("POST", upstreamUrl, body, {
    "content-type": req.headers["content-type"] || "application/json",
    "accept": req.headers.accept || "application/json",
    "user-agent": req.headers["user-agent"] || "opentoken-island/0.1",
  });

  uploadRecord.upstream = {
    status: upstream.status,
    ok: upstream.ok,
    body: upstream.body,
    json: upstream.json,
    error: upstream.error || "",
  };
  if (applyUploadUpstream(state, { uploadId, uploadRecord })) saveState();
  logIslandEvent("forwarded upload upstream", {
    status: upstream.status,
    ok: upstream.ok,
    accepted: upstream.json?.accepted ?? null,
    error: upstream.error || "",
  });

  if (upstream.ok && summary.total > 0 && isCurrentUpload(state, uploadId)) {
    const leaderboard = await refreshLeaderboard(summary, previousRank, uploadId);
    logIslandEvent("refreshed leaderboard", {
      rank: leaderboard?.own?.rank ?? null,
      estimated: Boolean(leaderboard?.estimated || leaderboard?.own?.estimated),
      gapToPrevious: leaderboard?.gapToPrevious ?? null,
      leadOverNext: leaderboard?.leadOverNext ?? null,
    });

    // 战报不缓存：弹窗触发只看「这次上传是否产生了值得报的变化」。
    // 灵动岛展示时由 buildSummary 用当前榜单实时计算，避免显示陈旧战报（与实时排名脱节）。
    const report = buildBattleReport(leaderboard);
    logIslandEvent("built battle report", { type: report.type, title: report.title });

    // 纯服务端事件驱动：只有「值得报」的战报（非 default）才排队弹窗，
    // 守榜/无变化（default）不打扰用户。弹不弹由这里单点决定，Swift 只管「有新事件就显示」。
    if (report.type !== "default") {
      queueIslandEvent(report.type);
    }
  }

  res.writeHead(upstream.status || 502, {
    "content-type": upstream.headers?.["content-type"] || "application/json; charset=utf-8",
  });
  res.end(upstream.body || JSON.stringify({ status: 1, error: upstream.error || "Upstream upload failed" }));
}

async function handleApi(req, res, url) {
  if (!requireTrustedOrigin(req, res)) return;

  if (url.pathname === "/api/client-config") {
    if (req.method !== "GET") return json(req, res, 405, { ok: false, error: "GET required" });
    ensureProxyConfig();
    return json(req, res, 200, {
      ok: true,
      apiToken: state.apiToken,
    });
  }

  if (url.pathname === "/api/island-event") {
    return json(req, res, 200, { ok: true, event: currentIslandEvent() });
  }

  if (url.pathname === "/api/health") {
    if (req.method !== "GET") return json(req, res, 405, { ok: false, error: "GET required" });
    return json(req, res, 200, { ok: true, name: "opentoken-island" });
  }

  if (url.pathname === "/api/debug/island") {
    if (req.method !== "POST") return json(req, res, 405, { ok: false, error: "POST required" });
    if (!requireApiToken(req, res)) return;
    const reason = url.searchParams.get("reason") || "manual-debug";
    logIslandEvent("debug island requested", { flow: "api.debug.island", reason });
    const event = queueIslandEvent(reason);
    return json(req, res, 200, {
      ok: true,
      event,
      summary: buildSummary({ lastUpload: state.lastUpload, leaderboard: state.leaderboard }),
    });
  }

  if (url.pathname === "/api/summary") {
    const forceRefresh = url.searchParams.get("refresh") === "1";
    if (forceRefresh && !requireApiToken(req, res)) return;
    logIslandEvent("summary requested", { flow: "api.summary", forceRefresh });
    const autoRefresh = shouldRefreshLeaderboard(state, {
      pendingRefreshMs: PENDING_LEADERBOARD_REFRESH_MS,
      confirmedRefreshMs: CONFIRMED_LEADERBOARD_REFRESH_MS,
    });
    if ((forceRefresh || autoRefresh) && state.lastUpload?.summary) {
      const upload = state.lastUpload;
      if (forceRefresh) {
        logIslandEvent("summary refresh started", { flow: "api.summary.refresh", uploadId: upload.uploadId || "" });
        await refreshLeaderboard(upload.summary, previousRankForUpload(upload.uploadId || ""), upload.uploadId || "");
      } else {
        logIslandEvent("summary auto refresh scheduled", { flow: "api.summary.autoRefresh", uploadId: upload.uploadId || "" });
        scheduleLeaderboardRefresh(upload);
      }
    }
    return json(req, res, 200, {
      ...buildSummary({ lastUpload: state.lastUpload, leaderboard: state.leaderboard }),
      account: accountStatus(),
      service: await serviceStatus(),
    });
  }

  if (url.pathname === "/api/upload") {
    if (req.method !== "POST") return json(req, res, 405, { ok: false, error: "POST required" });
    if (!requireApiToken(req, res)) return;
    ensureProxyConfig();
    logIslandEvent("opentoken upload command started", { flow: "api.upload" });
    const result = await run(OPENTOKEN, ["upload"], 120000);
    logIslandEvent("opentoken upload command completed", {
      flow: "api.upload",
      ok: result.ok,
      code: result.code,
      outputLength: (result.stdout || result.stderr || result.message || "").length,
    });
    return json(req, res, result.ok ? 200 : 500, {
      ok: result.ok,
      output: (result.stdout || result.stderr || result.message).trim(),
      summary: buildSummary({ lastUpload: state.lastUpload, leaderboard: state.leaderboard }),
      account: accountStatus(),
      service: await serviceStatus(),
    });
  }

  if (url.pathname === "/api/logs/open") {
    if (req.method !== "POST") return json(req, res, 405, { ok: false, error: "POST required" });
    if (!requireApiToken(req, res)) return;
    logIslandEvent("logs open requested", { flow: "api.logs.open" });
    const result = await openPath(EVENT_LOG_PATH);
    return json(req, res, result.ok ? 200 : 500, result);
  }

  if (url.pathname === "/api/logs/event") {
    if (req.method !== "POST") return json(req, res, 405, { ok: false, error: "POST required" });
    if (!requireApiToken(req, res)) return;
    let payload = null;
    try {
      payload = safeJson((await readBody(req, 64 * 1024)).toString("utf8"));
    } catch (error) {
      logIslandEvent("client event log rejected", { flow: "api.logs.event", error: error.message });
      return json(req, res, error.statusCode || 400, { ok: false, error: "Could not read client event" });
    }
    if (!payload || typeof payload !== "object" || typeof payload.event !== "string") {
      logIslandEvent("client event log rejected", { flow: "api.logs.event", reason: "invalid-payload" });
      return json(req, res, 400, { ok: false, error: "Invalid client event" });
    }
    logIslandEvent(payload.event.slice(0, 120), {
      flow: String(payload.flow || "client.event").slice(0, 120),
      clientLayer: String(payload.layer || "client").slice(0, 80),
      clientDetails: payload.details && typeof payload.details === "object" ? payload.details : {},
    });
    return json(req, res, 200, { ok: true });
  }

  if (url.pathname === "/api/service") {
    return json(req, res, 200, {
      ok: true,
      name: "opentoken-island",
      account: accountStatus(),
      service: await serviceStatus(),
    });
  }

  return json(req, res, 404, { ok: false, error: "Not found" });
}

async function serviceStatus() {
  const result = await run(OPENTOKEN, ["service", "status"], 15000);
  return {
    ok: result.ok,
    text: (result.stdout || result.stderr || result.message).trim(),
    running: /running|loaded|已运行|active/i.test(result.stdout + result.stderr),
  };
}

function json(req, res, status, body) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
    if (
      url.pathname.startsWith("/api/")
      && url.pathname !== "/api/logs/event"
      && url.pathname !== "/api/island-event"
      && url.pathname !== "/api/health"
    ) {
      logIslandEvent("api response sent", {
        flow: "api.response",
        method: req.method,
        path: url.pathname,
        status,
        ok: body?.ok !== false && status < 500,
        error: body?.ok === false ? body.error || "request failed" : "",
      });
    }
  } catch (error) {
    logIslandEvent("api response log failed", { flow: "api.response", error: error.message });
  }
  sendJson(req, res, PORT, status, body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
  logHttpRequest(req, url);

  if (req.method === "OPTIONS") {
    if (!requireTrustedOrigin(req, res)) return;
    res.writeHead(204, localCorsHeaders(req, PORT, {
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type,x-opentoken-island-token",
    }));
    return res.end();
  }

  if (req.method === "POST" && url.pathname.startsWith("/tokenrank/api/subapp/u/")) {
    return handleUploadProxy(req, res, url);
  }
  if (url.pathname.startsWith("/api/")) return handleApi(req, res, url);
  return serveStatic(req, res, url);
});

if (require.main === module) {
  ensureProxyConfig();
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`OpenToken Island proxy running at http://127.0.0.1:${PORT}`);
  });
}

module.exports = { server, findOpenTokenBinary, parseJsonFileOrEmpty };
