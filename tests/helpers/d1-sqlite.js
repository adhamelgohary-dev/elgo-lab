"use strict";
/**
 * Test double for Cloudflare D1 + R2 backed by a REAL SQLite engine (node:sqlite).
 * Used by the backend security tests so SQL (upserts, aggregates, constraints) is
 * exercised for real instead of being mocked away.
 *
 * Everything lives in memory — nothing touches project files.
 */
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const ROOT = path.resolve(__dirname, "..", "..");

function createD1(db) {
  function stmt(sql, params) {
    return {
      bind() { return stmt(sql, Array.prototype.slice.call(arguments)); },
      async first() {
        const row = db.prepare(sql).get.apply(db.prepare(sql), params);
        return row ? Object.assign({}, row) : null;
      },
      async all() {
        const prepared = db.prepare(sql);
        return { success: true, results: prepared.all.apply(prepared, params).map((r) => Object.assign({}, r)) };
      },
      async run() {
        const prepared = db.prepare(sql);
        const info = prepared.run.apply(prepared, params);
        return { success: true, meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
      }
    };
  }
  return {
    prepare(sql) { return stmt(sql, []); },
    async batch(statements) {
      db.exec("BEGIN");
      try {
        const out = [];
        for (const s of statements) out.push(await s.run());
        db.exec("COMMIT");
        return out;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    }
  };
}

function createR2() {
  const store = new Map();
  return {
    store,
    async put(key, value, options) {
      store.set(key, { bytes: Buffer.from(value), httpMetadata: (options && options.httpMetadata) || {} });
    },
    async get(key) {
      const item = store.get(key);
      if (!item) return null;
      return { body: new Blob([item.bytes]).stream(), httpMetadata: item.httpMetadata };
    },
    async delete(key) { store.delete(key); }
  };
}

/** Fresh database from the canonical schema (`backend/schema.sql`). */
function freshDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(fs.readFileSync(path.join(ROOT, "backend/schema.sql"), "utf8"));
  return db;
}

/**
 * Production-like database: 0001 + the columns the OLD worker used to add at runtime,
 * then migration 0002. Proves the migration path works against the legacy shape.
 */
function legacyThenMigratedDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(fs.readFileSync(path.join(ROOT, "backend/migrations/0001_initial.sql"), "utf8"));
  [
    "ALTER TABLE users ADD COLUMN password_hash TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE users ADD COLUMN progress_json TEXT NOT NULL DEFAULT '{}'",
    "ALTER TABLE admin_sessions ADD COLUMN is_master_admin INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE admin_sessions ADD COLUMN student_id TEXT DEFAULT ''",
    "CREATE TABLE IF NOT EXISTS user_sessions (token_hash TEXT PRIMARY KEY, student_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)"
  ].forEach((sql) => { try { db.exec(sql); } catch (_e) { /* column may already exist in 0001 */ } });
  return db;
}

function createEnv(options) {
  const opts = options || {};
  const db = opts.db || freshDb();
  return {
    sqlite: db,
    DB: createD1(db),
    FILES: createR2(),
    ADMIN_PASSWORD: opts.adminPassword === undefined ? "correct horse battery staple" : opts.adminPassword
  };
}

module.exports = { createEnv, createD1, createR2, freshDb, legacyThenMigratedDb, ROOT };
