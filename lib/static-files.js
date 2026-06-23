const fs = require("fs");
const path = require("path");

const DEFAULT_MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function createStaticFileHandler(root, mime = DEFAULT_MIME) {
  const rootPath = path.resolve(root);

  return function serveStatic(req, res, url) {
    if (!["GET", "HEAD"].includes(req.method)) {
      res.writeHead(405);
      return res.end("Method not allowed");
    }

    let requested;
    try {
      requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
    } catch {
      res.writeHead(400);
      return res.end("Bad request");
    }
    if (requested.includes("\0")) {
      res.writeHead(400);
      return res.end("Bad request");
    }

    const filePath = path.resolve(rootPath, `.${requested}`);
    const relativePath = path.relative(rootPath, filePath);
    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      res.writeHead(403);
      return res.end("Forbidden");
    }

    try {
      fs.readFile(filePath, (error, data) => {
        if (error) {
          res.writeHead(404);
          return res.end("Not found");
        }
        res.writeHead(200, {
          "content-type": mime[path.extname(filePath)] || "application/octet-stream",
        });
        res.end(req.method === "HEAD" ? undefined : data);
      });
    } catch {
      res.writeHead(400);
      res.end("Bad request");
    }
  };
}

module.exports = {
  createStaticFileHandler,
};
