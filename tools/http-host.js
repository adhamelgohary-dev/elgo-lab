#!/usr/bin/env node
/**
 * Shared HTTP Static & Worker API Host (`tools/http-host.js`)
 *
 * Used by both `tools/dev-server.js` (in-memory D1/R2) and
 * `tools/node-server.js` (persistent SQLite + Disk storage for self-hosting).
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const worker = require("../backend/worker");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
};

const CSP_HEADER =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob: https:; " +
  "media-src 'self' blob:; frame-src 'self' blob: https://www.youtube-nocookie.com; " +
  "connect-src 'self'; font-src 'self'; object-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'";

function serveHttpServer(options) {
  const opts = options || {};
  const publicDir = path.resolve(opts.publicDir);
  const host = opts.host || "127.0.0.1";
  const port = opts.port != null ? opts.port : 4183;
  const envOrFactory = opts.envFactory || (() => opts.env);

  const server = http.createServer(async (req, res) => {
    try {
      const proto = opts.trustProxy && req.headers["x-forwarded-proto"] === "https" ? "https" : "http";
      const origin = `${proto}://${req.headers.host || `${host}:${port}`}`;
      const fullUrl = new URL(req.url || "/", origin);

      if (fullUrl.pathname.startsWith("/api/")) {
        const chunks = [];
        for await (const ch of req) chunks.push(ch);
        const bodyBuf = Buffer.concat(chunks);
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) {
          if (typeof v === "string") headers.set(k, v);
          else if (Array.isArray(v)) headers.set(k, v.join(", "));
        }
        const method = (req.method || "GET").toUpperCase();
        const init = { method, headers };
        if (method !== "GET" && method !== "HEAD" && bodyBuf.length > 0) {
          init.body = bodyBuf;
        }
        const webReq = new Request(fullUrl.toString(), init);
        const reqEnv = typeof envOrFactory === "function" ? envOrFactory(req) : envOrFactory;
        const webRes = await worker.handleApiRequest(webReq, reqEnv);
        const outHeaders = {};
        webRes.headers.forEach((v, k) => { outHeaders[k] = v; });
        outHeaders["X-Content-Type-Options"] = "nosniff";
        res.writeHead(webRes.status, outHeaders);
        const arrBuf = await webRes.arrayBuffer();
        res.end(Buffer.from(arrBuf));
        return;
      }

      let relPath = "/";
      try {
        relPath = decodeURIComponent(fullUrl.pathname);
      } catch (_e) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Bad URL encoding");
        return;
      }
      if (relPath === "/") relPath = "/index.html";
      const safeRel = path.posix.normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, "").replace(/^\/+/, "");
      let filePath = path.join(publicDir, safeRel);

      if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, "index.html");
      }
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        if (!path.extname(safeRel)) {
          filePath = path.join(publicDir, "index.html");
        } else {
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Not found");
          return;
        }
      }

      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "SAMEORIGIN",
        "Content-Security-Policy": CSP_HEADER,
      });
      if ((req.method || "GET").toUpperCase() === "HEAD") {
        res.end();
        return;
      }
      fs.createReadStream(filePath).pipe(res);
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Server error: " + err.message);
    }
  });

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const addr = server.address();
      resolve({ server, port: addr.port });
    });
  });
}

module.exports = { MIME_TYPES, CSP_HEADER, serveHttpServer };
