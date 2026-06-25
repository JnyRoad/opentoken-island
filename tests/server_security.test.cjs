const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..");

function tempDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `opentoken-island-${name}-`));
}

function copyRuntimeRoot(parent) {
  const runtimeRoot = path.join(parent, "opentoken-island");
  fs.mkdirSync(runtimeRoot, { recursive: true });
  fs.copyFileSync(path.join(repoRoot, "server.js"), path.join(runtimeRoot, "server.js"));
  fs.cpSync(path.join(repoRoot, "lib"), path.join(runtimeRoot, "lib"), { recursive: true });
  fs.cpSync(path.join(repoRoot, "assets"), path.join(runtimeRoot, "assets"), { recursive: true });
  fs.copyFileSync(path.join(repoRoot, "popover.html"), path.join(runtimeRoot, "popover.html"));
  fs.copyFileSync(path.join(repoRoot, "island.html"), path.join(runtimeRoot, "island.html"));
  fs.copyFileSync(path.join(repoRoot, "index.html"), path.join(runtimeRoot, "index.html"));
  return runtimeRoot;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

function request(port, options = {}) {
  const body = options.body || "";
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: options.path || "/",
        method: options.method || "GET",
        headers: {
          ...(body ? { "content-length": Buffer.byteLength(body) } : {}),
          ...(options.headers || {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      }
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function waitForServer(port) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < 4000) {
    try {
      const response = await request(port, { path: "/" });
      if (response.status < 500) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw lastError || new Error(`server did not start on ${port}`);
}

async function waitUntil(predicate, timeoutMs = 1000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("condition was not met in time");
}

async function startIslandServer(t, options = {}) {
  const parent = tempDir("runtime");
  const root = copyRuntimeRoot(parent);
  const home = options.home || tempDir("home");
  fs.mkdirSync(path.join(home, ".opentoken"), { recursive: true });
  const port = options.port || await freePort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: {
      ...process.env,
      ...(options.env || {}),
      HOME: home,
      OPENTOKEN_ISLAND_PORT: String(port),
      OPENTOKEN_BIN: options.opentokenBin || process.execPath,
      OPENTOKEN_MARKER: options.opentokenMarker || "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => child.kill());
  await waitForServer(port);
  return { root, home, port, child };
}

async function startFakeUpstream(t) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      let payload;
      try {
        payload = JSON.parse(text || "{}");
      } catch {
        res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "invalid json" }));
        return;
      }
      requests.push(payload);
      const delay = payload.requestId === "A" ? 160 : 10;
      setTimeout(() => {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ accepted: 1, requestId: payload.requestId }));
      }, delay);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  return { port: server.address().port, requests };
}

async function startFakeLeaderboard(t, { delayMs = 0, entries = [], myRank = null, responseForRequest = null } = {}) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);
    requests.push({
      method: req.method,
      url: req.url,
      limit: requestUrl.searchParams.get("limit"),
      me: requestUrl.searchParams.get("me"),
    });
    setTimeout(() => {
      const payload = responseForRequest
        ? responseForRequest(requestUrl)
        : { entries, ...(myRank ? { myRank } : {}) };
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(payload));
    }, delayMs);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  return {
    port: server.address().port,
    requests,
    url: `http://127.0.0.1:${server.address().port}/tokenrank/api/subapp/leaderboard?board=total&range=today&limit=500`,
  };
}

test("health endpoint identifies island without running opentoken service status", async (t) => {
  const home = tempDir("home");
  const marker = path.join(home, "opentoken-ran");
  const fakeOpenToken = path.join(home, "fake-opentoken.js");
  fs.writeFileSync(
    fakeOpenToken,
    `#!/usr/bin/env node\nrequire("fs").writeFileSync(process.env.OPENTOKEN_MARKER, process.argv.slice(2).join(" "));\n`
  );
  fs.chmodSync(fakeOpenToken, 0o755);
  const { port } = await startIslandServer(t, { home, opentokenBin: fakeOpenToken, opentokenMarker: marker });

  const response = await request(port, { path: "/api/health" });
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), { ok: true, name: "opentoken-island" });
  assert.equal(fs.existsSync(marker), false);
});

test("static file server rejects same-prefix path traversal", async (t) => {
  const parent = tempDir("static");
  const root = copyRuntimeRoot(parent);
  const sibling = `${root}-secret`;
  fs.mkdirSync(sibling, { recursive: true });
  fs.writeFileSync(path.join(sibling, "probe.txt"), "do-not-serve");

  const port = await freePort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: { ...process.env, HOME: tempDir("home"), OPENTOKEN_ISLAND_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => child.kill());
  await waitForServer(port);

  const response = await request(port, { path: "/%2e%2e%2fopentoken-island-secret%2fprobe.txt" });
  assert.notEqual(response.status, 200);
  assert.doesNotMatch(response.body, /do-not-serve/);
});

test("static file server rejects NUL paths without crashing", async (t) => {
  const { port, child } = await startIslandServer(t);

  const response = await request(port, { path: "/%00" });
  assert.equal(response.status, 400);
  assert.equal(child.exitCode, null);

  const health = await request(port, { path: "/api/health" });
  assert.equal(health.status, 200);
});

test("cross-origin API upload is rejected before running opentoken", async (t) => {
  const home = tempDir("home");
  const marker = path.join(home, "opentoken-ran");
  const fakeOpenToken = path.join(home, "fake-opentoken.js");
  fs.writeFileSync(
    fakeOpenToken,
    `#!/usr/bin/env node\nif (process.argv[2] === "upload") require("fs").writeFileSync(process.env.OPENTOKEN_MARKER, "ran");\n`
  );
  fs.chmodSync(fakeOpenToken, 0o755);
  const { port } = await startIslandServer(t, { home, opentokenBin: fakeOpenToken, opentokenMarker: marker });

  const response = await request(port, {
    path: "/api/upload",
    method: "POST",
    headers: { origin: "https://evil.example" },
  });
  assert.equal(response.status, 403);
  assert.equal(fs.existsSync(marker), false);
});

