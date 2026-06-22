const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const PORT = Number(process.env.OPENTOKEN_ISLAND_PORT || 4174);
const ROOT = __dirname;
const OPENTOKEN = process.env.OPENTOKEN_BIN || "/Users/yangguangxiaolaohu/.local/bin/opentoken";
const CONFIG_PATH = path.join(process.env.HOME || "/Users/yangguangxiaolaohu", ".opentoken", "config.json");

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

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

function formatCount(value) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 1 : 2)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(value);
}

function todayLocal() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function summarize(rows) {
  const dates = [...new Set(rows.map((row) => row.date))].sort();
  const date = dates.includes(todayLocal()) ? todayLocal() : dates[dates.length - 1] || todayLocal();
  const dayRows = rows.filter((row) => row.date === date);
  const byTool = new Map();
  for (const row of dayRows) {
    byTool.set(row.tool, (byTool.get(row.tool) || 0) + Number(row.normalized || 0));
  }
  const tools = [...byTool.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
  const total = tools.reduce((sum, tool) => sum + tool.value, 0);
  const max = Math.max(1, ...tools.map((tool) => tool.value));
  return {
    date,
    total,
    totalLabel: formatCount(total),
    rank: 17,
    rankDelta: 3,
    nextRankGap: 42000,
    xp: Math.min(4800, Math.round((total / 1_000_000) * 620)),
    xpMax: 4800,
    tools: tools.slice(0, 4).map((tool) => ({
      ...tool,
      label: tool.name.replace(/-/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()),
      valueLabel: formatCount(tool.value),
      pct: Math.max(4, Math.round((tool.value / max) * 100)),
    })),
  };
}

function accountStatus() {
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    const webhook = String(config.webhook_url || "");
    const match = webhook.match(/\/u\/([^/?#]+)/);
    const accountId = match ? match[1] : "";
    return {
      connected: Boolean(webhook),
      accountId: accountId ? `${accountId.slice(0, 8)}...${accountId.slice(-6)}` : "",
      host: webhook ? new URL(webhook).host : "",
      configPath: CONFIG_PATH,
    };
  } catch (error) {
    return {
      connected: false,
      accountId: "",
      host: "",
      configPath: CONFIG_PATH,
      error: error.message,
    };
  }
}

async function handleApi(req, res, url) {
  if (url.pathname === "/api/summary") {
    const since = url.searchParams.get("since") || todayLocal();
    const result = await run(OPENTOKEN, ["preview", "--json", "--since", since], 45000);
    if (!result.ok) return json(res, 500, { ok: false, error: result.stderr || result.message });
    try {
      const rows = JSON.parse(result.stdout);
      return json(res, 200, { ok: true, ...summarize(rows), account: accountStatus(), service: await serviceStatus() });
    } catch (error) {
      return json(res, 500, { ok: false, error: `Invalid opentoken JSON: ${error.message}` });
    }
  }

  if (url.pathname === "/api/upload") {
    if (req.method !== "POST") return json(res, 405, { ok: false, error: "POST required" });
    const since = url.searchParams.get("since") || todayLocal();
    const result = await run(OPENTOKEN, ["upload", "--since", since], 90000);
    return json(res, result.ok ? 200 : 500, {
      ok: result.ok,
      output: (result.stdout || result.stderr || result.message).trim(),
      account: accountStatus(),
      service: await serviceStatus(),
    });
  }

  if (url.pathname === "/api/service") {
    return json(res, 200, { ok: true, account: accountStatus(), service: await serviceStatus() });
  }

  return json(res, 404, { ok: false, error: "Not found" });
}

async function serviceStatus() {
  const result = await run(OPENTOKEN, ["service", "status"], 15000);
  return {
    ok: result.ok,
    text: (result.stdout || result.stderr || result.message).trim(),
    running: /running|loaded|已运行|active/i.test(result.stdout + result.stderr),
  };
}

function json(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
  });
  res.end(JSON.stringify(body));
}

function serveStatic(req, res, url) {
  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(ROOT, requested));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      return res.end("Not found");
    }
    res.writeHead(200, { "content-type": mime[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type",
    });
    return res.end();
  }
  const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
  if (url.pathname.startsWith("/api/")) return handleApi(req, res, url);
  return serveStatic(req, res, url);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`OpenToken Island live server running at http://127.0.0.1:${PORT}`);
});
