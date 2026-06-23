const http = require("http");
const https = require("https");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { rowsFromPayload, summarizeRows, computeLeaderboard, buildSummary } = require("./lib/summary");
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
} = require("./lib/upload-state");

const PORT = Number(process.env.OPENTOKEN_ISLAND_PORT || 4174);
const ROOT = __dirname;
const HOME = process.env.HOME || os.homedir();
const CONFIG_PATH = path.join(HOME, ".opentoken", "config.json");
const STATE_PATH = path.join(HOME, ".opentoken", "island-state.json");
const EVENT_LOG_PATH = path.join(HOME, ".opentoken", "island-events.log");
const DEFAULT_UPSTREAM_ORIGIN = "https://scys.com";
const MAX_UPLOAD_BODY_BYTES = 5 * 1024 * 1024;

const LEADERBOARD_LIMIT = 500;
const LEADERBOARD_MAX_ATTEMPTS = 4;
const LEADERBOARD_RETRY_DELAY_MS = 900;
const serveStatic = createStaticFileHandler(ROOT);

let state = loadState();
const OPENTOKEN = process.env.OPENTOKEN_BIN || state.opentokenBin || findOpenTokenBinary() || "opentoken";

function parseJsonFileOrEmpty(filePath, { tolerateCorruption = false } = {}) {
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
      console.warn(`[server] ignoring corrupt JSON at ${filePath}, using empty state: ${error.message}`);
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
    } catch {}
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
  fs.mkdirSync(path.dirname(EVENT_LOG_PATH), { recursive: true });
  const line = JSON.stringify({
    at: new Date().toISOString(),
    layer: "server",
    message,
    ...details,
  });
  fs.appendFileSync(EVENT_LOG_PATH, `${line}\n`);
}

function queueIslandEvent(reason = "manual") {
  const event = {
    id: Date.now(),
    createdAt: new Date().toISOString(),
    reason,
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

async function refreshLeaderboard(summary, previousRank = null, uploadId = "") {
  const endpoint = `https://scys.com/tokenrank/api/subapp/leaderboard?board=total&range=today&limit=${LEADERBOARD_LIMIT}`;
  let lastResult = null;

  for (let attempt = 0; attempt < LEADERBOARD_MAX_ATTEMPTS; attempt += 1) {
    const result = await requestText("GET", endpoint, "", { accept: "application/json" });
    lastResult = result;
    const entries = Array.isArray(result.json?.entries) ? result.json.entries : [];
    const board = computeLeaderboard(entries, summary, previousRank, state.userId);

    if (board) {
      const leaderboard = { updatedAt: new Date().toISOString(), ...board };
      if (!applyLeaderboardForUpload(state, { uploadId, leaderboard })) return null;
      state.userId = board.own.userId;
      saveState();
      return state.leaderboard;
    }

    if (attempt < LEADERBOARD_MAX_ATTEMPTS - 1) await sleep(LEADERBOARD_RETRY_DELAY_MS);
  }

  const leaderboard = {
    updatedAt: new Date().toISOString(),
    board: "total",
    range: "today",
    entriesCount: Array.isArray(lastResult?.json?.entries) ? lastResult.json.entries.length : 0,
    error: lastResult?.error || "Current upload was not found in leaderboard yet",
  };
  if (!applyLeaderboardForUpload(state, { uploadId, leaderboard })) return null;
  saveState();
  return state.leaderboard;
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
  const previousRank = state.leaderboard?.own?.rank ? Number(state.leaderboard.own.rank) : null;
  const uploadId = crypto.randomUUID();

  const uploadRecord = {
    uploadId,
    capturedAt: new Date().toISOString(),
    path: redactedPath,
    payload,
    summary,
  };
  state.lastUpload = uploadRecord;
  saveState();
  logIslandEvent("captured upload payload", {
    path: redactedPath,
    date: summary.date,
    total: summary.total,
    rowCount: summary.rowCount,
  });

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
  });

  if (upstream.ok && summary.total > 0 && isCurrentUpload(state, uploadId)) {
    const leaderboard = await refreshLeaderboard(summary, previousRank, uploadId);
    logIslandEvent("refreshed leaderboard", {
      rank: leaderboard?.own?.rank ?? null,
      gapToPrevious: leaderboard?.gapToPrevious ?? null,
      leadOverNext: leaderboard?.leadOverNext ?? null,
    });
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
    const event = queueIslandEvent(reason);
    return json(req, res, 200, {
      ok: true,
      event,
      summary: buildSummary({ lastUpload: state.lastUpload, leaderboard: state.leaderboard }),
    });
  }

  if (url.pathname === "/api/summary") {
    if (url.searchParams.get("refresh") === "1" && state.lastUpload?.summary) {
      if (!requireApiToken(req, res)) return;
      const upload = state.lastUpload;
      await refreshLeaderboard(upload.summary, state.leaderboard?.own?.rank || null, upload.uploadId || "");
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
    const result = await run(OPENTOKEN, ["upload"], 120000);
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
    const result = await openPath(EVENT_LOG_PATH);
    return json(req, res, result.ok ? 200 : 500, result);
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
  sendJson(req, res, PORT, status, body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);

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

module.exports = { server, parseJsonFileOrEmpty };