test("state-changing API commands require the local client token", async (t) => {
  const home = tempDir("home");
  const marker = path.join(home, "opentoken-ran");
  const fakeOpenToken = path.join(home, "fake-opentoken.js");
  fs.writeFileSync(
    fakeOpenToken,
    `#!/usr/bin/env node\nif (process.argv[2] === "upload") require("fs").writeFileSync(process.env.OPENTOKEN_MARKER, "ran");\nconsole.log("uploaded");\n`
  );
  fs.chmodSync(fakeOpenToken, 0o755);
  const { port } = await startIslandServer(t, { home, opentokenBin: fakeOpenToken, opentokenMarker: marker });

  const denied = await request(port, { path: "/api/upload", method: "POST" });
  assert.equal(denied.status, 403);
  assert.equal(fs.existsSync(marker), false);

  const config = await request(port, { path: "/api/client-config" });
  const { apiToken } = JSON.parse(config.body);
  assert.match(apiToken, /^[a-f0-9-]{16,}$/i);

  const allowed = await request(port, {
    path: "/api/upload",
    method: "POST",
    headers: { "x-opentoken-island-token": apiToken },
  });
  assert.equal(allowed.status, 200);
  assert.equal(fs.readFileSync(marker, "utf8"), "ran");
});

test("client event logs require token and redact sensitive fields", async (t) => {
  const home = tempDir("home");
  const { port } = await startIslandServer(t, { home });

  const denied = await request(port, {
    path: "/api/logs/event",
    method: "POST",
    body: JSON.stringify({ event: "popover.upload.click" }),
    headers: { "content-type": "application/json" },
  });
  assert.equal(denied.status, 403);

  const config = await request(port, { path: "/api/client-config" });
  const { apiToken } = JSON.parse(config.body);
  const allowed = await request(port, {
    path: "/api/logs/event",
    method: "POST",
    body: JSON.stringify({
      layer: "popover",
      event: "popover.upload.click",
      flow: "popover.upload.click",
      details: {
        token: "secret-token",
        path: "/tokenrank/api/subapp/u/account-1234567890?debug=1",
        payload: { rows: [{ input: 10 }] },
      },
    }),
    headers: {
      "content-type": "application/json",
      "x-opentoken-island-token": apiToken,
    },
  });
  assert.equal(allowed.status, 200);

  const logPath = path.join(home, ".opentoken", "island-events.log");
  await waitUntil(() => fs.existsSync(logPath));
  const entries = fs.readFileSync(logPath, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const clientEntry = entries.find((entry) => entry.event === "popover.upload.click");

  assert.ok(clientEntry);
  assert.equal(clientEntry.details.token, "<redacted>");
  assert.equal(clientEntry.details.path, "/tokenrank/api/subapp/u/<account>?debug=1");
  assert.equal(clientEntry.details.payload, "<omitted>");
});

test("broken event log file does not break local API responses", async (t) => {
  const home = tempDir("home");
  const { port } = await startIslandServer(t, { home });
  const logPath = path.join(home, ".opentoken", "island-events.log");
  fs.rmSync(logPath, { force: true, recursive: true });
  fs.mkdirSync(logPath, { recursive: true });

  const response = await request(port, { path: "/api/client-config" });
  assert.equal(response.status, 200);
  assert.match(JSON.parse(response.body).apiToken, /^[a-f0-9-]{16,}$/i);
});

test("manual summary refresh requires the local client token before the first upload", async (t) => {
  const home = tempDir("home");
  const { port } = await startIslandServer(t, { home });

  const denied = await request(port, { path: "/api/summary?refresh=1" });
  assert.equal(denied.status, 403);

  const config = await request(port, { path: "/api/client-config" });
  const { apiToken } = JSON.parse(config.body);

  const allowed = await request(port, {
    path: "/api/summary?refresh=1",
    headers: { "x-opentoken-island-token": apiToken },
  });
  assert.equal(allowed.status, 200);
  assert.equal(JSON.parse(allowed.body).waiting, true);
});

test("manual summary refresh ignores stale previous rank from another upload", async (t) => {
  const leaderboard = await startFakeLeaderboard(t, {
    entries: [
      { userId: "me", rank: 3, score: 10, byTool: { codex: 10 } },
    ],
  });
  const home = tempDir("home");
  const configDir = path.join(home, ".opentoken");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, "island-state.json"),
    JSON.stringify({
      lastUpload: {
        uploadId: "current-upload",
        capturedAt: "2026-06-24T03:10:00.000Z",
        summary: {
          date: "2026-06-24",
          total: 10,
          normalized: 10,
          byTool: { codex: 10 },
          normalizedByTool: { codex: 10 },
        },
        upstream: { ok: true, status: 200, json: { accepted: 1 } },
      },
      leaderboard: {
        uploadId: "old-upload",
        updatedAt: "2026-06-24T03:00:00.000Z",
        own: { userId: "me", rank: 9, score: 100, byTool: { codex: 100 } },
      },
    })
  );
  const { port } = await startIslandServer(t, {
    home,
    env: { OPENTOKEN_LEADERBOARD_URL: leaderboard.url },
  });
  const config = await request(port, { path: "/api/client-config" });
  const { apiToken } = JSON.parse(config.body);

  const response = await request(port, {
    path: "/api/summary?refresh=1",
    headers: { "x-opentoken-island-token": apiToken },
  });
  const summary = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assert.equal(summary.rank, 3);
  assert.equal(summary.rankDelta, 0);
});

