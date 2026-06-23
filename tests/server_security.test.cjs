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
