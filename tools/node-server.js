#!/usr/bin/env node
/**
 * Self-Hosted Production Server (`tools/node-server.js`)
 *
 * Runs Elgo Lab on any Linux/Windows VPS or Docker container with zero external
 * npm dependencies using persistent `node:sqlite` + disk-backed file storage.
 *
 * Environment variables:
 *   PORT                Listening port (default: 4183)
 *   HOST                Bind host (default: 0.0.0.0)
 *   ELGO_DATA_DIR       Persistent data folder for SQLite DB & PDFs (default: ./data-store)
 *   ADMIN_PASSWORD_HASH Preferred salted PBKDF2 hash from `node tools/admin-password.js --hash`
 *   ADMIN_PASSWORD      Alternative plaintext master admin password
 *   TRUST_PROXY         Set to "1" when behind HTTPS Nginx / Caddy / Traefik reverse proxy
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const { buildPublicSite } = require("./build");
const { serveHttpServer } = require("./http-host");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_PUBLIC_DIR = path.join(ROOT, "public");
const SCHEMA_PATH = path.join(ROOT, "backend", "schema.sql");

function loadDotEnvIfPresent(envPath) {
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}

function createPersistentD1(db) {
  function prepare(sql) {
    let params = [];
    const stmtApi = {
      bind(...args) {
        params = args;
        return stmtApi;
      },
      async first(col) {
        const row = db.prepare(sql).get(...params);
        if (!row) return null;
        return col ? row[col] : row;
      },
      async all() {
        const results = db.prepare(sql).all(...params);
        return { results };
      },
      async run() {
        const info = db.prepare(sql).run(...params);
        return { success: true, meta: { changes: Number(info.changes || 0) } };
      },
      _exec() {
        return db.prepare(sql).run(...params);
      },
    };
    return stmtApi;
  }

  async function batch(statements) {
    const out = [];
    db.exec("BEGIN");
    try {
      for (const s of statements || []) {
        const info = s._exec();
        out.push({ success: true, meta: { changes: Number(info.changes || 0) } });
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
    return out;
  }

  return { prepare, batch };
}

function createDiskR2(filesDir) {
  fs.mkdirSync(filesDir, { recursive: true });
  const baseResolved = path.resolve(filesDir);

  function resolveKey(key) {
    const clean = String(key || "").replace(/\\/g, "/").replace(/^\/+/, "");
    if (!clean || clean.includes("..")) {
      throw new Error("Invalid storage key.");
    }
    const target = path.resolve(baseResolved, clean);
    if (!target.startsWith(baseResolved + path.sep)) {
      throw new Error("Path traversal blocked.");
    }
    return target;
  }

  return {
    async put(key, body, meta) {
      const target = resolveKey(key);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const buf = Buffer.isBuffer(body)
        ? body
        : body instanceof ArrayBuffer
          ? Buffer.from(body)
          : ArrayBuffer.isView(body)
            ? Buffer.from(body.buffer, body.byteOffset, body.byteLength)
            : Buffer.from(String(body || ""), "utf8");
      fs.writeFileSync(target, buf);
      if (meta && meta.httpMetadata) {
        fs.writeFileSync(target + ".meta.json", JSON.stringify(meta.httpMetadata));
      }
      return { key };
    },
    async get(key) {
      let target;
      try {
        target = resolveKey(key);
      } catch (_e) {
        return null;
      }
      if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return null;
      let httpMetadata = { contentType: "application/pdf" };
      if (fs.existsSync(target + ".meta.json")) {
        try {
          httpMetadata = JSON.parse(fs.readFileSync(target + ".meta.json", "utf8"));
        } catch (_e) { /* keep default */ }
      }
      const data = fs.readFileSync(target);
      return { body: data, httpMetadata };
    },
    async delete(key) {
      let target;
      try {
        target = resolveKey(key);
      } catch (_e) {
        return;
      }
      if (fs.existsSync(target)) fs.unlinkSync(target);
      if (fs.existsSync(target + ".meta.json")) fs.unlinkSync(target + ".meta.json");
    },
  };
}

async function startNodeServer(options) {
  const opts = options || {};
  if (!opts.skipDotEnv) {
    loadDotEnvIfPresent(path.join(ROOT, ".env"));
  }

  const publicDir = opts.publicDir ? path.resolve(opts.publicDir) : DEFAULT_PUBLIC_DIR;
  const dataDir = path.resolve(opts.dataDir || process.env.ELGO_DATA_DIR || path.join(ROOT, "data-store"));
  fs.mkdirSync(dataDir, { recursive: true });

  const needsBuild =
    !opts.skipBuild &&
    (opts.rebuild ||
      !fs.existsSync(path.join(publicDir, "data", "catalog.json")) ||
      !fs.existsSync(path.join(ROOT, "backend", "answer-key.js")));
  if (needsBuild) {
    buildPublicSite({ outDir: publicDir, skipAnswerKey: opts.skipAnswerKey });
  }

  const dbPath = path.join(dataDir, "elgo-lab.db");
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
  const schemaSql = fs.readFileSync(SCHEMA_PATH, "utf8");
  db.exec(schemaSql);

  const DB = createPersistentD1(db);
  const FILES = createDiskR2(path.join(dataDir, "files"));
  const adminPasswordHash = opts.adminPasswordHash != null ? opts.adminPasswordHash : (process.env.ADMIN_PASSWORD_HASH || "");
  const adminPassword = opts.adminPassword != null ? opts.adminPassword : (process.env.ADMIN_PASSWORD || "");
  const trustProxy = opts.trustProxy != null ? opts.trustProxy : (process.env.TRUST_PROXY || "");

  const baseEnv = {
    DB,
    FILES,
    ADMIN_PASSWORD_HASH: adminPasswordHash,
    ADMIN_PASSWORD: adminPassword,
    TRUST_PROXY: trustProxy,
    STORAGE_MODE: "self-hosted-sqlite",
  };

  const host = opts.host || process.env.HOST || "0.0.0.0";
  const port = opts.port != null ? opts.port : (Number(process.env.PORT) || 4183);

  const { server, port: boundPort } = await serveHttpServer({
    publicDir,
    host,
    port,
    trustProxy: trustProxy === "1" || trustProxy === true,
    envFactory: (req) => Object.assign({}, baseEnv, {
      REMOTE_ADDR: (req.socket && req.socket.remoteAddress) || "unknown",
    }),
  });

  if (!opts.quiet) {
    console.log(`Elgo Lab self-hosted server listening on http://${host}:${boundPort}`);
    console.log(`Persistent storage directory: ${dataDir}`);
    if (!adminPassword && !adminPasswordHash) {
      console.warn(
        "WARNING: Neither ADMIN_PASSWORD_HASH nor ADMIN_PASSWORD is set. Admin portal login is disabled until configured."
      );
    }
  }

  async function close() {
    await new Promise((resolve) => server.close(() => resolve()));
    try { db.close(); } catch (_e) { /* already closed */ }
  }

  return { server, port: boundPort, env: baseEnv, db, dataDir, close };
}

if (require.main === module) {
  let instance = null;
  startNodeServer()
    .then((inst) => { instance = inst; })
    .catch((err) => {
      console.error("Failed to start Elgo Lab server:", err);
      process.exit(1);
    });

  const shutdown = async () => {
    if (instance) await instance.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

module.exports = { startNodeServer, createPersistentD1, createDiskR2, loadDotEnvIfPresent };