test("manual summary refresh without user id keeps the public leaderboard lookup", async (t) => {
  const leaderboard = await startFakeLeaderboard(t, {
    entries: [
      { userId: "me", rank: 3, score: 10, byTool: { codex: 10 } },
    ],
  });
  const home = tempDir("home");
  const configDir = path.join(home, ".opentoken");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, "island-state.json"),
    JSON.stringify({
      lastUpload: {
        uploadId: "current-upload",
        capturedAt: "2026-06-24T03:10:00.000Z",
        summary: {
          date: "2026-06-24",
          total: 10,
          normalized: 10,
          byTool: { codex: 10 },
          normalizedByTool: { codex: 10 },
        },
        upstream: { ok: true, status: 200, json: { accepted: 1 } },
      },
    })
  );
  const { port } = await startIslandServer(t, {
    home,
    env: { OPENTOKEN_LEADERBOARD_URL: leaderboard.url },
  });
  const config = await request(port, { path: "/api/client-config" });
  const { apiToken } = JSON.parse(config.body);

  const response = await request(port, {
    path: "/api/summary?refresh=1",
    headers: { "x-opentoken-island-token": apiToken },
  });
  const summary = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assert.equal(leaderboard.requests.length, 1);
  assert.equal(leaderboard.requests[0].limit, "200");
  assert.equal(leaderboard.requests[0].me, null);
  assert.equal(summary.rank, 3);
});

test("manual summary refresh uses rank-only lookup when own rank is outside fetched entries", async (t) => {
  const leaderboard = await startFakeLeaderboard(t, {
    responseForRequest: () => ({
      entries: [{ userId: "leader", rank: 1, score: 1000, byTool: { codex: 1000 } }],
      myRank: { rank: 900, score: 100 },
    }),
  });
  const home = tempDir("home");
  const configDir = path.join(home, ".opentoken");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, "island-state.json"),
    JSON.stringify({
      userId: "member-900",
      lastUpload: {
        uploadId: "current-upload",
        capturedAt: "2026-06-24T03:10:00.000Z",
        summary: {
          date: "2026-06-24",
          total: 100,
          normalized: 100,
          byTool: { codex: 100 },
          normalizedByTool: { codex: 100 },
        },
        upstream: { ok: true, status: 200, json: { accepted: 1 } },
      },
    })
  );
  const { port } = await startIslandServer(t, {
    home,
    env: { OPENTOKEN_LEADERBOARD_URL: leaderboard.url },
  });
  const config = await request(port, { path: "/api/client-config" });
  const { apiToken } = JSON.parse(config.body);

  const response = await request(port, {
    path: "/api/summary?refresh=1",
    headers: { "x-opentoken-island-token": apiToken },
  });
  const summary = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assert.equal(leaderboard.requests.length, 1);
  assert.equal(leaderboard.requests[0].limit, "1");
  assert.equal(leaderboard.requests[0].me, "member-900");
  assert.equal(summary.rank, 900);
  assert.equal(summary.rankEstimated, false);
  assert.equal(summary.gapToPreviousLabel, "--");
  assert.equal(summary.leadOverNextLabel, "--");
});

test("manual summary refresh fetches neighbors when own rank is inside fetched entries", async (t) => {
  const leaderboard = await startFakeLeaderboard(t, {
    responseForRequest: (requestUrl) => {
      if (requestUrl.searchParams.get("limit") === "1") {
        return {
          entries: [{ userId: "leader", rank: 1, score: 1000, byTool: { codex: 1000 } }],
          myRank: { rank: 114, score: 100 },
        };
      }
      return {
        entries: [
          { userId: "member-113", rank: 113, score: 120, byTool: { codex: 120 } },
          { userId: "member-114", rank: 114, score: 100, byTool: { codex: 100 } },
          { userId: "member-115", rank: 115, score: 90, byTool: { codex: 90 } },
        ],
        myRank: { rank: 114, score: 100 },
      };
    },
  });
  const home = tempDir("home");
  const configDir = path.join(home, ".opentoken");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, "island-state.json"),
    JSON.stringify({
      userId: "member-114",
      lastUpload: {
        uploadId: "current-upload",
        capturedAt: "2026-06-24T03:10:00.000Z",
        summary: {
          date: "2026-06-24",
          total: 100,
          normalized: 100,
          byTool: { codex: 100 },
          normalizedByTool: { codex: 100 },
        },
        upstream: { ok: true, status: 200, json: { accepted: 1 } },
      },
    })
  );
  const { port } = await startIslandServer(t, {
    home,
    env: { OPENTOKEN_LEADERBOARD_URL: leaderboard.url },
  });
  const config = await request(port, { path: "/api/client-config" });
  const { apiToken } = JSON.parse(config.body);

  const response = await request(port, {
    path: "/api/summary?refresh=1",
    headers: { "x-opentoken-island-token": apiToken },
  });
  const summary = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assert.deepEqual(leaderboard.requests.map((entry) => entry.limit), ["1", "200"]);
  assert.deepEqual(leaderboard.requests.map((entry) => entry.me), ["member-114", "member-114"]);
  assert.equal(summary.rank, 114);
  assert.equal(summary.gapToPrevious, 21);
  assert.equal(summary.leadOverNext, 10);
});

test("manual summary refresh falls back to fetched entries when rank-only score is stale", async (t) => {
  const leaderboard = await startFakeLeaderboard(t, {
    responseForRequest: (requestUrl) => {
      if (requestUrl.searchParams.get("limit") === "1") {
        return {
          entries: [{ userId: "leader", rank: 1, score: 1000, byTool: { codex: 1000 } }],
          myRank: { rank: 900, score: 80 },
        };
      }
      return {
        entries: [
          { userId: "member-49", rank: 49, score: 130, byTool: { codex: 130 } },
          { userId: "member-50", rank: 50, score: 100, byTool: { codex: 100 } },
          { userId: "member-51", rank: 51, score: 90, byTool: { codex: 90 } },
        ],
        myRank: { rank: 900, score: 80 },
      };
    },
  });
  const home = tempDir("home");
  const configDir = path.join(home, ".opentoken");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, "island-state.json"),
    JSON.stringify({
      userId: "member-50",
      lastUpload: {
        uploadId: "current-upload",
        capturedAt: "2026-06-24T03:10:00.000Z",
        summary: {
          date: "2026-06-24",
          total: 100,
          normalized: 100,
          byTool: { codex: 100 },
          normalizedByTool: { codex: 100 },
        },
        upstream: { ok: true, status: 200, json: { accepted: 1 } },
      },
    })
  );
  const { port } = await startIslandServer(t, {
    home,
    env: { OPENTOKEN_LEADERBOARD_URL: leaderboard.url },
  });
  const config = await request(port, { path: "/api/client-config" });
  const { apiToken } = JSON.parse(config.body);

  const response = await request(port, {
    path: "/api/summary?refresh=1",
    headers: { "x-opentoken-island-token": apiToken },
  });
  const summary = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assert.deepEqual(leaderboard.requests.map((entry) => entry.limit), ["1", "200"]);
  assert.equal(summary.rank, 50);
  assert.equal(summary.gapToPrevious, 31);
  assert.equal(summary.leadOverNext, 10);
});

