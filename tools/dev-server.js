#!/usr/bin/env node
/**
 * Local Development Server (`tools/dev-server.js`)
 *
 * Serves `public/` on http://127.0.0.1:4183 and mounts `/api/*` directly
 * onto `backend/worker.js` using the in-memory SQLite D1 & R2 engine.
 */
"use strict";

const path = require("path");
const { buildPublicSite } = require("./build");
const { createEnv } = require("../tests/helpers/d1-sqlite");
const { serveHttpServer } = require("./http-host");

const ROOT = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const PORT = Number(process.env.PORT) || 4183;
const HOST = process.env.HOST || "127.0.0.1";

function isLoopbackHost(host) {
  const normalized = String(host || "").trim().toLowerCase();
  return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1" || normalized === "[::1]";
}

async function startServer(options) {
  const opts = options || {};
  const host = opts.host || HOST;
  const port = opts.port != null ? opts.port : PORT;
  const explicitPassword = opts.adminPassword || process.env.ELGO_DEV_ADMIN_PASSWORD || "";
  if (!isLoopbackHost(host) && (!explicitPassword || explicitPassword === "0000" || explicitPassword.length < 12)) {
    throw new Error(
      `Refusing to start dev-server on non-loopback host "${host}" without an explicit ELGO_DEV_ADMIN_PASSWORD (at least 12 characters).`
    );
  }

  const publicDir = opts.publicDir ? path.resolve(opts.publicDir) : PUBLIC_DIR;
  if (!opts.skipBuild) {
    buildPublicSite({ outDir: publicDir, skipAnswerKey: opts.skipAnswerKey });
  }

  const adminPassword = explicitPassword || "0000";
  const env = createEnv({ adminPassword });

  const { server, port: boundPort } = await serveHttpServer({
    publicDir,
    host,
    port,
    env,
  });

  if (!opts.quiet) {
    console.log(`Elgo Lab dev server running at http://${host}:${boundPort}/?flow=hub`);
    console.log(explicitPassword ? "Admin password: configured." : "Loopback demo admin password: 0000");
  }
  return { server, port: boundPort, env, adminPassword };
}

if (require.main === module) {
  startServer();
}

module.exports = { startServer };
