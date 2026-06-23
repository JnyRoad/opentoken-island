function isAllowedOrigin(origin = "", port) {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return url.protocol === "http:"
      && ["127.0.0.1", "localhost"].includes(url.hostname)
      && Number(url.port || 80) === Number(port);
  } catch {
    return false;
  }
}

function corsHeaders(req, port, headers = {}) {
  const origin = req.headers.origin || "";
  const next = { ...headers, vary: "Origin" };
  if (origin && isAllowedOrigin(origin, port)) {
    next["access-control-allow-origin"] = origin;
  }
  return next;
}

function sendJson(req, res, port, status, body) {
  res.writeHead(status, corsHeaders(req, port, {
    "content-type": "application/json; charset=utf-8",
  }));
  res.end(JSON.stringify(body));
}

function requireTrustedOrigin(req, res, port) {
  if (isAllowedOrigin(req.headers.origin || "", port)) return true;
  sendJson(req, res, port, 403, { ok: false, error: "Forbidden origin" });
  return false;
}

module.exports = {
  corsHeaders,
  isAllowedOrigin,
  requireTrustedOrigin,
  sendJson,
};