test("manual summary refresh trusts higher upstream own score from me lookup", async (t) => {
  const leaderboard = await startFakeLeaderboard(t, {
    responseForRequest: (requestUrl) => {
      if (requestUrl.searchParams.get("limit") === "1") {
        return {
          entries: [{ userId: "leader", rank: 1, score: 1000, byTool: { codex: 1000 } }],
          myRank: { rank: 95, score: 120 },
        };
      }
      return {
        entries: [
          { userId: "member-94", rank: 94, score: 130, byTool: { codex: 130 } },
          { userId: "member-95", rank: 95, score: 120, byTool: { codex: 100, "claude-code": 20 } },
          { userId: "member-96", rank: 96, score: 110, byTool: { codex: 110 } },
        ],
        myRank: { rank: 95, score: 120 },
      };
    },
  });
  const home = tempDir("home");
  const configDir = path.join(home, ".opentoken");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, "island-state.json"),
    JSON.stringify({
      userId: "member-95",
      lastUpload: {
        uploadId: "current-upload",
        capturedAt: "2026-06-24T03:10:00.000Z",
        summary: {
          date: "2026-06-24",
          total: 100,
          normalized: 100,
          byTool: { codex: 100 },
          normalizedByTool: { codex: 100 },
        },
        upstream: { ok: true, status: 200, json: { accepted: 1 } },
      },
    })
  );
  const { port } = await startIslandServer(t, {
    home,
    env: { OPENTOKEN_LEADERBOARD_URL: leaderboard.url },
  });
  const config = await request(port, { path: "/api/client-config" });
  const { apiToken } = JSON.parse(config.body);

  const response = await request(port, {
    path: "/api/summary?refresh=1",
    headers: { "x-opentoken-island-token": apiToken },
  });
  const summary = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assert.deepEqual(leaderboard.requests.map((entry) => entry.limit), ["1", "200"]);
  assert.equal(summary.rank, 95);
  assert.equal(summary.leaderboardScore, 120);
  assert.equal(summary.gapToPrevious, 11);
  assert.equal(summary.leadOverNext, 10);
});

test("manual summary refresh trusts higher upstream own score from a user-matched full window entry", async (t) => {
  const leaderboard = await startFakeLeaderboard(t, {
    responseForRequest: (requestUrl) => {
      if (requestUrl.searchParams.get("limit") === "1") {
        return {
          entries: [{ userId: "leader", rank: 1, score: 1000, byTool: { codex: 1000 } }],
        };
      }
      return {
        entries: [
          { userId: "member-94", rank: 94, score: 130, byTool: { codex: 130 } },
          { userId: "member-95", rank: 95, score: 120, byTool: { codex: 100, "claude-code": 20 } },
          { userId: "member-96", rank: 96, score: 110, byTool: { codex: 110 } },
        ],
      };
    },
  });
  const home = tempDir("home");
  const configDir = path.join(home, ".opentoken");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, "island-state.json"),
    JSON.stringify({
      userId: "member-95",
      lastUpload: {
        uploadId: "current-upload",
        capturedAt: "2026-06-24T03:10:00.000Z",
        summary: {
          date: "2026-06-24",
          total: 100,
          normalized: 100,
          byTool: { codex: 100 },
          normalizedByTool: { codex: 100 },
        },
        upstream: { ok: true, status: 200, json: { accepted: 1 } },
      },
    })
  );
  const { port } = await startIslandServer(t, {
    home,
    env: { OPENTOKEN_LEADERBOARD_URL: leaderboard.url },
  });
  const config = await request(port, { path: "/api/client-config" });
  const { apiToken } = JSON.parse(config.body);

  const response = await request(port, {
    path: "/api/summary?refresh=1",
    headers: { "x-opentoken-island-token": apiToken },
  });
  const summary = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assert.deepEqual(leaderboard.requests.map((entry) => entry.limit), ["1", "200"]);
  assert.equal(summary.rank, 95);
  assert.equal(summary.leaderboardScore, 120);
  assert.equal(summary.gapToPrevious, 11);
  assert.equal(summary.leadOverNext, 10);
});

test("manual summary refresh does not fall back to another same-score member after higher user match", async (t) => {
  const leaderboard = await startFakeLeaderboard(t, {
    responseForRequest: (requestUrl) => {
      if (requestUrl.searchParams.get("limit") === "1") {
        return {
          entries: [{ userId: "leader", rank: 1, score: 1000, byTool: { codex: 1000 } }],
        };
      }
      return {
        entries: [
          { userId: "other-same-score", rank: 50, score: 100, byTool: { codex: 100 } },
          { userId: "member-95", rank: 95, score: 120, byTool: { codex: 120 } },
          { userId: "member-96", rank: 96, score: 110, byTool: { codex: 110 } },
        ],
      };
    },
  });
  const home = tempDir("home");
  const configDir = path.join(home, ".opentoken");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, "island-state.json"),
    JSON.stringify({
      userId: "member-95",
      lastUpload: {
        uploadId: "current-upload",
        capturedAt: "2026-06-24T03:10:00.000Z",
        summary: {
          date: "2026-06-24",
          total: 100,
          normalized: 100,
          byTool: { codex: 100 },
          normalizedByTool: { codex: 100 },
        },
        upstream: { ok: true, status: 200, json: { accepted: 1 } },
      },
    })
  );
  const { port } = await startIslandServer(t, {
    home,
    env: { OPENTOKEN_LEADERBOARD_URL: leaderboard.url },
  });
  const config = await request(port, { path: "/api/client-config" });
  const { apiToken } = JSON.parse(config.body);

  const response = await request(port, {
    path: "/api/summary?refresh=1",
    headers: { "x-opentoken-island-token": apiToken },
  });
  const summary = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assert.deepEqual(leaderboard.requests.map((entry) => entry.limit), ["1", "200"]);
  assert.equal(summary.rank, 95);
  assert.equal(summary.leaderboardScore, 120);
});

test("manual summary refresh rejects non-finite upstream own scores", async (t) => {
  let fullRequests = 0;
  const leaderboard = await startFakeLeaderboard(t, {
    responseForRequest: (requestUrl) => {
      if (requestUrl.searchParams.get("limit") === "1") {
        return {
          entries: [{ userId: "leader", rank: 1, score: 1000, byTool: { codex: 1000 } }],
          myRank: { rank: 95, score: Infinity },
        };
      }
      fullRequests += 1;
      if (fullRequests === 1) {
        return {
          entries: [
            { userId: "member-94", rank: 94, score: 130, byTool: { codex: 130 } },
            { userId: "member-95", rank: 95, score: Infinity, byTool: { codex: 100, "claude-code": 20 } },
            { userId: "member-96", rank: 96, score: 110, byTool: { codex: 110 } },
          ],
        };
      }
      return {
        entries: [
          { userId: "member-94", rank: 94, score: 130, byTool: { codex: 130 } },
          { userId: "member-95", rank: 95, score: 120, byTool: { codex: 100, "claude-code": 20 } },
          { userId: "member-96", rank: 96, score: 110, byTool: { codex: 110 } },
        ],
      };
    },
  });
  const home = tempDir("home");
  const configDir = path.join(home, ".opentoken");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, "island-state.json"),
    JSON.stringify({
      userId: "member-95",
      lastUpload: {
        uploadId: "current-upload",
        capturedAt: "2026-06-24T03:10:00.000Z",
        summary: {
          date: "2026-06-24",
          total: 100,
          normalized: 100,
          byTool: { codex: 100 },
          normalizedByTool: { codex: 100 },
        },
        upstream: { ok: true, status: 200, json: { accepted: 1 } },
      },
    })
  );
  const { port } = await startIslandServer(t, {
    home,
    env: { OPENTOKEN_LEADERBOARD_URL: leaderboard.url },
  });
  const config = await request(port, { path: "/api/client-config" });
  const { apiToken } = JSON.parse(config.body);

  const response = await request(port, {
    path: "/api/summary?refresh=1",
    headers: { "x-opentoken-island-token": apiToken },
  });
  const summary = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assert.deepEqual(leaderboard.requests.map((entry) => entry.limit), ["1", "200", "1", "200"]);
  assert.equal(summary.rank, 95);
  assert.equal(summary.leaderboardScore, 120);
});

test("manual summary refresh rejects non-finite upstream own ranks", async (t) => {
  let fullRequests = 0;
  const leaderboard = await startFakeLeaderboard(t, {
    responseForRequest: (requestUrl) => {
      if (requestUrl.searchParams.get("limit") === "1") {
        return {
          entries: [{ userId: "leader", rank: 1, score: 1000, byTool: { codex: 1000 } }],
        };
      }
      fullRequests += 1;
      if (fullRequests === 1) {
        return {
          entries: [
            { userId: "member-95", rank: "Infinity", score: 120, byTool: { codex: 120 } },
          ],
        };
      }
      return {
        entries: [
          { userId: "member-94", rank: 94, score: 130, byTool: { codex: 130 } },
          { userId: "member-95", rank: 95, score: 120, byTool: { codex: 120 } },
          { userId: "member-96", rank: 96, score: 110, byTool: { codex: 110 } },
        ],
      };
    },
  });
  const home = tempDir("home");
  const configDir = path.join(home, ".opentoken");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, "island-state.json"),
    JSON.stringify({
      userId: "member-95",
      lastUpload: {
        uploadId: "current-upload",
        capturedAt: "2026-06-24T03:10:00.000Z",
        summary: {
          date: "2026-06-24",
          total: 100,
          normalized: 100,
          byTool: { codex: 100 },
          normalizedByTool: { codex: 100 },
        },
        upstream: { ok: true, status: 200, json: { accepted: 1 } },
      },
    })
  );
  const { port } = await startIslandServer(t, {
    home,
    env: { OPENTOKEN_LEADERBOARD_URL: leaderboard.url },
  });
  const config = await request(port, { path: "/api/client-config" });
  const { apiToken } = JSON.parse(config.body);

  const response = await request(port, {
    path: "/api/summary?refresh=1",
    headers: { "x-opentoken-island-token": apiToken },
  });
  const summary = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assert.deepEqual(leaderboard.requests.map((entry) => entry.limit), ["1", "200", "1", "200"]);
  assert.equal(summary.rank, 95);
  assert.equal(summary.leaderboardScore, 120);
});

test("manual summary refresh retries when full leaderboard window is temporarily empty", async (t) => {
  let fullRequests = 0;
  const leaderboard = await startFakeLeaderboard(t, {
    responseForRequest: (requestUrl) => {
      if (requestUrl.searchParams.get("limit") === "1") {
        return {
          entries: [{ userId: "leader", rank: 1, score: 1000, byTool: { codex: 1000 } }],
          myRank: { rank: 114, score: 100 },
        };
      }
      fullRequests += 1;
      if (fullRequests === 1) return { entries: [] };
      return {
        entries: [
          { userId: "member-113", rank: 113, score: 120, byTool: { codex: 120 } },
          { userId: "member-114", rank: 114, score: 100, byTool: { codex: 100 } },
          { userId: "member-115", rank: 115, score: 90, byTool: { codex: 90 } },
        ],
      };
    },
  });
  const home = tempDir("home");
  const configDir = path.join(home, ".opentoken");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, "island-state.json"),
    JSON.stringify({
      userId: "member-114",
      lastUpload: {
        uploadId: "current-upload",
        capturedAt: "2026-06-24T03:10:00.000Z",
        summary: {
          date: "2026-06-24",
          total: 100,
          normalized: 100,
          byTool: { codex: 100 },
          normalizedByTool: { codex: 100 },
        },
        upstream: { ok: true, status: 200, json: { accepted: 1 } },
      },
    })
  );
  const { port } = await startIslandServer(t, {
    home,
    env: { OPENTOKEN_LEADERBOARD_URL: leaderboard.url },
  });
  const config = await request(port, { path: "/api/client-config" });
  const { apiToken } = JSON.parse(config.body);

  const response = await request(port, {
    path: "/api/summary?refresh=1",
    headers: { "x-opentoken-island-token": apiToken },
  });
  const summary = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assert.deepEqual(leaderboard.requests.map((entry) => entry.limit), ["1", "200", "1", "200"]);
  assert.equal(summary.rank, 114);
  assert.equal(summary.gapToPrevious, 21);
  assert.equal(summary.leadOverNext, 10);
});

test("manual summary refresh retries when full leaderboard window misses own rank", async (t) => {
  let fullRequests = 0;
  const leaderboard = await startFakeLeaderboard(t, {
    responseForRequest: (requestUrl) => {
      if (requestUrl.searchParams.get("limit") === "1") {
        return {
          entries: [{ userId: "leader", rank: 1, score: 1000, byTool: { codex: 1000 } }],
          myRank: { rank: 114, score: 100 },
        };
      }
      fullRequests += 1;
      if (fullRequests === 1) {
        return {
          entries: [{ userId: "leader", rank: 1, score: 1000, byTool: { codex: 1000 } }],
        };
      }
      return {
        entries: [
          { userId: "member-113", rank: 113, score: 120, byTool: { codex: 120 } },
          { userId: "member-114", rank: 114, score: 100, byTool: { codex: 100 } },
          { userId: "member-115", rank: 115, score: 90, byTool: { codex: 90 } },
        ],
      };
    },
  });
  const home = tempDir("home");
  const configDir = path.join(home, ".opentoken");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, "island-state.json"),
    JSON.stringify({
      userId: "member-114",
      lastUpload: {
        uploadId: "current-upload",
        capturedAt: "2026-06-24T03:10:00.000Z",
        summary: {
          date: "2026-06-24",
          total: 100,
          normalized: 100,
          byTool: { codex: 100 },
          normalizedByTool: { codex: 100 },
        },
        upstream: { ok: true, status: 200, json: { accepted: 1 } },
      },
    })
  );
  const { port } = await startIslandServer(t, {
    home,
    env: { OPENTOKEN_LEADERBOARD_URL: leaderboard.url },
  });
  const config = await request(port, { path: "/api/client-config" });
  const { apiToken } = JSON.parse(config.body);

  const response = await request(port, {
    path: "/api/summary?refresh=1",
    headers: { "x-opentoken-island-token": apiToken },
  });
  const summary = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assert.deepEqual(leaderboard.requests.map((entry) => entry.limit), ["1", "200", "1", "200"]);
  assert.equal(summary.rank, 114);
  assert.equal(summary.gapToPrevious, 21);
  assert.equal(summary.leadOverNext, 10);
});

test("manual summary refresh retries when full leaderboard window has stale own score", async (t) => {
  let fullRequests = 0;
  const leaderboard = await startFakeLeaderboard(t, {
    responseForRequest: (requestUrl) => {
      if (requestUrl.searchParams.get("limit") === "1") {
        return {
          entries: [{ userId: "leader", rank: 1, score: 1000, byTool: { codex: 1000 } }],
          myRank: { rank: 114, score: 100 },
        };
      }
      fullRequests += 1;
      if (fullRequests === 1) {
        return {
          entries: [
            { userId: "member-113", rank: 113, score: 120, byTool: { codex: 120 } },
            { userId: "member-114", rank: 114, score: 80, byTool: { codex: 80 } },
            { userId: "member-115", rank: 115, score: 70, byTool: { codex: 70 } },
          ],
        };
      }
      return {
        entries: [
          { userId: "member-113", rank: 113, score: 120, byTool: { codex: 120 } },
          { userId: "member-114", rank: 114, score: 100, byTool: { codex: 100 } },
          { userId: "member-115", rank: 115, score: 90, byTool: { codex: 90 } },
        ],
      };
    },
  });
  const home = tempDir("home");
  const configDir = path.join(home, ".opentoken");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, "island-state.json"),
    JSON.stringify({
      userId: "member-114",
      lastUpload: {
        uploadId: "current-upload",
        capturedAt: "2026-06-24T03:10:00.000Z",
        summary: {
          date: "2026-06-24",
          total: 100,
          normalized: 100,
          byTool: { codex: 100 },
          normalizedByTool: { codex: 100 },
        },
        upstream: { ok: true, status: 200, json: { accepted: 1 } },
      },
    })
  );
  const { port } = await startIslandServer(t, {
    home,
    env: { OPENTOKEN_LEADERBOARD_URL: leaderboard.url },
  });
  const config = await request(port, { path: "/api/client-config" });
  const { apiToken } = JSON.parse(config.body);

  const response = await request(port, {
    path: "/api/summary?refresh=1",
    headers: { "x-opentoken-island-token": apiToken },
  });
  const summary = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assert.deepEqual(leaderboard.requests.map((entry) => entry.limit), ["1", "200", "1", "200"]);
  assert.equal(summary.rank, 114);
  assert.equal(summary.gapToPrevious, 21);
  assert.equal(summary.leadOverNext, 10);
});

test("manual summary refresh retries when rank-only is missing and full window only has another same-score member", async (t) => {
  let fullRequests = 0;
  const leaderboard = await startFakeLeaderboard(t, {
    responseForRequest: (requestUrl) => {
      if (requestUrl.searchParams.get("limit") === "1") {
        return {
          entries: [{ userId: "leader", rank: 1, score: 1000, byTool: { codex: 1000 } }],
        };
      }
      fullRequests += 1;
      if (fullRequests === 1) {
        return {
          entries: [
            { userId: "other-same-score", rank: 50, score: 100, byTool: { codex: 100 } },
          ],
        };
      }
      return {
        entries: [
          { userId: "member-49", rank: 49, score: 130, byTool: { codex: 130 } },
          { userId: "member-50", rank: 50, score: 100, byTool: { codex: 100 } },
          { userId: "member-51", rank: 51, score: 90, byTool: { codex: 90 } },
        ],
      };
    },
  });
  const home = tempDir("home");
  const configDir = path.join(home, ".opentoken");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, "island-state.json"),
    JSON.stringify({
      userId: "member-50",
      lastUpload: {
        uploadId: "current-upload",
        capturedAt: "2026-06-24T03:10:00.000Z",
        summary: {
          date: "2026-06-24",
          total: 100,
          normalized: 100,
          byTool: { codex: 100 },
          normalizedByTool: { codex: 100 },
        },
        upstream: { ok: true, status: 200, json: { accepted: 1 } },
      },
    })
  );
  const { port } = await startIslandServer(t, {
    home,
    env: { OPENTOKEN_LEADERBOARD_URL: leaderboard.url },
  });
  const config = await request(port, { path: "/api/client-config" });
  const { apiToken } = JSON.parse(config.body);

  const response = await request(port, {
    path: "/api/summary?refresh=1",
    headers: { "x-opentoken-island-token": apiToken },
  });
  const summary = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assert.deepEqual(leaderboard.requests.map((entry) => entry.limit), ["1", "200", "1", "200"]);
  assert.equal(summary.rank, 50);
  assert.equal(summary.gapToPrevious, 31);
  assert.equal(summary.leadOverNext, 10);
});

test("automatic summary refresh runs once in the background without blocking summary responses", async (t) => {
  const leaderboard = await startFakeLeaderboard(t, {
    delayMs: 250,
    entries: [
      { userId: "me", rank: 3, score: 100, byTool: { codex: 100 } },
    ],
  });
  const home = tempDir("home");
  const configDir = path.join(home, ".opentoken");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, "island-state.json"),
    JSON.stringify({
      lastUpload: {
        uploadId: "current-upload",
        capturedAt: "2026-06-24T03:00:00.000Z",
        summary: {
          date: "2026-06-24",
          total: 100,
          normalized: 100,
          byTool: { codex: 100 },
          normalizedByTool: { codex: 100 },
        },
        upstream: { ok: true, status: 200, json: { accepted: 1 } },
      },
      leaderboard: {
        uploadId: "current-upload",
        updatedAt: "2026-06-24T03:00:00.000Z",
        own: { rank: 4, score: 100, byTool: { codex: 100 }, estimated: true },
        estimated: true,
      },
    })
  );
  const { port } = await startIslandServer(t, {
    home,
    env: { OPENTOKEN_LEADERBOARD_URL: leaderboard.url },
  });

  const started = Date.now();
  const [first, second] = await Promise.all([
    request(port, { path: "/api/summary" }),
    request(port, { path: "/api/summary" }),
  ]);
  const elapsedMs = Date.now() - started;

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.ok(elapsedMs < 180, `summary responses waited ${elapsedMs}ms`);
  assert.equal(leaderboard.requests.length, 1);

  await waitUntil(() => {
    const state = JSON.parse(fs.readFileSync(path.join(configDir, "island-state.json"), "utf8"));
    return state.leaderboard?.own?.rank === 3 && state.leaderboard?.estimated === false;
  });
});

test("automatic summary refresh does not attach a stale leaderboard rank to the current upload", async (t) => {
  const leaderboard = await startFakeLeaderboard(t, { delayMs: 250, entries: [] });
  const home = tempDir("home");
  const configDir = path.join(home, ".opentoken");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, "island-state.json"),
    JSON.stringify({
      lastUpload: {
        uploadId: "new-upload",
        capturedAt: "2026-06-24T03:10:00.000Z",
        summary: {
          date: "2026-06-24",
          total: 10,
          normalized: 10,
          byTool: { codex: 10 },
          normalizedByTool: { codex: 10 },
        },
        upstream: { ok: true, status: 200, json: { accepted: 1 } },
      },
      leaderboard: {
        uploadId: "old-upload",
        updatedAt: "2026-06-24T03:00:00.000Z",
        own: { userId: "me", rank: 1, score: 100, byTool: { codex: 100 } },
        gapToPrevious: 0,
        leadOverNext: 50,
      },
    })
  );
  const { port } = await startIslandServer(t, {
    home,
    env: { OPENTOKEN_LEADERBOARD_URL: leaderboard.url },
  });

  const response = await request(port, { path: "/api/summary" });
  const summary = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assert.equal(summary.source, "upload");
  assert.equal(summary.total, 10);
  assert.equal(summary.rank, null);
  assert.equal(leaderboard.requests.length, 1);
});

test("upload proxy refresh ignores stale previous rank from another upload", async (t) => {
  const upstream = await startFakeUpstream(t);
  const leaderboard = await startFakeLeaderboard(t, {
    entries: [
      { userId: "me", rank: 3, score: 10, byTool: { codex: 10 } },
    ],
  });
  const home = tempDir("home");
  const configDir = path.join(home, ".opentoken");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, "config.json"),
    JSON.stringify({
      webhook_url: `http://127.0.0.1:${upstream.port}/tokenrank/api/subapp/u/account`,
    })
  );
  fs.writeFileSync(
    path.join(configDir, "island-state.json"),
    JSON.stringify({
      lastUpload: { uploadId: "current-before-upload" },
      leaderboard: {
        uploadId: "old-upload",
        updatedAt: "2026-06-24T03:00:00.000Z",
        own: { userId: "me", rank: 9, score: 100, byTool: { codex: 100 } },
      },
    })
  );
  const { port } = await startIslandServer(t, {
    home,
    env: { OPENTOKEN_LEADERBOARD_URL: leaderboard.url },
  });

  const response = await request(port, {
    path: "/tokenrank/api/subapp/u/account",
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      requestId: "B",
      rows: [{ date: "2026-06-24", tool: "codex", input: 10, normalized: 10 }],
    }),
  });
  const state = JSON.parse(fs.readFileSync(path.join(configDir, "island-state.json"), "utf8"));

  assert.equal(response.status, 200);
  assert.equal(state.leaderboard.own.rank, 3);
  assert.equal(state.leaderboard.rankDelta, 0);
});

test("concurrent upload proxy writes coherent lastUpload records", async (t) => {
  const upstream = await startFakeUpstream(t);
  const home = tempDir("home");
  const configDir = path.join(home, ".opentoken");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, "config.json"),
    JSON.stringify({
      webhook_url: `http://127.0.0.1:${upstream.port}/tokenrank/api/subapp/u/account`,
    })
  );
  const { port } = await startIslandServer(t, { home });

  const first = request(port, {
    path: "/tokenrank/api/subapp/u/account",
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId: "A" }),
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  const second = request(port, {
    path: "/tokenrank/api/subapp/u/account",
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId: "B" }),
  });
  await Promise.all([first, second]);

  const state = JSON.parse(fs.readFileSync(path.join(configDir, "island-state.json"), "utf8"));
  const upstreamBody = JSON.parse(state.lastUpload.upstream.body);
  assert.equal(state.lastUpload.payload.requestId, "B");
  assert.equal(state.lastUpload.payload.requestId, upstreamBody.requestId);
});

test("upload proxy queues a local refresh event after capturing payload", async (t) => {
  const upstream = await startFakeUpstream(t);
  const home = tempDir("home");
  const configDir = path.join(home, ".opentoken");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, "config.json"),
    JSON.stringify({
      webhook_url: `http://127.0.0.1:${upstream.port}/tokenrank/api/subapp/u/account`,
    })
  );
  const { port } = await startIslandServer(t, { home });

  const before = JSON.parse((await request(port, { path: "/api/island-event" })).body).event;
  await request(port, {
    path: "/tokenrank/api/subapp/u/account",
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rows: [] }),
  });
  const after = JSON.parse((await request(port, { path: "/api/island-event" })).body).event;

  assert.ok(after.id > before.id);
  assert.equal(after.reason, "upload-captured");
  assert.equal(after.showIsland, false);
});

test("upload proxy queues the local refresh event before upstream responds", async (t) => {
  const upstream = await startFakeUpstream(t);
  const home = tempDir("home");
  const configDir = path.join(home, ".opentoken");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, "config.json"),
    JSON.stringify({
      webhook_url: `http://127.0.0.1:${upstream.port}/tokenrank/api/subapp/u/account`,
    })
  );
  const { port } = await startIslandServer(t, { home });

  const before = JSON.parse((await request(port, { path: "/api/island-event" })).body).event;
  const upload = request(port, {
    path: "/tokenrank/api/subapp/u/account",
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      requestId: "A",
      rows: [{ date: "2026-06-23", tool: "codex", input: 10, normalized: 10 }],
    }),
  });

  await waitUntil(() => upstream.requests.length === 1);
  const duringUpstreamWait = JSON.parse((await request(port, { path: "/api/island-event" })).body).event;
  assert.ok(duringUpstreamWait.id > before.id);
  assert.equal(duringUpstreamWait.reason, "upload-captured");
  assert.equal(duringUpstreamWait.showIsland, false);

  await upload;
});

test("capturing a new upload stops serving a stale leaderboard snapshot", async (t) => {
  const upstream = await startFakeUpstream(t);
  const home = tempDir("home");
  const configDir = path.join(home, ".opentoken");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, "config.json"),
    JSON.stringify({
      webhook_url: `http://127.0.0.1:${upstream.port}/tokenrank/api/subapp/u/account`,
    })
  );
  fs.writeFileSync(
    path.join(configDir, "island-state.json"),
    JSON.stringify({
      lastUpload: {
        uploadId: "old-upload",
        capturedAt: "2026-06-23T11:59:00.000Z",
        summary: {
          date: "2026-06-23",
          total: 100,
          normalized: 100,
          byTool: { codex: 100 },
          normalizedByTool: { codex: 100 },
        },
      },
      leaderboard: {
        uploadId: "old-upload",
        updatedAt: "2026-06-23T11:59:01.000Z",
        own: { userId: "me", rank: 1, score: 100, byTool: { codex: 100 } },
        gapToPrevious: 0,
        leadOverNext: 50,
        rankDelta: 0,
      },
    })
  );
  const { port } = await startIslandServer(t, { home });

  const upload = request(port, {
    path: "/tokenrank/api/subapp/u/account",
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      requestId: "A",
      rows: [{ date: "2026-06-23", tool: "codex", input: 10, normalized: 10 }],
    }),
  });

  await waitUntil(() => upstream.requests.length === 1);
  const summary = JSON.parse((await request(port, { path: "/api/summary" })).body);
  assert.equal(summary.source, "upload");
  assert.equal(summary.total, 10);
  assert.equal(summary.rank, null);

  await upload;
});

test("static file server sets x-content-type-options and x-frame-options", async (t) => {
  const { port } = await startIslandServer(t);
  const response = await request(port, { path: "/island.html" });
  assert.equal(response.status, 200);
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.equal(response.headers["x-frame-options"], "DENY");
});

test("upload proxy rejects oversized request bodies", async (t) => {
  const upstream = await startFakeUpstream(t);
  const home = tempDir("home");
  const configDir = path.join(home, ".opentoken");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, "config.json"),
    JSON.stringify({
      webhook_url: `http://127.0.0.1:${upstream.port}/tokenrank/api/subapp/u/account`,
    })
  );
  const { port } = await startIslandServer(t, { home });
  const response = await request(port, {
    path: "/tokenrank/api/subapp/u/account",
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "x".repeat(5 * 1024 * 1024 + 1),
  });
  assert.equal(response.status, 413);
  assert.equal(upstream.requests.length, 0);
});
