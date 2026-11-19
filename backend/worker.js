/**
 * Elgo Lab — Cloudflare Pages Functions / Worker API (`backend/worker.js`)
 *
 * Bindings:
 *  - env.DB                  D1 database (elgo_lab_db)
 *  - env.FILES               R2 bucket (elgo-lab-files)
 *  - env.ADMIN_PASSWORD_HASH secret — preferred: salted "pbkdf2$iter$salt$digest" written by
 *                            tools/admin-password.js (manage-admin-password.bat); wins if both are set
 *  - env.ADMIN_PASSWORD      legacy secret — plaintext master admin password
 *
 * AUTHORIZATION MODEL (implementation phase 2026-11-10)
 *  - Student sessions live ONLY in `user_sessions` (Bearer token).
 *  - Master-admin sessions live ONLY in `admin_sessions` with is_master_admin = 1 and
 *    an empty student_id (HttpOnly cookie `mcq_admin_session`, or Bearer token).
 *  - Co-admins are students whose `users.is_admin = 1`; they authenticate with their own
 *    student session and the role is re-read from the database on every request.
 *  - A student token can never satisfy a master-admin check, and the old behaviour of
 *    copying student tokens into `admin_sessions` is gone (legacy rows are ignored here
 *    and removed by migration 0002).
 *  - Every protected route calls its own guard; nothing relies on client state.
 *
 * SCHEMA: this file never alters the schema. Use `backend/migrations/*.sql`.
 */

"use strict";

let answerKeyModule = null;
let bundledExplanations = {};
try {
  bundledExplanations = require("./question-explanations.generated.js");
} catch (_error) {
  // Local tooling can load the worker before generating the release assets.
}
try {
  answerKeyModule = require("./answer-key.js");
} catch (_e) {
  // Fail closed: with no key every quiz submission is rejected.
  answerKeyModule = { collections: {}, byInternalId: {}, byOriginalId: {} };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const ADMIN_SESSION_TTL_MS = 4 * 60 * 60 * 1000;
const USER_SESSION_TTL_MS = 10 * 365 * 24 * 60 * 60 * 1000; // Effectively permanent student session (until logout/deletion)
const MAX_SESSIONS_PER_USER = 25;
const MAX_USERNAME_CHANGES = 3;
const MIN_PASSWORD_LENGTH_NEW = 8;
const PBKDF2_ITERATIONS = 100000; // Workers WebCrypto maximum
const MAX_JSON_BODY_BYTES = 1024 * 1024;
const MAX_PROGRESS_BYTES = 400 * 1024;
const MAX_OVERLAY_BYTES = 900 * 1024;
const MAX_SITE_SETTINGS_BYTES = 64 * 1024;
const UTF8_ENCODER = typeof TextEncoder === "function" ? new TextEncoder() : null;

function encodeUtf8Bytes(value) {
  const str = typeof value === "string" ? value : String(value == null ? "" : value);
  if (UTF8_ENCODER) return UTF8_ENCODER.encode(str);
  const bytes = [];
  for (let i = 0; i < str.length; i += 1) {
    const code = str.charCodeAt(i);
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xC0 | (code >> 6), 0x80 | (code & 0x3F));
    else if (code >= 0xD800 && code <= 0xDBFF) {
      const next = str.charCodeAt(i + 1);
      if (next >= 0xDC00 && next <= 0xDFFF) {
        const cp = 0x10000 + (((code & 0x3FF) << 10) | (next & 0x3FF));
        bytes.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3F), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
        i += 1;
      } else {
        bytes.push(0xE0 | (code >> 12), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F));
      }
    } else {
      bytes.push(0xE0 | (code >> 12), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F));
    }
  }
  return bytes;
}

function utf8ByteLength(value) {
  return encodeUtf8Bytes(value).length;
}
const MAX_PDF_BYTES = 25 * 1024 * 1024;
const MAX_QUIZ_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_QUIZ_IMAGES_PER_QUESTION = 6;
const MAX_ANSWERS_PER_SUBMISSION = 500;
const MIN_MS_PER_ANSWER = 1000;
const MAX_SUBMISSIONS_PER_WINDOW = 30;
const SUBMISSION_WINDOW_MS = 10 * 60 * 1000;
const RESERVED_USERNAMES = ["admin", "administrator", "root", "system", "moderator", "faculty", "instructor", "support"];

const PDF_KEY_PATTERN = /^pdfs\/[a-z0-9-]{1,60}\/[a-f0-9]{32}\.pdf$/;
const QUIZ_IMAGE_KEY_PATTERN = /^quiz-images\/[a-z0-9-]{1,60}\/[a-f0-9]{32}\.(png|jpg|webp|gif)$/;
const QUIZ_IMAGE_MIME = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif"
};

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------
function jsonResponse(body, status, extraHeaders) {
  const headers = Object.assign(
    {
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store"
    },
    extraHeaders || {}
  );
  return new Response(JSON.stringify(body), { status: status || 200, headers: headers });
}

function fail(status, error, code, extra) {
  return jsonResponse(Object.assign({ ok: false, error: error, code: code || "ERROR" }, extra || {}), status);
}

function getClientIp(request, env) {
  // CF-Connecting-IP is authoritative on Cloudflare; self-hosted servers opt into TRUST_PROXY or pass REMOTE_ADDR.
  const cfIp = request.headers.get("CF-Connecting-IP");
  if (cfIp) return cfIp.split(",")[0].trim() || "unknown";
  if (env && (env.TRUST_PROXY === "1" || env.TRUST_PROXY === true)) {
    const fwd = request.headers.get("X-Forwarded-For");
    if (fwd) return fwd.split(",")[0].trim() || "unknown";
  }
  return (env && env.REMOTE_ADDR) || "unknown";
}

async function readJson(request) {
  const declared = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > MAX_JSON_BODY_BYTES) return { tooLarge: true, body: {} };
  let text = "";
  try { text = await request.text(); } catch (_e) { return { body: {} }; }
  if (utf8ByteLength(text) > MAX_JSON_BODY_BYTES) return { tooLarge: true, body: {} };
  try {
    const parsed = JSON.parse(text);
    return { body: parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {} };
  } catch (_e) {
    return { body: {}, invalid: true };
  }
}

// ---------------------------------------------------------------------------
// Crypto helpers
// ---------------------------------------------------------------------------
function toHex(buffer) {
  return Array.from(new Uint8Array(buffer), function (b) { return b.toString(16).padStart(2, "0"); }).join("");
}

function fromHex(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

async function sha256Hex(input) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(input == null ? "" : input)));
  return toHex(digest);
}

function randomHex(bytes) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return toHex(arr);
}

function generateSessionToken() {
  return randomHex(32);
}

function constantTimeEqual(a, b) {
  const strA = String(a == null ? "" : a);
  const strB = String(b == null ? "" : b);
  if (strA.length !== strB.length) return false;
  let diff = 0;
  for (let i = 0; i < strA.length; i += 1) diff |= strA.charCodeAt(i) ^ strB.charCodeAt(i);
  return diff === 0;
}

async function pbkdf2Hex(password, saltBytes, iterations) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(String(password)), { name: "PBKDF2" }, false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations: iterations }, key, 256);
  return toHex(bits);
}

async function hashUserPassword(password) {
  const saltHex = randomHex(16);
  const digest = await pbkdf2Hex(password, fromHex(saltHex), PBKDF2_ITERATIONS);
  return "pbkdf2$" + PBKDF2_ITERATIONS + "$" + saltHex + "$" + digest;
}

/** Returns { ok, needsRehash }. Understands the legacy `sha256$salt$digest` format. */
async function verifyUserPassword(password, stored) {
  const parts = String(stored || "").split("$");
  if (parts[0] === "pbkdf2" && parts.length === 4) {
    const iterations = Number(parts[1]);
    if (!Number.isFinite(iterations) || iterations < 1000 || iterations > PBKDF2_ITERATIONS) return { ok: false };
    const digest = await pbkdf2Hex(password, fromHex(parts[2]), iterations);
    return { ok: constantTimeEqual(digest, parts[3]), needsRehash: iterations < PBKDF2_ITERATIONS };
  }
  if (parts[0] === "sha256" && parts.length === 3) {
    const digest = await sha256Hex(parts[1] + ":" + String(password || ""));
    return { ok: constantTimeEqual(digest, parts[2]), needsRehash: true };
  }
  return { ok: false };
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  String(header).split(";").forEach(function (pair) {
    const idx = pair.indexOf("=");
    if (idx <= 0) return;
    try { out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim()); } catch (_e) { /* ignore */ }
  });
  return out;
}

function bearerToken(request) {
  const header = request.headers.get("Authorization") || "";
  return /^bearer\s+/i.test(header) ? header.replace(/^bearer\s+/i, "").trim() : "";
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
function validateUsernameServer(raw) {
  const trimmed = String(raw == null ? "" : raw).normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!trimmed) return { ok: false, error: "Username is required." };
  if (trimmed.length < 3) return { ok: false, error: "Username must be at least 3 characters." };
  if (trimmed.length > 24) return { ok: false, error: "Username must be 24 characters or fewer." };
  if (!/^(?:[A-Za-z0-9 _-]|[\u0620-\u065F\u0660-\u0669\u066E-\u06D3\u06D5\u06EE-\u06FC\u06FF])+$/u.test(trimmed)) {
    return { ok: false, error: "Username can only contain letters, numbers, spaces, hyphens, or underscores." };
  }
  let moderation = null;
  try {
    moderation = require("./username-moderation.js");
  } catch (_e) {
    moderation = null;
  }
  if (moderation && typeof moderation.checkModeration === "function") {
    const modResult = moderation.checkModeration(trimmed);
    if (!modResult.ok) {
      return { ok: false, error: "Please choose another username." };
    }
  } else {
    // Never silently downgrade to a weaker filter if moderation cannot load.
    return { ok: false, error: "Username validation is temporarily unavailable. Please try again." };
  }
  if (RESERVED_USERNAMES.indexOf(trimmed.toLowerCase()) !== -1) {
    return { ok: false, error: "This username is reserved." };
  }
  return { ok: true, username: trimmed };
}

function safeId(value, max) {
  const s = String(value == null ? "" : value).trim();
  return s.length > 0 && s.length <= (max || 160) ? s : "";
}

// ---------------------------------------------------------------------------
// Rate limiting (re-uses `admin_rate_limits`, keyed by namespaced string)
// ---------------------------------------------------------------------------
async function rateLocked(env, key, now) {
  const row = await env.DB.prepare("SELECT locked_until FROM admin_rate_limits WHERE ip_address = ?1").bind(key).first();
  if (row && Number(row.locked_until) > now) return Math.ceil((Number(row.locked_until) - now) / 1000);
  return 0;
}

async function rateRecordFailure(env, key, now, maxFailures, windowMs, lockMs) {
  const row = await env.DB.prepare("SELECT failed_attempts, first_failed_at FROM admin_rate_limits WHERE ip_address = ?1").bind(key).first();
  const inWindow = row && now - Number(row.first_failed_at) < windowMs;
  const attempts = (inWindow ? Number(row.failed_attempts || 0) : 0) + 1;
  const firstAt = inWindow ? Number(row.first_failed_at) : now;
  const lockedUntil = attempts >= maxFailures ? now + lockMs : 0;
  await env.DB.prepare(
    "INSERT INTO admin_rate_limits (ip_address, failed_attempts, first_failed_at, locked_until) VALUES (?1, ?2, ?3, ?4) " +
    "ON CONFLICT(ip_address) DO UPDATE SET failed_attempts = ?2, first_failed_at = ?3, locked_until = ?4"
  ).bind(key, attempts, firstAt, lockedUntil).run();
  return { attempts: attempts, remaining: Math.max(0, maxFailures - attempts) };
}

async function rateClear(env, key) {
  await env.DB.prepare("DELETE FROM admin_rate_limits WHERE ip_address = ?1").bind(key).run();
}

const AUTH_IP_LIMIT = { max: 100, windowMs: 10 * 60 * 1000, lockMs: 10 * 60 * 1000 };
const AUTH_USER_LIMIT = { max: 8, windowMs: 10 * 60 * 1000, lockMs: 10 * 60 * 1000 };
const ADMIN_LIMIT = { max: 5, windowMs: 5 * 60 * 1000, lockMs: 5 * 60 * 1000 };
const ADMIN_GLOBAL_LIMIT = { max: 50, windowMs: 15 * 60 * 1000, lockMs: 15 * 60 * 1000 };
const GUEST_CREATE_LIMIT = { max: 300, windowMs: 10 * 60 * 1000, lockMs: 5 * 60 * 1000 };
const REPORT_SUBMIT_LIMIT = { max: 20, windowMs: 10 * 60 * 1000, lockMs: 5 * 60 * 1000 };
const ALLOWED_REPORT_REASONS = ["incorrect_answer", "typo", "missing_image", "unclear", "outdated", "other"];

// ---------------------------------------------------------------------------
// Sessions / authorization guards
// ---------------------------------------------------------------------------
/** Student session → { studentId, username, isAdmin, tokenHash } | null. */
async function getUserSession(request, env) {
  if (!env || !env.DB) return null;
  const token = bearerToken(request);
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare(
    "SELECT u.student_id AS studentId, u.username AS username, u.display_name AS displayName, u.is_admin AS isAdmin, u.password_hash AS passwordHash, us.expires_at AS expiresAt FROM user_sessions us " +
    "JOIN users u ON u.student_id = us.student_id WHERE us.token_hash = ?1 AND us.expires_at > ?2"
  ).bind(tokenHash, Date.now()).first();
  if (!row) return null;
  return { studentId: row.studentId, username: row.username, displayName: row.displayName || row.username, isAdmin: Number(row.isAdmin) === 1, guest: String(row.studentId).startsWith("gst_") && !row.passwordHash, tokenHash: tokenHash, expiresAt: Number(row.expiresAt || 0) };
}

/** Master-admin session (password login) → row | null. Student rows are never accepted. */
async function getMasterSession(request, env) {
  if (!env || !env.DB) return null;
  // A student Bearer token may accompany the admin cookie, so try every candidate.
  const candidates = [bearerToken(request), parseCookies(request.headers.get("Cookie") || "").mcq_admin_session || ""];
  for (let i = 0; i < candidates.length; i += 1) {
    if (!candidates[i]) continue;
    const row = await env.DB.prepare(
      "SELECT token_hash, expires_at FROM admin_sessions WHERE token_hash = ?1 AND expires_at > ?2 AND is_master_admin = 1 AND (student_id IS NULL OR student_id = '')"
    ).bind(await sha256Hex(candidates[i]), Date.now()).first();
    if (row) return row;
  }
  return null;
}

/** Master admin OR co-admin (student with users.is_admin = 1). */
async function requireAdmin(request, env) {
  const master = await getMasterSession(request, env);
  if (master) return { kind: "master", tokenHash: master.token_hash, expiresAt: master.expires_at };
  const user = await getUserSession(request, env);
  if (user && user.isAdmin) return { kind: "coadmin", studentId: user.studentId, username: user.username };
  return null;
}

async function requireMaster(request, env) {
  const master = await getMasterSession(request, env);
  return master ? { kind: "master", tokenHash: master.token_hash, expiresAt: master.expires_at } : null;
}

async function requireMasterAdmin(request, env) {
  const admin = await requireAdmin(request, env);
  if (!admin) return { ok: false, response: fail(401, "Admin authentication required.", "AUTH_REQUIRED") };
  if (admin.kind !== "master") return { ok: false, response: fail(403, "Master admin session required.", "FORBIDDEN") };
  return { ok: true, admin };
}

async function createUserSession(env, studentId) {
  const raw = generateSessionToken();
  const now = Date.now();
  await env.DB.prepare("INSERT INTO user_sessions (token_hash, student_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)")
    .bind(await sha256Hex(raw), studentId, now, now + USER_SESSION_TTL_MS).run();
  // housekeeping: drop expired rows and cap concurrent sessions per student
  await env.DB.prepare("DELETE FROM user_sessions WHERE expires_at < ?1").bind(now).run();
  await env.DB.prepare(
    "DELETE FROM user_sessions WHERE student_id = ?1 AND token_hash NOT IN " +
    "(SELECT token_hash FROM user_sessions WHERE student_id = ?1 ORDER BY created_at DESC LIMIT " + MAX_SESSIONS_PER_USER + ")"
  ).bind(studentId).run();
  return { token: raw, expiresAt: now + USER_SESSION_TTL_MS };
}

// ---------------------------------------------------------------------------
// Progress blob
// ---------------------------------------------------------------------------
const PROGRESS_FUTURE_TOLERANCE_MS = 300000;
const PROGRESS_EXTREME_FUTURE_MS = 365 * 24 * 60 * 60 * 1000;
const MAX_SYNC_PROTOCOL_VERSION = 3;
const MAX_CLIENT_GEN = 0xFFFFFFFF;
const MAX_CLIENT_SEQ = 0xFFFFFFFF;
const MAX_SYNC_OPS = 400;
const MAX_SYNC_FUTURE_OPS = 250;
const MAX_SYNC_CLIENTS = 64;
const MAX_SYNC_CLIENT_TABS = 12;
const MAX_PENDING_SYNC_REGS = 16;
const MAX_RAW_NORM_BUCKET = 200;
const MAX_RAW_SEEN_VALUES = 8;
const MAX_PROGRESS_CAS_RETRIES = 6;
const SYNC_ACTION_CODES = new Set(["bg", "mg", "bs", "ms", "bd", "md", "bi", "mi"]);

function parseProgressIsoMs(val) {
  if (!val || typeof val !== "string") return 0;
  const ms = Date.parse(val);
  return Number.isFinite(ms) ? ms : 0;
}

function safeMapKey(key, maxLen) {
  return typeof key === "string" &&
    key.length > 0 &&
    key.length <= (maxLen || 500) &&
    key !== "__proto__" &&
    key !== "constructor" &&
    key !== "prototype";
}

function safeOpId(val) {
  return typeof val === "string" && val.length > 0 && val.length <= 120 && /^[A-Za-z0-9_.:-]+$/.test(val) ? val : "";
}

function safeClientId(val) {
  return typeof val === "string" &&
    val.length >= 6 &&
    val.length <= 40 &&
    /^[A-Za-z0-9_-]+$/.test(val) &&
    val !== "__proto__" &&
    val !== "constructor" &&
    val !== "prototype"
    ? val
    : "";
}

function safeTabTag(val) {
  return typeof val === "string" &&
    val.length >= 2 &&
    val.length <= 16 &&
    /^[A-Za-z0-9_-]+$/.test(val) &&
    val !== "__proto__" &&
    val !== "constructor" &&
    val !== "prototype"
    ? val
    : "";
}

function fnv1a32(bytes, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < bytes.length; i += 1) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function opScopeSignature(actionCode, scopeKey) {
  const raw = String(actionCode || "") + "\x00" + String(scopeKey == null ? "" : scopeKey);
  const bytes = encodeUtf8Bytes(raw);
  return String(actionCode || "") + "_" + fnv1a32(bytes, 0x811c9dc5) + fnv1a32(bytes, 0x050c5d1f);
}

function parseVersionedOpId(val) {
  const id = safeOpId(val);
  if (!id) return null;
  if (id.indexOf("v3.") === 0) {
    const match = /^v3\.([A-Za-z0-9_-]{6,40})\.([0-9a-z]{1,7})\.([A-Za-z0-9_-]{2,16})\.([0-9a-z]{1,7})\.([a-z]{2}_[0-9a-f]{16})\.[A-Za-z0-9_-]{4,24}$/.exec(id);
    if (!match) return null;
    const clientId = safeClientId(match[1]);
    const tabTag = safeTabTag(match[3]);
    if (!clientId || !tabTag) return null;
    const gen = parseInt(match[2], 36);
    const seq = parseInt(match[4], 36);
    const provenance = match[5];
    const actionCode = provenance.slice(0, 2);
    if (!Number.isSafeInteger(gen) || gen < 1 || gen > MAX_CLIENT_GEN || gen.toString(36) !== match[2]) return null;
    if (!Number.isSafeInteger(seq) || seq < 1 || seq > MAX_CLIENT_SEQ || seq.toString(36) !== match[4]) return null;
    if (!SYNC_ACTION_CODES.has(actionCode)) return null;
    return { v: 3, clientId: clientId, gen: gen, tabTag: tabTag, seq: seq, actionCode: actionCode, provenance: provenance };
  }
  if (id.indexOf("v2.") === 0) {
    const match = /^v2\.([A-Za-z0-9_-]{6,40})\.([0-9a-z]{1,7})\.[A-Za-z0-9_-]{4,24}$/.exec(id);
    if (!match) return null;
    const clientId = safeClientId(match[1]);
    if (!clientId) return null;
    const seq = parseInt(match[2], 36);
    if (!Number.isSafeInteger(seq) || seq < 1 || seq > MAX_CLIENT_SEQ || seq.toString(36) !== match[2]) return null;
    return { v: 2, clientId: clientId, gen: 0, tabTag: "", seq: seq, actionCode: "", provenance: "" };
  }
  return null;
}

function isMalformedVersionedOpRaw(val) {
  return typeof val === "string" && (val.indexOf("v2.") === 0 || val.indexOf("v3.") === 0) && !parseVersionedOpId(val);
}

function isUnsupportedFutureOpRaw(val) {
  if (typeof val !== "string") return false;
  const m = /^v(\d+)\./.exec(val);
  return Boolean(m && Number(m[1]) > MAX_SYNC_PROTOCOL_VERSION);
}

function hasMalformedVersionedSlots(rawMeta) {
  if (!rawMeta || typeof rawMeta !== "object" || Array.isArray(rawMeta)) return false;
  const rawSlots = rawMeta.slots && typeof rawMeta.slots === "object" && !Array.isArray(rawMeta.slots) ? rawMeta.slots : {};
  if (isMalformedVersionedOpRaw(rawSlots.bmGlobal) || isMalformedVersionedOpRaw(rawSlots.mkGlobal)) return true;
  const maps = [rawSlots.bmSubj, rawSlots.mkSubj, rawSlots.bmDel, rawSlots.mkDel];
  for (let i = 0; i < maps.length; i++) {
    const src = maps[i];
    if (!src || typeof src !== "object" || Array.isArray(src)) continue;
    const vals = Object.values(src);
    for (let j = 0; j < vals.length; j++) {
      if (isMalformedVersionedOpRaw(vals[j])) return true;
    }
  }
  return false;
}

function hasUnsupportedFutureSlots(rawMeta) {
  if (!rawMeta || typeof rawMeta !== "object" || Array.isArray(rawMeta)) return false;
  const rawSlots = rawMeta.slots && typeof rawMeta.slots === "object" && !Array.isArray(rawMeta.slots) ? rawMeta.slots : {};
  if (isUnsupportedFutureOpRaw(rawSlots.bmGlobal) || isUnsupportedFutureOpRaw(rawSlots.mkGlobal)) return true;
  const maps = [rawSlots.bmSubj, rawSlots.mkSubj, rawSlots.bmDel, rawSlots.mkDel];
  for (let i = 0; i < maps.length; i++) {
    const src = maps[i];
    if (!src || typeof src !== "object" || Array.isArray(src)) continue;
    const vals = Object.values(src);
    for (let j = 0; j < vals.length; j++) {
      if (isUnsupportedFutureOpRaw(vals[j])) return true;
    }
  }
  return false;
}

function readSyncSlotsObject(rawMeta) {
  const meta = rawMeta && typeof rawMeta === "object" && !Array.isArray(rawMeta) ? rawMeta : {};
  const rawSlots = meta.slots && typeof meta.slots === "object" && !Array.isArray(meta.slots) ? meta.slots : {};
  const readSlotMap = function (src, maxKeyLen) {
    const out = {};
    if (!src || typeof src !== "object" || Array.isArray(src)) return out;
    for (const [k, v] of Object.entries(src)) {
      if (!safeMapKey(k, maxKeyLen)) continue;
      const id = safeOpId(v);
      if (id) out[k] = id;
    }
    return out;
  };
  return {
    bmGlobal: safeOpId(rawSlots.bmGlobal),
    mkGlobal: safeOpId(rawSlots.mkGlobal),
    bmSubj: readSlotMap(rawSlots.bmSubj, 160),
    mkSubj: readSlotMap(rawSlots.mkSubj, 160),
    bmDel: readSlotMap(rawSlots.bmDel, 500),
    mkDel: readSlotMap(rawSlots.mkDel, 500),
  };
}

function cloneRawNormEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const maxRawMs = Number(entry.maxRawMs);
  const effMs = Number(entry.effMs);
  if (!Number.isFinite(maxRawMs) || maxRawMs <= 0 || !Number.isFinite(effMs) || effMs < 0) return null;
  const seen = {};
  if (entry.seen && typeof entry.seen === "object" && !Array.isArray(entry.seen)) {
    const pairs = Object.entries(entry.seen).filter(function (pair) {
      return /^\d+$/.test(pair[0]) && Number.isFinite(Number(pair[1])) && Number(pair[1]) >= 0;
    });
    pairs.sort(function (a, b) { return Number(b[0]) - Number(a[0]); });
    for (let i = 0; i < Math.min(pairs.length, MAX_RAW_SEEN_VALUES); i++) {
      seen[pairs[i][0]] = Number(pairs[i][1]);
    }
  }
  return { maxRawMs: maxRawMs, effMs: effMs, seen: seen };
}

function recordRawNormEntry(existing, rawMs, effMs) {
  const base = cloneRawNormEntry(existing) || { maxRawMs: 0, effMs: 0, seen: {} };
  const rawKey = String(rawMs);
  if (rawMs >= base.maxRawMs) {
    base.maxRawMs = rawMs;
    base.effMs = effMs;
  }
  base.seen[rawKey] = effMs;
  const pairs = Object.entries(base.seen);
  if (pairs.length > MAX_RAW_SEEN_VALUES) {
    pairs.sort(function (a, b) { return Number(b[0]) - Number(a[0]); });
    const trimmed = {};
    for (let i = 0; i < MAX_RAW_SEEN_VALUES; i++) trimmed[pairs[i][0]] = Number(pairs[i][1]);
    base.seen = trimmed;
  }
  return base;
}

function trimClientTabsMap(tabsMap, limit, currentEvictedTabEpoch) {
  const entries = Object.entries(tabsMap || {});
  let nextEvictedTabEpoch = Number.isSafeInteger(currentEvictedTabEpoch) && currentEvictedTabEpoch > 0 ? currentEvictedTabEpoch : 0;
  const cloneEntry = function (val) {
    return {
      s: Math.min(MAX_CLIENT_SEQ, Math.max(0, Number(val && val.s) || 0)),
      e: Math.max(0, Number(val && val.e) || 0),
    };
  };
  if (entries.length <= limit) {
    const copy = {};
    for (let i = 0; i < entries.length; i++) copy[entries[i][0]] = cloneEntry(entries[i][1]);
    return { tabs: copy, evictedTabEpoch: nextEvictedTabEpoch };
  }
  entries.sort(function (a, b) {
    const eDiff = (Number(b[1] && b[1].e) || 0) - (Number(a[1] && a[1].e) || 0);
    if (eDiff !== 0) return eDiff;
    return a[0] < b[0] ? -1 : (a[0] > b[0] ? 1 : 0);
  });
  const out = {};
  for (let i = 0; i < entries.length; i++) {
    if (i < limit) {
      out[entries[i][0]] = cloneEntry(entries[i][1]);
    } else {
      const evE = Number(entries[i][1] && entries[i][1].e) || 0;
      if (evE > nextEvictedTabEpoch) nextEvictedTabEpoch = evE;
    }
  }
  return { tabs: out, evictedTabEpoch: nextEvictedTabEpoch };
}

function cloneClientRecord(entry) {
  const src = entry && typeof entry === "object" ? entry : {};
  const g = Number.isSafeInteger(Number(src.g)) && Number(src.g) >= 0 && Number(src.g) <= MAX_CLIENT_GEN ? Number(src.g) : 0;
  const s = Number.isSafeInteger(Number(src.s)) && Number(src.s) >= 0 ? Math.min(MAX_CLIENT_SEQ, Number(src.s)) : 0;
  const e = Number.isSafeInteger(Number(src.e)) && Number(src.e) >= 0 ? Number(src.e) : 0;
  const b = Number.isSafeInteger(Number(src.b)) && Number(src.b) >= 0 ? Number(src.b) : 0;
  const ack = g >= 1 && (src.ack === 1 || src.ack === true) ? 1 : 0;
  const rawEvTab = Number(src.evictedTabEpoch);
  const evictedTabEpoch = Number.isSafeInteger(rawEvTab) && rawEvTab >= 0 ? rawEvTab : 0;
  const tabsRaw = {};
  if (src.tabs && typeof src.tabs === "object" && !Array.isArray(src.tabs)) {
    for (const [tt, tVal] of Object.entries(src.tabs)) {
      const cleanTab = safeTabTag(tt);
      if (!cleanTab || !tVal || typeof tVal !== "object" || Array.isArray(tVal)) continue;
      const ts = Number(tVal.s);
      const te = Number(tVal.e);
      if (!Number.isSafeInteger(ts) || ts < 0 || !Number.isSafeInteger(te) || te < 0) continue;
      tabsRaw[cleanTab] = { s: Math.min(MAX_CLIENT_SEQ, ts), e: te };
    }
  }
  const trimmedTabs = trimClientTabsMap(tabsRaw, MAX_SYNC_CLIENT_TABS, evictedTabEpoch);
  const out = { s: s, e: e };
  if (g > 0) out.g = g;
  if (b > 0) out.b = b;
  if (ack === 1) out.ack = 1;
  if (trimmedTabs.evictedTabEpoch > 0) out.evictedTabEpoch = trimmedTabs.evictedTabEpoch;
  if (Object.keys(trimmedTabs.tabs).length) out.tabs = trimmedTabs.tabs;
  return out;
}

function trimClientsMap(clientsMap, limit, currentEvictedEpoch) {
  const entries = Object.entries(clientsMap || {});
  let nextEvictedEpoch = Number.isSafeInteger(currentEvictedEpoch) && currentEvictedEpoch > 0 ? currentEvictedEpoch : 0;
  if (entries.length <= limit) {
    const outSame = {};
    for (let i = 0; i < entries.length; i++) outSame[entries[i][0]] = cloneClientRecord(entries[i][1]);
    return { clients: outSame, evictedClientEpoch: nextEvictedEpoch };
  }
  entries.sort(function (a, b) {
    const eDiff = (Number(b[1] && b[1].e) || 0) - (Number(a[1] && a[1].e) || 0);
    if (eDiff !== 0) return eDiff;
    return a[0] < b[0] ? -1 : (a[0] > b[0] ? 1 : 0);
  });
  const out = {};
  for (let i = 0; i < entries.length; i++) {
    if (i < limit) {
      out[entries[i][0]] = cloneClientRecord(entries[i][1]);
    } else {
      const evE = Number(entries[i][1] && entries[i][1].e) || 0;
      if (evE > nextEvictedEpoch) nextEvictedEpoch = evE;
    }
  }
  return { clients: out, evictedClientEpoch: nextEvictedEpoch };
}

function pendingRegKey(clientId, tabTag) {
  return String(clientId || "") + ":" + String(tabTag || "");
}

function trimPendingRegsMap(pendingMap, limit) {
  const entries = Object.entries(pendingMap || {});
  if (entries.length <= limit) return Object.assign({}, pendingMap || {});
  entries.sort(function (a, b) {
    const eDiff = (Number(b[1] && b[1].e) || 0) - (Number(a[1] && a[1].e) || 0);
    if (eDiff !== 0) return eDiff;
    return a[0] < b[0] ? -1 : (a[0] > b[0] ? 1 : 0);
  });
  const out = {};
  for (let i = 0; i < limit; i++) out[entries[i][0]] = entries[i][1];
  return out;
}

function sanitizeSyncMetaFromCloud(rawMeta, mergeNowMs) {
  const meta = rawMeta && typeof rawMeta === "object" && !Array.isArray(rawMeta) ? rawMeta : {};
  const maxAllowedEff = mergeNowMs + PROGRESS_FUTURE_TOLERANCE_MS;
  const readOpMap = function (src) {
    const out = {};
    if (!src || typeof src !== "object" || Array.isArray(src)) return out;
    for (const [k, v] of Object.entries(src)) {
      const id = safeOpId(k);
      const ms = Number(v);
      if (!id || !Number.isFinite(ms) || ms < 0 || ms > maxAllowedEff) continue;
      out[id] = ms;
    }
    return out;
  };
  const ops = readOpMap(meta.ops);
  const futureOps = readOpMap(meta.futureOps);
  const combinedOps = Object.assign({}, ops, futureOps);
  const slots = readSyncSlotsObject(meta);

  const rawClients = meta.clients && typeof meta.clients === "object" && !Array.isArray(meta.clients) ? meta.clients : {};
  const clientsRaw = {};
  let maxClientGen = 0;
  for (const [cid, entry] of Object.entries(rawClients)) {
    const cleanCid = safeClientId(cid);
    if (!cleanCid || !entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const s = Number(entry.s);
    const e = Number(entry.e);
    if (!Number.isSafeInteger(s) || s < 0 || !Number.isSafeInteger(e) || e < 0) continue;
    const cloned = cloneClientRecord(entry);
    if ((cloned.g || 0) > maxClientGen) maxClientGen = cloned.g || 0;
    clientsRaw[cleanCid] = cloned;
  }

  const rawPendingRegs = meta.pendingRegs && typeof meta.pendingRegs === "object" && !Array.isArray(meta.pendingRegs) ? meta.pendingRegs : {};
  const pendingRegsRaw = {};
  let maxPendingGen = 0;
  for (const [pkey, reg] of Object.entries(rawPendingRegs)) {
    if (!reg || typeof reg !== "object" || Array.isArray(reg)) continue;
    const keyParts = String(pkey || "").split(":");
    const cleanCid = safeClientId(reg.c || (keyParts.length === 2 ? keyParts[0] : ""));
    const cleanTab = safeTabTag(reg.tab || (keyParts.length === 2 ? keyParts[1] : ""));
    if (!cleanCid || !cleanTab) continue;
    const g = Number(reg.g);
    const b = Number(reg.b);
    const e = Number(reg.e);
    const t = typeof reg.t === "string" && /^[a-f0-9]{8,32}$/.test(reg.t) ? reg.t : "";
    const a = safeId(reg.a, 120);
    if (!Number.isSafeInteger(g) || g < 1 || g > MAX_CLIENT_GEN || !Number.isSafeInteger(b) || b < 0 || !Number.isSafeInteger(e) || e < 0 || !t) continue;
    if (g > maxPendingGen) maxPendingGen = g;
    const canonKey = pendingRegKey(cleanCid, cleanTab);
    const rec = { c: cleanCid, tab: cleanTab, g: g, b: b, t: t, e: e };
    if (a) rec.a = a;
    pendingRegsRaw[canonKey] = rec;
  }
  const pendingRegs = trimPendingRegsMap(pendingRegsRaw, MAX_PENDING_SYNC_REGS);

  const rawEpoch = Number(meta.epoch);
  const epoch = Number.isSafeInteger(rawEpoch) && rawEpoch >= 0 ? rawEpoch : 0;
  const rawEvictedClientEpoch = Number(meta.evictedClientEpoch);
  const evictedClientEpoch = Number.isSafeInteger(rawEvictedClientEpoch) && rawEvictedClientEpoch >= 0 ? rawEvictedClientEpoch : 0;
  const trimmedClients = trimClientsMap(clientsRaw, MAX_SYNC_CLIENTS, evictedClientEpoch);
  const rawNextGen = Number(meta.nextGen);
  const nextGen = Math.min(
    MAX_CLIENT_GEN,
    Math.max(
      Number.isSafeInteger(rawNextGen) && rawNextGen >= 1 ? rawNextGen : 1,
      maxClientGen + 1,
      maxPendingGen + 1,
      1
    )
  );
  const rawV = Number(meta.v);
  const v = Number.isFinite(rawV) && rawV >= 3 ? 3 : (Number.isFinite(rawV) && rawV >= 2 ? 2 : 1);
  const versioned = v >= 2 || epoch > 0 || trimmedClients.evictedClientEpoch > 0 || Object.keys(trimmedClients.clients).length > 0;
  const hardenedV3 = v >= 3 || maxClientGen >= 1 || maxPendingGen >= 1;

  const rawNormSrc = meta.rawNorm && typeof meta.rawNorm === "object" && !Array.isArray(meta.rawNorm) ? meta.rawNorm : {};
  const readRawMap = function (src, maxKeyLen) {
    const out = {};
    if (!src || typeof src !== "object" || Array.isArray(src)) return out;
    for (const [k, v] of Object.entries(src)) {
      if (!safeMapKey(k, maxKeyLen)) continue;
      const cloned = cloneRawNormEntry(v);
      if (cloned && cloned.effMs <= maxAllowedEff) out[k] = cloned;
    }
    return out;
  };
  const rawNorm = {
    bmGlobal: cloneRawNormEntry(rawNormSrc.bmGlobal),
    mkGlobal: cloneRawNormEntry(rawNormSrc.mkGlobal),
    bmSubj: readRawMap(rawNormSrc.bmSubj, 160),
    mkSubj: readRawMap(rawNormSrc.mkSubj, 160),
    bmDel: readRawMap(rawNormSrc.bmDel, 500),
    mkDel: readRawMap(rawNormSrc.mkDel, 500),
    bmItem: readRawMap(rawNormSrc.bmItem, 500),
    mkItem: readRawMap(rawNormSrc.mkItem, 500),
  };
  if (rawNorm.bmGlobal && rawNorm.bmGlobal.effMs > maxAllowedEff) rawNorm.bmGlobal = null;
  if (rawNorm.mkGlobal && rawNorm.mkGlobal.effMs > maxAllowedEff) rawNorm.mkGlobal = null;

  return {
    v: v,
    versioned: versioned,
    hardenedV3: hardenedV3,
    epoch: epoch,
    nextGen: nextGen,
    evictedClientEpoch: trimmedClients.evictedClientEpoch,
    clients: trimmedClients.clients,
    pendingRegs: pendingRegs,
    ops: ops,
    futureOps: futureOps,
    combinedOps: combinedOps,
    slots: slots,
    rawNorm: rawNorm,
  };
}

function sanitizeSlotsFromLocal(rawMeta) {
  const slots = readSyncSlotsObject(rawMeta);
  const meta = rawMeta && typeof rawMeta === "object" && !Array.isArray(rawMeta) ? rawMeta : {};
  const clientId = safeClientId(meta.clientId);
  const tabTag = safeTabTag(meta.tabTag);
  const rawGen = Number(meta.clientGen);
  const clientGen = Number.isSafeInteger(rawGen) && rawGen >= 0 && rawGen <= MAX_CLIENT_GEN ? rawGen : 0;
  const rawClientSeq = Number(meta.clientSeq);
  const seqOverflow = Number.isFinite(rawClientSeq) && rawClientSeq > MAX_CLIENT_SEQ;
  const clientSeq = Number.isSafeInteger(rawClientSeq) && rawClientSeq >= 0 && rawClientSeq <= MAX_CLIENT_SEQ ? rawClientSeq : 0;
  const rawV = meta.v !== undefined ? Number(meta.v) : 0;
  const unsupportedVersion = (Number.isFinite(rawV) && rawV > MAX_SYNC_PROTOCOL_VERSION) || hasUnsupportedFutureSlots(rawMeta);
  return {
    v: Number.isFinite(rawV) && rawV >= 1 ? Math.floor(rawV) : 0,
    bmGlobal: slots.bmGlobal,
    mkGlobal: slots.mkGlobal,
    bmSubj: slots.bmSubj,
    mkSubj: slots.mkSubj,
    bmDel: slots.bmDel,
    mkDel: slots.mkDel,
    clientId: clientId,
    tabTag: tabTag,
    clientGen: clientGen,
    clientSeq: clientSeq,
    seqOverflow: seqOverflow,
    unsupportedVersion: unsupportedVersion,
    malformed: hasMalformedVersionedSlots(rawMeta),
  };
}

function trimOpMap(opMap, limit, priorityPinnedIds, secondaryPinnedIds) {
  const entries = Object.entries(opMap || {});
  if (entries.length <= limit) return opMap;
  const primary = priorityPinnedIds || new Set();
  const secondary = secondaryPinnedIds || new Set();
  const tier1 = [];
  const tier2 = [];
  const rest = [];
  for (let i = 0; i < entries.length; i++) {
    const id = entries[i][0];
    if (primary.has(id)) tier1.push(entries[i]);
    else if (secondary.has(id)) tier2.push(entries[i]);
    else rest.push(entries[i]);
  }
  const byTimeDesc = function (a, b) { return Number(b[1]) - Number(a[1]); };
  tier1.sort(byTimeDesc);
  tier2.sort(byTimeDesc);
  rest.sort(byTimeDesc);
  const out = {};
  const ordered = tier1.concat(tier2, rest);
  for (let i = 0; i < Math.min(ordered.length, limit); i++) {
    out[ordered[i][0]] = ordered[i][1];
  }
  return out;
}

function trimRawNormMap(rawMap, limit) {
  const entries = Object.entries(rawMap || {});
  if (entries.length <= limit) return rawMap;
  entries.sort(function (a, b) { return Number(b[1].effMs || 0) - Number(a[1].effMs || 0); });
  const out = {};
  for (let i = 0; i < limit; i++) out[entries[i][0]] = entries[i][1];
  return out;
}

function publicProgressForClient(progress) {
  if (!progress || typeof progress !== "object" || Array.isArray(progress)) return progress;
  const out = Object.assign({}, progress);
  if (out.syncMeta && typeof out.syncMeta === "object") {
    const ops = Object.assign({}, out.syncMeta.ops || {}, out.syncMeta.futureOps || {});
    const slots = out.syncMeta.slots && typeof out.syncMeta.slots === "object" ? out.syncMeta.slots : {};
    const rawV = Number(out.syncMeta.v);
    const v = rawV >= 3 ? 3 : (rawV >= 2 ? 2 : 1);
    const epoch = Number.isSafeInteger(Number(out.syncMeta.epoch)) && Number(out.syncMeta.epoch) >= 0 ? Number(out.syncMeta.epoch) : 0;
    const hasOps = Object.keys(ops).length > 0;
    const hasSlots = Boolean(
      slots.bmGlobal ||
      slots.mkGlobal ||
      (slots.bmSubj && Object.keys(slots.bmSubj).length) ||
      (slots.mkSubj && Object.keys(slots.mkSubj).length) ||
      (slots.bmDel && Object.keys(slots.bmDel).length) ||
      (slots.mkDel && Object.keys(slots.mkDel).length)
    );
    if (hasOps || hasSlots || v >= 2 || epoch > 0) {
      const pubMeta = { v: v, ops: ops, slots: slots };
      if (epoch > 0) pubMeta.epoch = epoch;
      out.syncMeta = pubMeta;
    } else {
      delete out.syncMeta;
    }
  }
  return out;
}

function sanitizeStoredProgressOnRead(progress, nowMs) {
  if (!progress || typeof progress !== "object" || Array.isArray(progress)) return {};
  const refNow = Number(nowMs) || Date.now();
  const maxReasonable = refNow + PROGRESS_FUTURE_TOLERANCE_MS;
  const fallbackPastIso = new Date(Math.max(1, refNow - 5000)).toISOString();
  const out = Object.assign({}, progress);

  const cleanScalarWatermark = function (val) {
    const ms = parseProgressIsoMs(val);
    if (!ms || ms > maxReasonable) return null;
    return val;
  };
  const cleanMap = function (src, maxEntries, maxKeyLen) {
    const res = {};
    if (!src || typeof src !== "object" || Array.isArray(src)) return res;
    for (const [k, v] of Object.entries(src)) {
      if (!safeMapKey(k, maxKeyLen) || typeof v !== "string") continue;
      const ms = parseProgressIsoMs(v);
      if (!ms || ms > maxReasonable) continue;
      res[k] = v;
    }
    const entries = Object.entries(res);
    if (entries.length <= maxEntries) return res;
    entries.sort(function (a, b) { return parseProgressIsoMs(b[1]) - parseProgressIsoMs(a[1]); });
    const trimmed = {};
    for (let i = 0; i < maxEntries; i++) trimmed[entries[i][0]] = entries[i][1];
    return trimmed;
  };

  const bmCleared = cleanScalarWatermark(out.bookmarksClearedAt);
  if (bmCleared) out.bookmarksClearedAt = bmCleared;
  else delete out.bookmarksClearedAt;
  const bmSubj = cleanMap(out.bookmarksClearedAtBySubject, 200, 160);
  if (Object.keys(bmSubj).length) out.bookmarksClearedAtBySubject = bmSubj;
  else delete out.bookmarksClearedAtBySubject;
  out.deletedBookmarks = cleanMap(out.deletedBookmarks, 500, 500);

  const mkCleared = cleanScalarWatermark(out.mistakesClearedAt);
  if (mkCleared) out.mistakesClearedAt = mkCleared;
  else delete out.mistakesClearedAt;
  const mkSubj = cleanMap(out.mistakesClearedAtBySubject, 200, 160);
  if (Object.keys(mkSubj).length) out.mistakesClearedAtBySubject = mkSubj;
  else delete out.mistakesClearedAtBySubject;
  out.deletedMistakes = cleanMap(out.deletedMistakes, 500, 500);

  if (Array.isArray(out.bookmarks)) {
    out.bookmarks = out.bookmarks.map(function (b) {
      if (!b || typeof b !== "object") return b;
      const ms = parseProgressIsoMs(b.savedAt);
      if (ms > maxReasonable) return Object.assign({}, b, { savedAt: fallbackPastIso });
      return b;
    });
  }
  const sanitizeMistakeItem = function (m) {
    if (!m || typeof m !== "object") return m;
    const ms = progressMistakeTimestampMs(m);
    if (ms <= maxReasonable) return m;
    return clampMistakeTimestampsToMs(m, Math.max(1, refNow - 5000));
  };
  if (Array.isArray(out.mistakes)) {
    out.mistakes = out.mistakes.map(sanitizeMistakeItem);
  } else if (out.mistakes && typeof out.mistakes === "object" && Array.isArray(out.mistakes.items)) {
    out.mistakes = Object.assign({}, out.mistakes, { items: out.mistakes.items.map(sanitizeMistakeItem) });
  }
  return out;
}

function clampMistakeTimestampsToMs(item, targetMs) {
  const iso = new Date(targetMs).toISOString();
  const next = Object.assign({}, item, { updatedAt: iso });
  if (item.resolvedAt && parseProgressIsoMs(item.resolvedAt) > targetMs) next.resolvedAt = iso;
  else if (isMistakeItemResolved(item) && item.resolvedAt) next.resolvedAt = iso;
  if (item.lastAttemptedAt && parseProgressIsoMs(item.lastAttemptedAt) > targetMs) next.lastAttemptedAt = iso;
  if (item.firstFailedAt && parseProgressIsoMs(item.firstFailedAt) > targetMs) next.firstFailedAt = iso;
  if (Array.isArray(item.attempts)) {
    next.attempts = item.attempts.map(function (entry) {
      if (!entry || typeof entry !== "object") return entry;
      if (parseProgressIsoMs(entry.at) > targetMs) return Object.assign({}, entry, { at: iso });
      return entry;
    });
  }
  return next;
}

function resolveProgressSubjectId(item) {
  if (!item || typeof item !== "object") return "";
  if (typeof item.subjectId === "string" && item.subjectId.trim()) return item.subjectId.trim();
  const rawId = String(item.internalId || item.id || item.questionId || "");
  const sep = rawId.indexOf("::");
  return sep > 0 ? rawId.slice(0, sep).trim() : "";
}

function progressBookmarkIdentity(item) {
  if (!item || typeof item !== "object") return JSON.stringify(item);
  return String(item.internalId || item.id || item.questionId || JSON.stringify(item));
}

function progressMistakeIdentity(item) {
  if (!item || typeof item !== "object") return JSON.stringify(item);
  return String(item.internalId || item.questionId || item.id || JSON.stringify(item));
}

function progressMistakeTimestampMs(item) {
  if (!item || typeof item !== "object") return 0;
  return Math.max(
    parseProgressIsoMs(item.updatedAt),
    parseProgressIsoMs(item.lastAttemptedAt),
    parseProgressIsoMs(item.resolvedAt)
  );
}

function isMistakeItemResolved(item) {
  if (!item || typeof item !== "object") return false;
  return item.status === "resolved" || (item.status !== "unresolved" && Boolean(item.resolved));
}

function fillMissingFields(target, source, fields) {
  for (const key of fields) {
    if ((target[key] === undefined || target[key] === null || target[key] === "") && source[key] !== undefined && source[key] !== null && source[key] !== "") {
      target[key] = source[key];
    }
  }
}

function mergeMistakePair(prev, next, prevMsOverride, nextMsOverride, preferPrevOnTie) {
  const prevMs = prevMsOverride !== undefined ? prevMsOverride : progressMistakeTimestampMs(prev);
  const nextMs = nextMsOverride !== undefined ? nextMsOverride : progressMistakeTimestampMs(next);
  const nextWins = nextMs > prevMs || (nextMs === prevMs && !preferPrevOnTie);
  const newer = nextWins ? next : prev;
  const older = newer === prev ? next : prev;
  const mergedItem = Object.assign({}, older, newer);
  fillMissingFields(mergedItem, older, [
    "id", "internalId", "originalQuestionId", "subjectId", "subjectName",
    "quizId", "collectionId", "question", "questionText", "image",
    "correctOptionId", "lastWrongOptionId", "selectedOptionId", "firstFailedAt"
  ]);
  if ((!Array.isArray(mergedItem.images) || !mergedItem.images.length) && Array.isArray(older.images) && older.images.length) {
    mergedItem.images = older.images;
  }
  const firstAt = [older.firstFailedAt, newer.firstFailedAt].filter(Boolean).sort(function (a, b) {
    return parseProgressIsoMs(a) - parseProgressIsoMs(b);
  })[0];
  if (firstAt) mergedItem.firstFailedAt = firstAt;
  const maxMiss = Math.max(Number(older.failureCount || older.missCount || 1), Number(newer.failureCount || newer.missCount || 1));
  if ("failureCount" in older || "failureCount" in newer || maxMiss > 1) mergedItem.failureCount = maxMiss;
  if ("missCount" in older || "missCount" in newer) mergedItem.missCount = maxMiss;
  if (Array.isArray(older.attempts) || Array.isArray(newer.attempts)) {
    const seenAt = new Set();
    mergedItem.attempts = (older.attempts || []).concat(newer.attempts || []).filter(function (entry) {
      if (!entry || typeof entry !== "object") return false;
      const sig = String(entry.at || "") + "::" + String(entry.selectedOptionId || "");
      if (seenAt.has(sig)) return false;
      seenAt.add(sig);
      return true;
    }).sort(function (a, b) { return parseProgressIsoMs(a.at) - parseProgressIsoMs(b.at); }).slice(-25);
  }
  const resolvedFlag = isMistakeItemResolved(newer);
  mergedItem.status = resolvedFlag ? "resolved" : "unresolved";
  if ("resolved" in older || "resolved" in newer) mergedItem.resolved = resolvedFlag;
  return mergedItem;
}

function buildSyncResyncResult(reason, cloud, mergeNowMs, cloudEpoch) {
  const r = reason || "SYNC_RESYNC_REQUIRED";
  const isUpgrade = r === "CLIENT_UPGRADE_REQUIRED" ||
    r === "LEGACY_DESTRUCTIVE_OP_REJECTED" ||
    r === "LEGACY_FUTURE_CLEAR_REJECTED" ||
    r === "LEGACY_FUTURE_ITEM_REJECTED" ||
    r === "UNSUPPORTED_SYNC_VERSION";
  let errMsg = "Synchronization requires reconciling with cloud progress before applying this operation.";
  if (r === "UNSUPPORTED_SYNC_VERSION") {
    errMsg = "This tab uses an unsupported sync protocol version. Refresh the page to resynchronize.";
  } else if (isUpgrade) {
    errMsg = "This tab is using an outdated sync format. Refresh the page to update before clearing or deleting items.";
  } else if (r === "OP_PROVENANCE_MISMATCH" || r === "INVALID_VERSIONED_OP" || r === "CLIENT_IDENTITY_MISMATCH") {
    errMsg = "Operation identity mismatch detected. Refresh cloud progress and try again.";
  }
  return {
    ok: false,
    code: r === "UNSUPPORTED_SYNC_VERSION" ? "UNSUPPORTED_SYNC_VERSION" : "SYNC_RESYNC_REQUIRED",
    reason: r,
    actionRequired: isUpgrade ? "REFRESH_APP" : "RECONCILE_AND_REVIEW",
    protocolVersion: MAX_SYNC_PROTOCOL_VERSION,
    minSupportedVersion: MAX_SYNC_PROTOCOL_VERSION,
    upgradeRecommended: isUpgrade,
    error: errMsg,
    serverTime: mergeNowMs,
    syncEpoch: cloudEpoch,
    cloudProgress: cloud,
  };
}

function mergeProgressWithStatus(localProgress, cloudProgress, nowMs, opts) {
  const o = opts || {};
  const mergeNowMs = Number(nowMs) || Date.now();
  const maxReasonableMs = mergeNowMs + PROGRESS_FUTURE_TOLERANCE_MS;
  const extremeFutureMs = mergeNowMs + PROGRESS_EXTREME_FUTURE_MS;
  const legacyFallbackPastMs = Math.max(1, mergeNowMs - 5000);

  const local = localProgress && typeof localProgress === "object" ? localProgress : {};
  const cloud = cloudProgress && typeof cloudProgress === "object" ? cloudProgress : {};
  const merged = Object.assign({}, cloud, local);
  ["stats", "lectureStats", "sheetStats"].forEach(function (key) {
    const left = cloud[key] && typeof cloud[key] === "object" ? cloud[key] : {};
    const right = local[key] && typeof local[key] === "object" ? local[key] : {};
    const historyKey = key === "stats" ? "quizHistory" : key === "lectureStats" ? "lectureQuizHistory" : "sheetQuizHistory";
    merged[key] = Object.assign({}, left, right, {
      [historyKey]: Object.assign({}, left[historyKey] || {}, right[historyKey] || {}),
      totalAttempts: Math.max(Number(left.totalAttempts) || 0, Number(right.totalAttempts) || 0)
    });
  });

  const cloudMeta = sanitizeSyncMetaFromCloud(cloud.syncMeta, mergeNowMs);
  const localSlots = sanitizeSlotsFromLocal(local.syncMeta);
  const authClientId = safeClientId(o.authClientId || localSlots.clientId || "");
  const authTabTag = safeTabTag(o.authTabTag || localSlots.tabTag || "");
  const authClientGen = Number.isSafeInteger(Number(o.authClientGen)) && Number(o.authClientGen) > 0
    ? Number(o.authClientGen)
    : localSlots.clientGen;
  const registerClientMode = o.registerClientMode || "";
  const nextOps = Object.assign({}, cloudMeta.ops);
  const nextFutureOps = Object.assign({}, cloudMeta.futureOps);
  const nextClients = {};
  Object.keys(cloudMeta.clients).forEach(function (cid) {
    nextClients[cid] = cloneClientRecord(cloudMeta.clients[cid]);
  });
  const nextPendingRegs = Object.assign({}, cloudMeta.pendingRegs);
  const nextRawNorm = {
    bmGlobal: cloneRawNormEntry(cloudMeta.rawNorm.bmGlobal),
    mkGlobal: cloneRawNormEntry(cloudMeta.rawNorm.mkGlobal),
    bmSubj: Object.assign({}, cloudMeta.rawNorm.bmSubj),
    mkSubj: Object.assign({}, cloudMeta.rawNorm.mkSubj),
    bmDel: Object.assign({}, cloudMeta.rawNorm.bmDel),
    mkDel: Object.assign({}, cloudMeta.rawNorm.mkDel),
    bmItem: Object.assign({}, cloudMeta.rawNorm.bmItem),
    mkItem: Object.assign({}, cloudMeta.rawNorm.mkItem),
  };

  let resyncRequired = false;
  let resyncReason = "";
  const pendingTabUpdates = {};
  let sawVersionedInput = Boolean(registerClientMode && authClientId);
  let sawV3Input = Boolean(authClientId && (registerClientMode === "initial" || registerClientMode === "auth"));
  const flagResync = function (reason) {
    resyncRequired = true;
    if (!resyncReason) resyncReason = reason;
  };
  const noteTabSeq = function (clientId, gen, tabTag, seq) {
    if (!clientId || !tabTag || !Number.isSafeInteger(gen) || gen < 1 || !Number.isSafeInteger(seq) || seq < 1) return;
    if (!pendingTabUpdates[clientId]) pendingTabUpdates[clientId] = { gen: gen, tabs: {}, maxSeq: 0 };
    const rec = pendingTabUpdates[clientId];
    if (!rec.tabs[tabTag] || seq > rec.tabs[tabTag]) rec.tabs[tabTag] = seq;
    if (seq > rec.maxSeq) rec.maxSeq = seq;
  };

  if (localSlots.unsupportedVersion) {
    flagResync("UNSUPPORTED_SYNC_VERSION");
  }
  if (localSlots.malformed) {
    flagResync("INVALID_VERSIONED_OP");
  }
  if (localSlots.seqOverflow) {
    flagResync("CLIENT_SEQ_ROLLOVER_REQUIRED");
  }
  if (o.authClientId && localSlots.clientId && o.authClientId !== localSlots.clientId) {
    flagResync("CLIENT_IDENTITY_MISMATCH");
  }
  if (Number.isSafeInteger(Number(o.authClientGen)) && Number(o.authClientGen) > 0 && localSlots.clientGen > 0 && Number(o.authClientGen) !== localSlots.clientGen) {
    flagResync("CLIENT_GENERATION_MISMATCH");
  }
  if (!registerClientMode && authClientId && authClientGen >= 1) {
    const acRec = cloudMeta.clients[authClientId];
    if (!acRec || acRec.ack !== 1) {
      flagResync(cloudMeta.evictedClientEpoch > 0 ? "CLIENT_HISTORY_EVICTED" : "CLIENT_RECONCILE_REQUIRED");
    } else if (acRec.g !== authClientGen) {
      flagResync("CLIENT_GENERATION_MISMATCH");
    } else if (authTabTag && (!acRec.tabs || !acRec.tabs[authTabTag]) && acRec.evictedTabEpoch > 0) {
      flagResync("TAB_HISTORY_EVICTED");
    }
  }

  // Track slot provenance of every op currently active in cloud so historical v2/v1 ops cannot jump slots.
  const usedSlotByOp = Object.create(null);
  const recordCloudUsedOp = function (opId, kind, key) {
    if (!opId) return;
    usedSlotByOp[opId] = kind + "\x00" + String(key || "");
  };
  recordCloudUsedOp(cloudMeta.slots.bmGlobal, "bg", "");
  recordCloudUsedOp(cloudMeta.slots.mkGlobal, "mg", "");
  Object.entries(cloudMeta.slots.bmSubj).forEach(function ([k, v]) { recordCloudUsedOp(v, "bs", k); });
  Object.entries(cloudMeta.slots.mkSubj).forEach(function ([k, v]) { recordCloudUsedOp(v, "ms", k); });
  Object.entries(cloudMeta.slots.bmDel).forEach(function ([k, v]) { recordCloudUsedOp(v, "bd", k); });
  Object.entries(cloudMeta.slots.mkDel).forEach(function ([k, v]) { recordCloudUsedOp(v, "md", k); });

  const cloudBookmarks = Array.isArray(cloud.bookmarks) ? cloud.bookmarks : [];
  const localBookmarks = Array.isArray(local.bookmarks) ? local.bookmarks : [];
  const cloudMistakes = Array.isArray(cloud.mistakes)
    ? cloud.mistakes
    : (cloud.mistakes && Array.isArray(cloud.mistakes.items) ? cloud.mistakes.items : []);
  const localMistakes = Array.isArray(local.mistakes)
    ? local.mistakes
    : (local.mistakes && Array.isArray(local.mistakes.items) ? local.mistakes.items : []);

  // Pre-scan cloud item max timestamp & current cloud items per scope so echo/staleness checks are exact.
  const cloudBmById = {};
  const cloudBmMaxBySubj = {};
  let cloudBmMaxGlobal = 0;
  for (let i = 0; i < cloudBookmarks.length; i++) {
    const b = cloudBookmarks[i];
    if (!b || typeof b !== "object") continue;
    const bid = progressBookmarkIdentity(b);
    const ms = parseProgressIsoMs(b.savedAt);
    const eff = ms > maxReasonableMs ? legacyFallbackPastMs : ms;
    const bOp = safeOpId(b.syncOpId);
    if (bid) {
      cloudBmById[bid] = { op: bOp, effMs: eff };
      recordCloudUsedOp(bOp, "bi", bid);
    }
    if (eff > cloudBmMaxGlobal) cloudBmMaxGlobal = eff;
    const sid = resolveProgressSubjectId(b);
    if (sid && eff > (cloudBmMaxBySubj[sid] || 0)) cloudBmMaxBySubj[sid] = eff;
  }
  const cloudMkById = {};
  const cloudMkMaxBySubj = {};
  let cloudMkMaxGlobal = 0;
  for (let i = 0; i < cloudMistakes.length; i++) {
    const m = cloudMistakes[i];
    if (!m || typeof m !== "object") continue;
    const mid = progressMistakeIdentity(m);
    const ms = progressMistakeTimestampMs(m);
    const eff = ms > maxReasonableMs ? legacyFallbackPastMs : ms;
    const mOp = safeOpId(m.syncOpId);
    if (mid) {
      cloudMkById[mid] = { op: mOp, effMs: eff };
      recordCloudUsedOp(mOp, "mi", mid);
    }
    if (eff > cloudMkMaxGlobal) cloudMkMaxGlobal = eff;
    const sid = resolveProgressSubjectId(m);
    if (sid && eff > (cloudMkMaxBySubj[sid] || 0)) cloudMkMaxBySubj[sid] = eff;
  }

  // Resolve a single timestamp slot (watermark or tombstone) idempotently against trusted cloud history.
  const resolveSlot = function (slotKind, slotKey, cloudVal, localVal, cloudOpId, localOpId, cloudRawEntry, discardExtreme) {
    const rawCloudMs = parseProgressIsoMs(cloudVal);
    // Any un-tracked future value already in cloud is legacy pre-fix data: neutralize safely.
    const cloudEffMs = rawCloudMs > maxReasonableMs ? 0 : rawCloudMs;
    const cloudOp = cloudEffMs > 0 ? safeOpId(cloudOpId) : "";
    if (cloudOp && Object.prototype.hasOwnProperty.call(cloudMeta.combinedOps, cloudOp) && !nextOps[cloudOp] && !nextFutureOps[cloudOp]) {
      nextOps[cloudOp] = cloudMeta.combinedOps[cloudOp];
    }

    const rawLocalMs = parseProgressIsoMs(localVal);
    const localOp = safeOpId(localOpId);
    let localEffMs = 0;
    let localWasReplayed = false;
    let localIsNewFuture = false;

    if (rawLocalMs > 0) {
      if (isUnsupportedFutureOpRaw(localOpId)) {
        flagResync("UNSUPPORTED_SYNC_VERSION");
        return { cloudEffMs, cloudOp, localEffMs: 0, localRawMs: rawLocalMs, localOp, localWasReplayed: false, localIsNewFuture: false };
      }
      if (isMalformedVersionedOpRaw(localOpId)) {
        flagResync("INVALID_VERSIONED_OP");
        return { cloudEffMs, cloudOp, localEffMs: 0, localRawMs: rawLocalMs, localOp, localWasReplayed: false, localIsNewFuture: false };
      }
      const parsedOp = parseVersionedOpId(localOp);
      const slotSig = slotKind + "\x00" + String(slotKey || "");
      if (parsedOp) {
        sawVersionedInput = true;
        if (parsedOp.v === 3) {
          sawV3Input = true;
          if (parsedOp.provenance !== opScopeSignature(slotKind, slotKey)) {
            flagResync("OP_PROVENANCE_MISMATCH");
            return { cloudEffMs, cloudOp, localEffMs: 0, localRawMs: rawLocalMs, localOp, localWasReplayed: false, localIsNewFuture: false };
          }
        }
      }
      if (localOp && usedSlotByOp[localOp] && usedSlotByOp[localOp] !== slotSig) {
        flagResync("OP_PROVENANCE_MISMATCH");
        return { cloudEffMs, cloudOp, localEffMs: 0, localRawMs: rawLocalMs, localOp, localWasReplayed: false, localIsNewFuture: false };
      }

      if (localOp && Object.prototype.hasOwnProperty.call(cloudMeta.combinedOps, localOp)) {
        localEffMs = Number(cloudMeta.combinedOps[localOp]) || 0;
        localWasReplayed = true;
      } else if (localOp && cloudOp && localOp === cloudOp && rawLocalMs === cloudEffMs) {
        // Exact echo of cloud's currently winning slot (even if opId fell outside 250/400 pinned budget)
        localEffMs = cloudEffMs;
        localWasReplayed = true;
      } else if (parsedOp) {
        if (parsedOp.v === 3) {
          if (authClientId && parsedOp.clientId !== authClientId) {
            flagResync("CLIENT_IDENTITY_MISMATCH");
            localEffMs = 0;
          } else {
            const cRec = cloudMeta.clients[parsedOp.clientId];
            if (!cRec || cRec.ack !== 1) {
              flagResync(cloudMeta.evictedClientEpoch > 0 ? "CLIENT_HISTORY_EVICTED" : "CLIENT_RECONCILE_REQUIRED");
              localEffMs = 0;
            } else if (parsedOp.gen !== cRec.g) {
              flagResync("CLIENT_GENERATION_MISMATCH");
              localEffMs = 0;
            } else {
              const tabRec = cRec.tabs && cRec.tabs[parsedOp.tabTag];
              if (!tabRec && cRec.evictedTabEpoch > 0) {
                flagResync("TAB_HISTORY_EVICTED");
                localEffMs = 0;
              } else if (tabRec && parsedOp.seq <= tabRec.s) {
                // Deterministic stale replay of an evicted/superseded op within active tab generation
                localEffMs = 0;
                localWasReplayed = true;
              } else {
                noteTabSeq(parsedOp.clientId, parsedOp.gen, parsedOp.tabTag, parsedOp.seq);
                if (rawLocalMs > extremeFutureMs) {
                  if (discardExtreme) {
                    localEffMs = 0;
                    nextFutureOps[localOp] = 0;
                  } else {
                    localEffMs = mergeNowMs;
                    localIsNewFuture = true;
                  }
                } else if (rawLocalMs > maxReasonableMs) {
                  localEffMs = mergeNowMs;
                  localIsNewFuture = true;
                } else {
                  localEffMs = rawLocalMs;
                  nextOps[localOp] = localEffMs;
                }
              }
            }
          }
        } else {
          // Legacy v2 destructive operation not already in cloud history -> require app refresh/upgrade to v3
          flagResync("CLIENT_UPGRADE_REQUIRED");
          localEffMs = 0;
        }
      } else if (cloudMeta.versioned) {
        // Strict legacy destructive policy after versioned sync is active:
        // Echoes of existing equal/older watermarks cannot advance anything; any advancing clear or new tombstone is rejected.
        if (!localOp && !cloudOp && cloudEffMs > 0 && rawLocalMs === cloudEffMs) {
          localEffMs = cloudEffMs;
          localWasReplayed = true;
        } else if (cloudRawEntry && cloudRawEntry.seen && Object.prototype.hasOwnProperty.call(cloudRawEntry.seen, String(rawLocalMs)) &&
          Number(cloudRawEntry.seen[String(rawLocalMs)]) <= cloudEffMs) {
          localEffMs = Number(cloudRawEntry.seen[String(rawLocalMs)]) || 0;
          localWasReplayed = true;
        } else if (cloudEffMs > 0 && rawLocalMs <= cloudEffMs) {
          localEffMs = rawLocalMs;
          localWasReplayed = true;
        } else {
          flagResync(rawLocalMs > maxReasonableMs ? "LEGACY_FUTURE_CLEAR_REJECTED" : (localOp ? "UNVERSIONED_OP_EVICTED" : "LEGACY_DESTRUCTIVE_OP_REJECTED"));
          localEffMs = 0;
        }
      } else if (!localOp && cloudRawEntry && cloudRawEntry.seen && Object.prototype.hasOwnProperty.call(cloudRawEntry.seen, String(rawLocalMs))) {
        localEffMs = Number(cloudRawEntry.seen[String(rawLocalMs)]) || 0;
        localWasReplayed = true;
      } else if (!localOp && rawLocalMs > maxReasonableMs && (!discardExtreme || rawLocalMs <= extremeFutureMs) &&
        cloudRawEntry && cloudRawEntry.maxRawMs && rawLocalMs <= cloudRawEntry.maxRawMs) {
        localEffMs = Number(cloudRawEntry.effMs) || 0;
        localWasReplayed = true;
      } else if (rawLocalMs > extremeFutureMs) {
        if (discardExtreme) {
          localEffMs = 0;
          if (localOp) nextFutureOps[localOp] = 0;
        } else {
          localEffMs = mergeNowMs;
          localIsNewFuture = true;
        }
      } else if (rawLocalMs > maxReasonableMs) {
        localEffMs = mergeNowMs;
        localIsNewFuture = true;
      } else {
        localEffMs = rawLocalMs;
        if (localOp) nextOps[localOp] = localEffMs;
      }
    }

    return {
      cloudEffMs: cloudEffMs,
      cloudOp: cloudOp,
      localEffMs: localEffMs,
      localRawMs: rawLocalMs,
      localOp: localOp,
      localWasReplayed: localWasReplayed,
      localIsNewFuture: localIsNewFuture,
    };
  };

  const resolveSlotMap = function (slotKind, cloudMap, localMap, cloudSlotMap, localSlotMap, rawNormMap, maxEntries, maxKeyLen, discardExtreme) {
    const resolved = {};
    const keys = new Set();
    if (cloudMap && typeof cloudMap === "object" && !Array.isArray(cloudMap)) {
      Object.keys(cloudMap).forEach(function (k) { if (safeMapKey(k, maxKeyLen)) keys.add(k); });
    }
    if (localMap && typeof localMap === "object" && !Array.isArray(localMap)) {
      Object.keys(localMap).forEach(function (k) { if (safeMapKey(k, maxKeyLen)) keys.add(k); });
    }
    for (const k of keys) {
      const cVal = cloudMap && typeof cloudMap[k] === "string" ? cloudMap[k] : null;
      const lVal = localMap && typeof localMap[k] === "string" ? localMap[k] : null;
      const cOp = cloudSlotMap && cloudSlotMap[k] ? cloudSlotMap[k] : "";
      const lOp = localSlotMap && localSlotMap[k] ? localSlotMap[k] : "";
      const cRaw = rawNormMap && rawNormMap[k] ? rawNormMap[k] : null;
      resolved[k] = resolveSlot(slotKind, k, cVal, lVal, cOp, lOp, cRaw, discardExtreme);
    }
    return resolved;
  };

  const finalizeSlotWinner = function (slotRes, rawNormParent, rawNormKey) {
    const cEff = slotRes.cloudEffMs;
    const lEff = slotRes.localEffMs;
    if (slotRes.localIsNewFuture && lEff > 0) {
      if (slotRes.localOp) nextFutureOps[slotRes.localOp] = lEff;
      if (rawNormParent && rawNormKey && !parseVersionedOpId(slotRes.localOp)) {
        rawNormParent[rawNormKey] = recordRawNormEntry(rawNormParent[rawNormKey], slotRes.localRawMs, lEff);
      }
    }
    let effMs = 0;
    let winOp = "";
    if (lEff > cEff) {
      effMs = lEff;
      winOp = slotRes.localOp;
    } else if (cEff > lEff) {
      effMs = cEff;
      winOp = slotRes.cloudOp;
    } else if (cEff > 0) {
      effMs = cEff;
      // Same-millisecond tie: a genuinely new non-replayed op supersedes the old slot op so the old op does not stay falsely pinned.
      winOp = (!slotRes.localWasReplayed && slotRes.localOp)
        ? slotRes.localOp
        : (slotRes.cloudOp || slotRes.localOp);
    }
    return { effMs: effMs, winOp: winOp };
  };

  // Resolve bookmark clearing & deletion slots
  const bmGlobalRes = resolveSlot(
    "bg", "",
    typeof cloud.bookmarksClearedAt === "string" ? cloud.bookmarksClearedAt : null,
    typeof local.bookmarksClearedAt === "string" ? local.bookmarksClearedAt : null,
    cloudMeta.slots.bmGlobal,
    localSlots.bmGlobal,
    cloudMeta.rawNorm.bmGlobal,
    true
  );
  const bmSubjResolved = resolveSlotMap(
    "bs",
    cloud.bookmarksClearedAtBySubject,
    local.bookmarksClearedAtBySubject,
    cloudMeta.slots.bmSubj,
    localSlots.bmSubj,
    cloudMeta.rawNorm.bmSubj,
    200,
    160,
    true
  );
  const bmDelResolved = resolveSlotMap(
    "bd",
    cloud.deletedBookmarks,
    local.deletedBookmarks,
    cloudMeta.slots.bmDel,
    localSlots.bmDel,
    cloudMeta.rawNorm.bmDel,
    500,
    500,
    true
  );

  // Resolve mistake clearing & deletion slots
  const mkGlobalRes = resolveSlot(
    "mg", "",
    typeof cloud.mistakesClearedAt === "string" ? cloud.mistakesClearedAt : null,
    typeof local.mistakesClearedAt === "string" ? local.mistakesClearedAt : null,
    cloudMeta.slots.mkGlobal,
    localSlots.mkGlobal,
    cloudMeta.rawNorm.mkGlobal,
    true
  );
  const mkSubjResolved = resolveSlotMap(
    "ms",
    cloud.mistakesClearedAtBySubject,
    local.mistakesClearedAtBySubject,
    cloudMeta.slots.mkSubj,
    localSlots.mkSubj,
    cloudMeta.rawNorm.mkSubj,
    200,
    160,
    true
  );
  const mkDelResolved = resolveSlotMap(
    "md",
    cloud.deletedMistakes,
    local.deletedMistakes,
    cloudMeta.slots.mkDel,
    localSlots.mkDel,
    cloudMeta.rawNorm.mkDel,
    500,
    500,
    true
  );

  // If a local un-replayed fast item was saved strictly after a new fast clear/delete in the same sync,
  // shift the new fast clear/delete by -1ms if safe (no cloud item/clear at mergeNowMs), else bump item by +1ms later.
  const canShiftSlotDown = function (slotRes, cloudItemMax) {
    return slotRes && slotRes.localIsNewFuture && slotRes.localEffMs === mergeNowMs &&
      mergeNowMs > 1 && slotRes.cloudEffMs <= mergeNowMs - 1 && (cloudItemMax || 0) < mergeNowMs;
  };
  const isReplayedItem = function (itemOp, cloudInfo, rawEntry, rawMs) {
    if (itemOp && Object.prototype.hasOwnProperty.call(cloudMeta.combinedOps, itemOp)) return true;
    if (itemOp && cloudInfo && cloudInfo.op === itemOp && rawMs === cloudInfo.effMs) return true;
    const parsedOp = parseVersionedOpId(itemOp);
    if (parsedOp) {
      const cRec = cloudMeta.clients[parsedOp.clientId];
      if (!cRec) return false;
      if (parsedOp.v === 3) {
        if (parsedOp.gen < cRec.g) return true;
        const tabRec = cRec.tabs && cRec.tabs[parsedOp.tabTag];
        if (tabRec && parsedOp.seq <= tabRec.s) return true;
        return false;
      }
      if (parsedOp.seq <= cRec.s) return true;
      return false;
    }
    if (!itemOp && rawEntry) {
      if (rawEntry.seen && Object.prototype.hasOwnProperty.call(rawEntry.seen, String(rawMs))) return true;
      if (rawMs <= extremeFutureMs && rawEntry.maxRawMs && rawMs <= rawEntry.maxRawMs) return true;
    }
    return false;
  };
  const shiftFastSlotsForItems = function (items, getId, getMs, cloudItemMap, rawItemBucket, globalRes, subjMap, delMap, cloudMaxGlobal, cloudMaxBySubj) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item || typeof item !== "object") continue;
      const id = getId(item);
      const rawMs = getMs(item);
      if (rawMs <= maxReasonableMs || rawMs > extremeFutureMs) continue;
      if (isMalformedVersionedOpRaw(item.syncOpId) || isUnsupportedFutureOpRaw(item.syncOpId)) continue;
      const itemOp = safeOpId(item.syncOpId);
      if (isReplayedItem(itemOp, cloudItemMap[id], rawItemBucket[id], rawMs)) continue;
      const sid = resolveProgressSubjectId(item);
      if (globalRes.localIsNewFuture && rawMs > globalRes.localRawMs && canShiftSlotDown(globalRes, cloudMaxGlobal)) {
        globalRes.localEffMs = mergeNowMs - 1;
      }
      if (sid && subjMap[sid] && subjMap[sid].localIsNewFuture && rawMs > subjMap[sid].localRawMs &&
        canShiftSlotDown(subjMap[sid], cloudMaxBySubj[sid])) {
        subjMap[sid].localEffMs = mergeNowMs - 1;
      }
      if (id && delMap[id] && delMap[id].localIsNewFuture && rawMs > delMap[id].localRawMs &&
        canShiftSlotDown(delMap[id], cloudMaxGlobal)) {
        delMap[id].localEffMs = mergeNowMs - 1;
      }
    }
  };
  shiftFastSlotsForItems(
    localBookmarks, progressBookmarkIdentity, function (b) { return parseProgressIsoMs(b.savedAt); },
    cloudBmById, cloudMeta.rawNorm.bmItem, bmGlobalRes, bmSubjResolved, bmDelResolved, cloudBmMaxGlobal, cloudBmMaxBySubj
  );
  shiftFastSlotsForItems(
    localMistakes, progressMistakeIdentity, progressMistakeTimestampMs,
    cloudMkById, cloudMeta.rawNorm.mkItem, mkGlobalRes, mkSubjResolved, mkDelResolved, cloudMkMaxGlobal, cloudMkMaxBySubj
  );

  // Finalize winning bookmark watermarks & tombstones
  const bmGlobalWin = finalizeSlotWinner(bmGlobalRes, null, null);
  if (bmGlobalRes.localIsNewFuture && bmGlobalRes.localEffMs > 0 && !parseVersionedOpId(bmGlobalRes.localOp)) {
    nextRawNorm.bmGlobal = recordRawNormEntry(nextRawNorm.bmGlobal, bmGlobalRes.localRawMs, bmGlobalRes.localEffMs);
  }
  const bmClearedMs = bmGlobalWin.effMs;
  const bookmarksClearedAt = bmClearedMs ? new Date(bmClearedMs).toISOString() : null;

  const finalizeMap = function (resolvedObj, rawNormParent, maxEntries) {
    const pairs = [];
    for (const [k, slotRes] of Object.entries(resolvedObj)) {
      const win = finalizeSlotWinner(slotRes, rawNormParent, k);
      if (win.effMs > 0) pairs.push({ key: k, effMs: win.effMs, winOp: win.winOp });
    }
    if (pairs.length > maxEntries) {
      pairs.sort(function (a, b) { return b.effMs - a.effMs; });
      pairs.length = maxEntries;
    }
    const isoMap = {};
    const msMap = {};
    const opMap = {};
    for (let i = 0; i < pairs.length; i++) {
      const p = pairs[i];
      isoMap[p.key] = new Date(p.effMs).toISOString();
      msMap[p.key] = p.effMs;
      if (p.winOp) opMap[p.key] = p.winOp;
    }
    return { isoMap: isoMap, msMap: msMap, opMap: opMap };
  };

  const resolveLocalItemEffMs = function (itemKind, id, sid, rawMs, rawItemOp, cloudInfo, cloudBucket, nextBucket, globalRes, subjMap, delMap) {
    if (isUnsupportedFutureOpRaw(rawItemOp)) {
      flagResync("UNSUPPORTED_SYNC_VERSION");
      return { effMs: 0, wasReplayed: true, skipLocal: true };
    }
    if (isMalformedVersionedOpRaw(rawItemOp)) {
      flagResync("INVALID_VERSIONED_OP");
      return { effMs: 0, wasReplayed: true, skipLocal: true };
    }
    const itemOp = safeOpId(rawItemOp);
    const parsedOp = parseVersionedOpId(itemOp);
    const itemSig = itemKind + "\x00" + String(id || "");
    if (parsedOp) {
      sawVersionedInput = true;
      if (parsedOp.v === 3) {
        sawV3Input = true;
        if (parsedOp.provenance !== opScopeSignature(itemKind, id)) {
          flagResync("OP_PROVENANCE_MISMATCH");
          return { effMs: 0, wasReplayed: true, skipLocal: true };
        }
      }
    }
    if (itemOp && usedSlotByOp[itemOp] && usedSlotByOp[itemOp] !== itemSig) {
      flagResync("OP_PROVENANCE_MISMATCH");
      return { effMs: 0, wasReplayed: true, skipLocal: true };
    }

    let effMs = 0;
    let wasReplayed = false;
    let skipLocal = false;

    if (rawMs > 0) {
      const rawEntry = cloudBucket[id];
      const computeNewFutureMs = function () {
        let minRequired = mergeNowMs;
        if (rawMs <= extremeFutureMs) {
          const delRes = delMap[id];
          const subjRes = sid ? subjMap[sid] : null;
          const newFastDels = [globalRes, subjRes, delRes].filter(function (r) {
            return r && r.localIsNewFuture && rawMs > r.localRawMs;
          });
          for (let d = 0; d < newFastDels.length; d++) {
            if (newFastDels[d].localEffMs >= minRequired) {
              minRequired = newFastDels[d].localEffMs + 1;
            }
          }
        }
        return minRequired;
      };

      if (itemOp && Object.prototype.hasOwnProperty.call(cloudMeta.combinedOps, itemOp)) {
        effMs = Number(cloudMeta.combinedOps[itemOp]) || 0;
        wasReplayed = true;
      } else if (itemOp && cloudInfo && cloudInfo.op === itemOp && rawMs === cloudInfo.effMs) {
        effMs = cloudInfo.effMs;
        wasReplayed = true;
      } else if (parsedOp) {
        if (parsedOp.v === 3) {
          const cRec = cloudMeta.clients[parsedOp.clientId];
          if (cRec && cRec.ack === 1 && parsedOp.gen === cRec.g) {
            const tabRec = cRec.tabs && cRec.tabs[parsedOp.tabTag];
            if (tabRec && parsedOp.seq <= tabRec.s) {
              // Stale replay of an evicted item op: never resurrect if deleted in cloud or overwrite newer cloud item
              effMs = 0;
              wasReplayed = true;
              skipLocal = true;
            } else if (!tabRec && cRec.evictedTabEpoch > 0) {
              if (rawMs <= maxReasonableMs) {
                effMs = rawMs;
              } else {
                flagResync("TAB_HISTORY_EVICTED");
                effMs = 0;
                skipLocal = true;
              }
            } else if (authClientId && parsedOp.clientId !== authClientId) {
              if (rawMs <= maxReasonableMs) effMs = rawMs;
              else {
                flagResync("CLIENT_IDENTITY_MISMATCH");
                effMs = 0;
                skipLocal = true;
              }
            } else {
              noteTabSeq(parsedOp.clientId, parsedOp.gen, parsedOp.tabTag, parsedOp.seq);
              if (rawMs > maxReasonableMs) {
                effMs = computeNewFutureMs();
                nextFutureOps[itemOp] = effMs;
              } else {
                effMs = rawMs;
                nextOps[itemOp] = effMs;
              }
            }
          } else if (cRec && parsedOp.gen < cRec.g) {
            if (rawMs > maxReasonableMs) {
              flagResync("CLIENT_GENERATION_MISMATCH");
            }
            effMs = 0;
            wasReplayed = true;
            skipLocal = true;
          } else if (rawMs <= maxReasonableMs) {
            // Safe normal-clock offline save from unknown/evicted client: preserve safely under cloud watermarks
            effMs = rawMs;
          } else {
            flagResync(cRec ? "CLIENT_GENERATION_MISMATCH" : (cloudMeta.evictedClientEpoch > 0 ? "CLIENT_HISTORY_EVICTED_ITEM" : "CLIENT_RECONCILE_REQUIRED"));
            effMs = 0;
            skipLocal = true;
          }
        } else {
          // v2 item op from an un-refreshed tab: preserve normal-clock non-destructive saves safely
          if (rawMs <= maxReasonableMs) {
            const cRec2 = cloudMeta.clients[parsedOp.clientId];
            if (cRec2 && parsedOp.seq <= cRec2.s) {
              effMs = 0;
              wasReplayed = true;
              skipLocal = true;
            } else {
              effMs = rawMs;
            }
          } else {
            flagResync("CLIENT_UPGRADE_REQUIRED");
            effMs = 0;
            skipLocal = true;
          }
        }
      } else if (cloudMeta.versioned) {
        if (rawEntry && rawEntry.seen && Object.prototype.hasOwnProperty.call(rawEntry.seen, String(rawMs))) {
          effMs = Number(rawEntry.seen[String(rawMs)]) || 0;
          wasReplayed = true;
        } else if (rawMs > maxReasonableMs) {
          flagResync("LEGACY_FUTURE_ITEM_REJECTED");
          effMs = 0;
          skipLocal = true;
        } else if (itemOp) {
          if (cloudInfo && rawMs <= cloudInfo.effMs) {
            effMs = rawMs;
            wasReplayed = true;
          } else {
            flagResync("UNVERSIONED_OP_EVICTED");
            effMs = 0;
            skipLocal = true;
          }
        } else {
          effMs = rawMs;
        }
      } else if (!itemOp && rawEntry && rawEntry.seen && Object.prototype.hasOwnProperty.call(rawEntry.seen, String(rawMs))) {
        effMs = Number(rawEntry.seen[String(rawMs)]) || 0;
        wasReplayed = true;
      } else if (!itemOp && rawMs > maxReasonableMs && rawMs <= extremeFutureMs && rawEntry && rawEntry.maxRawMs && rawMs <= rawEntry.maxRawMs) {
        effMs = Number(rawEntry.effMs) || 0;
        wasReplayed = true;
      } else if (rawMs > maxReasonableMs) {
        effMs = computeNewFutureMs();
        if (itemOp) nextFutureOps[itemOp] = effMs;
        nextBucket[id] = recordRawNormEntry(nextBucket[id], rawMs, effMs);
      } else {
        effMs = rawMs;
        if (itemOp) nextOps[itemOp] = effMs;
      }
    }
    return { effMs: effMs, wasReplayed: wasReplayed, skipLocal: skipLocal };
  };

  const bmSubjFinal = finalizeMap(bmSubjResolved, nextRawNorm.bmSubj, 200);
  const bmDelFinal = finalizeMap(bmDelResolved, nextRawNorm.bmDel, 500);
  const bookmarksClearedAtBySubject = bmSubjFinal.isoMap;
  const deletedBookmarks = bmDelFinal.isoMap;

  // Resolve and merge bookmarks
  const resolveBookmarkItem = function (item, isLocal) {
    const id = progressBookmarkIdentity(item);
    const rawSavedMs = parseProgressIsoMs(item.savedAt);
    const itemOp = safeOpId(item.syncOpId);
    if (!isLocal) {
      if (rawSavedMs > maxReasonableMs) {
        if (!cloudMeta.versioned) {
          nextRawNorm.bmItem[id] = recordRawNormEntry(nextRawNorm.bmItem[id], rawSavedMs, legacyFallbackPastMs);
        }
        return { item: Object.assign({}, item, { savedAt: new Date(legacyFallbackPastMs).toISOString() }), effMs: legacyFallbackPastMs, wasReplayed: false, skipLocal: false };
      }
      if (itemOp && !nextOps[itemOp] && !nextFutureOps[itemOp]) nextOps[itemOp] = rawSavedMs;
      return { item: item, effMs: rawSavedMs, wasReplayed: false, skipLocal: false };
    }
    const res = resolveLocalItemEffMs(
      "bi", id, resolveProgressSubjectId(item), rawSavedMs, item.syncOpId, cloudBmById[id],
      cloudMeta.rawNorm.bmItem, nextRawNorm.bmItem, bmGlobalRes, bmSubjResolved, bmDelResolved
    );
    if (res.skipLocal) {
      return { item: item, effMs: 0, wasReplayed: true, skipLocal: true };
    }
    const normalized = res.effMs !== rawSavedMs
      ? Object.assign({}, item, { savedAt: res.effMs ? new Date(res.effMs).toISOString() : "" })
      : item;
    return { item: normalized, effMs: res.effMs, wasReplayed: res.wasReplayed, skipLocal: false };
  };

  const bookmarkEntries = new Map();
  const ingestBookmark = function (item, isLocal) {
    if (!item || typeof item !== "object") return;
    const id = progressBookmarkIdentity(item);
    if (!id) return;
    const resolved = resolveBookmarkItem(item, isLocal);
    if (isLocal && resolved.skipLocal) return;
    if (!bookmarkEntries.has(id)) {
      bookmarkEntries.set(id, { item: resolved.item, effMs: resolved.effMs, wasReplayed: resolved.wasReplayed, isLocal: isLocal });
      return;
    }
    const prev = bookmarkEntries.get(id);
    // local is ingested before cloud; cloud wins on tie if local was a replay
    const incomingWins = resolved.effMs > prev.effMs || (resolved.effMs === prev.effMs && prev.isLocal && prev.wasReplayed && !isLocal);
    const newer = incomingWins ? resolved.item : prev.item;
    const older = incomingWins ? prev.item : resolved.item;
    const combined = Object.assign({}, older, newer);
    fillMissingFields(combined, older, [
      "id", "internalId", "subjectId", "subjectName", "quizId",
      "sourceLabel", "question", "image", "correctOptionId", "correctAnswer"
    ]);
    if ((!Array.isArray(combined.images) || !combined.images.length) && Array.isArray(older.images) && older.images.length) {
      combined.images = older.images;
    }
    bookmarkEntries.set(id, {
      item: combined,
      effMs: Math.max(prev.effMs, resolved.effMs),
      wasReplayed: incomingWins ? resolved.wasReplayed : prev.wasReplayed,
      isLocal: incomingWins ? isLocal : prev.isLocal,
    });
  };
  localBookmarks.forEach(function (item) { ingestBookmark(item, true); });
  cloudBookmarks.forEach(function (item) { ingestBookmark(item, false); });

  merged.bookmarks = [];
  for (const [id, entry] of bookmarkEntries.entries()) {
    const sid = resolveProgressSubjectId(entry.item);
    const delMs = bmDelFinal.msMap[id] || 0;
    const subjDelMs = sid ? (bmSubjFinal.msMap[sid] || 0) : 0;
    const effDelMs = Math.max(delMs, bmClearedMs, subjDelMs);
    if (effDelMs > 0 && entry.effMs <= effDelMs) continue;
    if (entry.effMs > delMs && deletedBookmarks[id]) {
      delete deletedBookmarks[id];
      delete bmDelFinal.opMap[id];
    }
    merged.bookmarks.push(entry.item);
  }
  merged.deletedBookmarks = deletedBookmarks;
  if (bookmarksClearedAt) merged.bookmarksClearedAt = bookmarksClearedAt;
  else delete merged.bookmarksClearedAt;
  if (Object.keys(bookmarksClearedAtBySubject).length) merged.bookmarksClearedAtBySubject = bookmarksClearedAtBySubject;
  else delete merged.bookmarksClearedAtBySubject;

  // Finalize winning mistake watermarks & tombstones
  const mkGlobalWin = finalizeSlotWinner(mkGlobalRes, null, null);
  if (mkGlobalRes.localIsNewFuture && mkGlobalRes.localEffMs > 0 && !parseVersionedOpId(mkGlobalRes.localOp)) {
    nextRawNorm.mkGlobal = recordRawNormEntry(nextRawNorm.mkGlobal, mkGlobalRes.localRawMs, mkGlobalRes.localEffMs);
  }
  const clearedMs = mkGlobalWin.effMs;
  const mistakesClearedAt = clearedMs ? new Date(clearedMs).toISOString() : null;

  const mkSubjFinal = finalizeMap(mkSubjResolved, nextRawNorm.mkSubj, 200);
  const mkDelFinal = finalizeMap(mkDelResolved, nextRawNorm.mkDel, 500);
  const mistakesClearedAtBySubject = mkSubjFinal.isoMap;
  const deletedMistakes = mkDelFinal.isoMap;

  const resolveMistakeItem = function (item, isLocal) {
    const id = progressMistakeIdentity(item);
    const rawItemMs = progressMistakeTimestampMs(item);
    const itemOp = safeOpId(item.syncOpId);
    if (!isLocal) {
      if (rawItemMs > maxReasonableMs) {
        if (!cloudMeta.versioned) {
          nextRawNorm.mkItem[id] = recordRawNormEntry(nextRawNorm.mkItem[id], rawItemMs, legacyFallbackPastMs);
        }
        return { item: clampMistakeTimestampsToMs(item, legacyFallbackPastMs), effMs: legacyFallbackPastMs, wasReplayed: false, skipLocal: false };
      }
      if (itemOp && !nextOps[itemOp] && !nextFutureOps[itemOp]) nextOps[itemOp] = rawItemMs;
      return { item: item, effMs: rawItemMs, wasReplayed: false, skipLocal: false };
    }
    const res = resolveLocalItemEffMs(
      "mi", id, resolveProgressSubjectId(item), rawItemMs, item.syncOpId, cloudMkById[id],
      cloudMeta.rawNorm.mkItem, nextRawNorm.mkItem, mkGlobalRes, mkSubjResolved, mkDelResolved
    );
    if (res.skipLocal) {
      return { item: item, effMs: 0, wasReplayed: true, skipLocal: true };
    }
    const normalized = res.effMs !== rawItemMs || rawItemMs > maxReasonableMs
      ? clampMistakeTimestampsToMs(item, res.effMs || mergeNowMs)
      : item;
    return { item: normalized, effMs: res.effMs, wasReplayed: res.wasReplayed, skipLocal: false };
  };

  const mistakeEntries = new Map();
  const ingestMistake = function (item, isLocal) {
    if (!item || typeof item !== "object") return;
    const id = progressMistakeIdentity(item);
    if (!id) return;
    const resolved = resolveMistakeItem(item, isLocal);
    if (isLocal && resolved.skipLocal) return;
    if (!mistakeEntries.has(id)) {
      mistakeEntries.set(id, { item: Object.assign({}, resolved.item), effMs: resolved.effMs, wasReplayed: resolved.wasReplayed, isLocal: isLocal });
      return;
    }
    const prev = mistakeEntries.get(id);
    const preferPrevOnTie = !(prev.isLocal && prev.wasReplayed && !isLocal);
    const mergedItem = mergeMistakePair(prev.item, resolved.item, prev.effMs, resolved.effMs, preferPrevOnTie);
    const nextWins = resolved.effMs > prev.effMs || (resolved.effMs === prev.effMs && !preferPrevOnTie);
    mistakeEntries.set(id, {
      item: mergedItem,
      effMs: Math.max(prev.effMs, resolved.effMs),
      wasReplayed: nextWins ? resolved.wasReplayed : prev.wasReplayed,
      isLocal: nextWins ? isLocal : prev.isLocal,
    });
  };
  localMistakes.forEach(function (item) { ingestMistake(item, true); });
  cloudMistakes.forEach(function (item) { ingestMistake(item, false); });

  const mergedMistakeItems = [];
  for (const [id, entry] of mistakeEntries.entries()) {
    const sid = resolveProgressSubjectId(entry.item);
    const delItemMs = mkDelFinal.msMap[id] || 0;
    const subjDelMs = sid ? (mkSubjFinal.msMap[sid] || 0) : 0;
    const effectiveDelMs = Math.max(delItemMs, clearedMs, subjDelMs);
    if (effectiveDelMs > 0 && entry.effMs <= effectiveDelMs) continue;
    if (entry.effMs > delItemMs && deletedMistakes[id]) {
      delete deletedMistakes[id];
      delete mkDelFinal.opMap[id];
    }
    mergedMistakeItems.push(entry.item);
  }
  const cloudMistakesObj = cloud.mistakes && !Array.isArray(cloud.mistakes) && typeof cloud.mistakes === "object" ? cloud.mistakes : {};
  const localMistakesObj = local.mistakes && !Array.isArray(local.mistakes) && typeof local.mistakes === "object" ? local.mistakes : {};
  merged.mistakes = Object.assign({}, cloudMistakesObj, localMistakesObj, {
    schemaVersion: 2,
    items: mergedMistakeItems
  });
  merged.deletedMistakes = deletedMistakes;
  if (mistakesClearedAt) merged.mistakesClearedAt = mistakesClearedAt;
  else delete merged.mistakesClearedAt;
  if (Object.keys(mistakesClearedAtBySubject).length) merged.mistakesClearedAtBySubject = mistakesClearedAtBySubject;
  else delete merged.mistakesClearedAtBySubject;

  if (resyncRequired) {
    return buildSyncResyncResult(resyncReason, cloud, mergeNowMs, cloudMeta.epoch);
  }

  // Persist bounded syncMeta inside progress_json
  const nextVersioned = cloudMeta.versioned || sawVersionedInput;
  const nextHardenedV3 = cloudMeta.hardenedV3 || sawV3Input;
  const nextEpoch = nextVersioned ? ((cloudMeta.epoch || 0) + 1) : (cloudMeta.epoch || 0);
  let nextGenCounter = cloudMeta.nextGen;

  for (const [cid, upd] of Object.entries(pendingTabUpdates)) {
    const cur = nextClients[cid];
    if (!cur || cur.ack !== 1 || cur.g !== upd.gen) continue;
    cur.s = Math.min(MAX_CLIENT_SEQ, Math.max(cur.s || 0, upd.maxSeq));
    cur.e = nextEpoch;
    if (!cur.tabs) cur.tabs = {};
    for (const [tt, seqVal] of Object.entries(upd.tabs)) {
      const prevTabS = cur.tabs[tt] ? cur.tabs[tt].s : 0;
      cur.tabs[tt] = { s: Math.min(MAX_CLIENT_SEQ, Math.max(prevTabS, seqVal)), e: nextEpoch };
    }
    const trimmedT = trimClientTabsMap(cur.tabs, MAX_SYNC_CLIENT_TABS, cur.evictedTabEpoch || 0);
    cur.tabs = trimmedT.tabs;
    if (trimmedT.evictedTabEpoch > 0) cur.evictedTabEpoch = trimmedT.evictedTabEpoch;
    nextClients[cid] = cur;
  }

  let syncRegistration = null;
  if (authClientId && (registerClientMode === "initial" || registerClientMode === "auth")) {
    const existingReg = nextClients[authClientId];
    const existingTabOk = Boolean(
      existingReg &&
      (!authTabTag || (existingReg.tabs && existingReg.tabs[authTabTag]) || !(existingReg.evictedTabEpoch > 0))
    );
    if (existingReg && existingReg.ack === 1 && existingReg.g >= 1 && authClientGen >= 1 && authClientGen === existingReg.g && existingTabOk) {
      existingReg.e = nextEpoch;
      if (authTabTag) {
        if (!existingReg.tabs) existingReg.tabs = {};
        if (!existingReg.tabs[authTabTag]) existingReg.tabs[authTabTag] = { s: 0, e: nextEpoch };
        else existingReg.tabs[authTabTag].e = nextEpoch;
        const trimmedT = trimClientTabsMap(existingReg.tabs, MAX_SYNC_CLIENT_TABS, existingReg.evictedTabEpoch || 0);
        existingReg.tabs = trimmedT.tabs;
        if (trimmedT.evictedTabEpoch > 0) existingReg.evictedTabEpoch = trimmedT.evictedTabEpoch;
      }
      nextClients[authClientId] = existingReg;
      syncRegistration = {
        status: "active",
        clientId: authClientId,
        gen: existingReg.g,
        tabTag: authTabTag || "",
        baselineEpoch: existingReg.b || nextEpoch,
        syncEpoch: nextEpoch,
        protocolVersion: MAX_SYNC_PROTOCOL_VERSION,
        minSupportedVersion: MAX_SYNC_PROTOCOL_VERSION,
        seq: authTabTag && existingReg.tabs[authTabTag] ? existingReg.tabs[authTabTag].s : 0,
      };
    } else {
      const issuedGen = Math.min(MAX_CLIENT_GEN, nextGenCounter);
      nextGenCounter = Math.min(MAX_CLIENT_GEN, issuedGen + 1);
      const initialTabs = {};
      if (authTabTag) initialTabs[authTabTag] = { s: 0, e: nextEpoch };
      nextClients[authClientId] = {
        g: issuedGen,
        s: 0,
        e: nextEpoch,
        b: nextEpoch,
        ack: 1,
        tabs: initialTabs,
      };
      Object.keys(nextPendingRegs).forEach(function (k) {
        if (k === authClientId || k.startsWith(authClientId + ":")) {
          if (!authTabTag || k === pendingRegKey(authClientId, authTabTag) || k === authClientId) {
            delete nextPendingRegs[k];
          }
        }
      });
      syncRegistration = {
        status: "active",
        clientId: authClientId,
        gen: issuedGen,
        tabTag: authTabTag || "",
        baselineEpoch: nextEpoch,
        syncEpoch: nextEpoch,
        protocolVersion: MAX_SYNC_PROTOCOL_VERSION,
        minSupportedVersion: MAX_SYNC_PROTOCOL_VERSION,
        seq: 0,
      };
    }
  }

  const trimmedClientsOut = trimClientsMap(nextClients, MAX_SYNC_CLIENTS, cloudMeta.evictedClientEpoch);
  const trimmedPendingRegsOut = trimPendingRegsMap(nextPendingRegs, MAX_PENDING_SYNC_REGS);

  const pinnedSlotOps = new Set();
  if (bmGlobalWin.winOp) pinnedSlotOps.add(bmGlobalWin.winOp);
  if (mkGlobalWin.winOp) pinnedSlotOps.add(mkGlobalWin.winOp);
  Object.values(bmSubjFinal.opMap).forEach(function (op) { if (op) pinnedSlotOps.add(op); });
  Object.values(mkSubjFinal.opMap).forEach(function (op) { if (op) pinnedSlotOps.add(op); });
  Object.values(bmDelFinal.opMap).forEach(function (op) { if (op) pinnedSlotOps.add(op); });
  Object.values(mkDelFinal.opMap).forEach(function (op) { if (op) pinnedSlotOps.add(op); });

  const pinnedItemOps = new Set();
  merged.bookmarks.forEach(function (b) { if (b && b.syncOpId) pinnedItemOps.add(b.syncOpId); });
  mergedMistakeItems.forEach(function (m) { if (m && m.syncOpId) pinnedItemOps.add(m.syncOpId); });

  const prunedFutureOps = trimOpMap(nextFutureOps, MAX_SYNC_FUTURE_OPS, pinnedSlotOps, pinnedItemOps);
  const prunedOps = trimOpMap(nextOps, MAX_SYNC_OPS, pinnedSlotOps, pinnedItemOps);
  const slotsOut = {};
  if (bmGlobalWin.winOp) slotsOut.bmGlobal = bmGlobalWin.winOp;
  if (mkGlobalWin.winOp) slotsOut.mkGlobal = mkGlobalWin.winOp;
  if (Object.keys(bmSubjFinal.opMap).length) slotsOut.bmSubj = bmSubjFinal.opMap;
  if (Object.keys(mkSubjFinal.opMap).length) slotsOut.mkSubj = mkSubjFinal.opMap;
  if (Object.keys(bmDelFinal.opMap).length) slotsOut.bmDel = bmDelFinal.opMap;
  if (Object.keys(mkDelFinal.opMap).length) slotsOut.mkDel = mkDelFinal.opMap;

  const rawNormOut = {};
  if (nextRawNorm.bmGlobal) rawNormOut.bmGlobal = nextRawNorm.bmGlobal;
  if (nextRawNorm.mkGlobal) rawNormOut.mkGlobal = nextRawNorm.mkGlobal;
  const trimmedBmSubjRaw = trimRawNormMap(nextRawNorm.bmSubj, MAX_RAW_NORM_BUCKET);
  const trimmedMkSubjRaw = trimRawNormMap(nextRawNorm.mkSubj, MAX_RAW_NORM_BUCKET);
  const trimmedBmDelRaw = trimRawNormMap(nextRawNorm.bmDel, MAX_RAW_NORM_BUCKET);
  const trimmedMkDelRaw = trimRawNormMap(nextRawNorm.mkDel, MAX_RAW_NORM_BUCKET);
  const trimmedBmItemRaw = trimRawNormMap(nextRawNorm.bmItem, MAX_RAW_NORM_BUCKET);
  const trimmedMkItemRaw = trimRawNormMap(nextRawNorm.mkItem, MAX_RAW_NORM_BUCKET);
  if (Object.keys(trimmedBmSubjRaw).length) rawNormOut.bmSubj = trimmedBmSubjRaw;
  if (Object.keys(trimmedMkSubjRaw).length) rawNormOut.mkSubj = trimmedMkSubjRaw;
  if (Object.keys(trimmedBmDelRaw).length) rawNormOut.bmDel = trimmedBmDelRaw;
  if (Object.keys(trimmedMkDelRaw).length) rawNormOut.mkDel = trimmedMkDelRaw;
  if (Object.keys(trimmedBmItemRaw).length) rawNormOut.bmItem = trimmedBmItemRaw;
  if (Object.keys(trimmedMkItemRaw).length) rawNormOut.mkItem = trimmedMkItemRaw;

  const hasClients = Object.keys(trimmedClientsOut.clients).length > 0;
  const hasPendingRegs = Object.keys(trimmedPendingRegsOut).length > 0;
  const hasSyncMeta = nextVersioned || nextHardenedV3 || Object.keys(prunedOps).length || Object.keys(prunedFutureOps).length ||
    Object.keys(slotsOut).length || Object.keys(rawNormOut).length || hasClients || hasPendingRegs ||
    trimmedClientsOut.evictedClientEpoch > 0 || nextGenCounter > 1;
  if (hasSyncMeta) {
    merged.syncMeta = { v: nextHardenedV3 ? 3 : (nextVersioned ? 2 : 1) };
    if (nextEpoch > 0) merged.syncMeta.epoch = nextEpoch;
    if (nextGenCounter > 1) merged.syncMeta.nextGen = nextGenCounter;
    if (trimmedClientsOut.evictedClientEpoch > 0) merged.syncMeta.evictedClientEpoch = trimmedClientsOut.evictedClientEpoch;
    if (hasClients) merged.syncMeta.clients = trimmedClientsOut.clients;
    if (hasPendingRegs) merged.syncMeta.pendingRegs = trimmedPendingRegsOut;
    if (Object.keys(prunedOps).length) merged.syncMeta.ops = prunedOps;
    if (Object.keys(prunedFutureOps).length) merged.syncMeta.futureOps = prunedFutureOps;
    if (Object.keys(slotsOut).length) merged.syncMeta.slots = slotsOut;
    if (Object.keys(rawNormOut).length) merged.syncMeta.rawNorm = rawNormOut;
  } else {
    delete merged.syncMeta;
  }

  const rawAttempts = []
    .concat(Array.isArray(local.attempts) ? local.attempts : (Array.isArray(local.attemptLog) ? local.attemptLog : []))
    .concat(Array.isArray(cloud.attempts) ? cloud.attempts : (Array.isArray(cloud.attemptLog) ? cloud.attemptLog : []));
  const seenAttempts = new Set();
  const dedupedAttempts = rawAttempts.filter(function (item) {
    if (!item || typeof item !== "object") return false;
    const id = item.attemptId || item.id || ((item.subjectId || "") + "::" + (item.quizId || item.collectionId || "") + "::" + (item.finishedAt || ""));
    if (seenAttempts.has(id)) return false;
    seenAttempts.add(id);
    return true;
  }).slice(0, 50);
  merged.attempts = dedupedAttempts;
  delete merged.attemptLog;

  merged.checklists = Object.assign({}, cloud.checklists || {}, local.checklists || {});
  if (merged.syncMeta && utf8ByteLength(JSON.stringify(merged)) > MAX_PROGRESS_BYTES - 4096) {
    if (merged.syncMeta.ops) {
      const slotOnlyOps = {};
      pinnedSlotOps.forEach(function (op) {
        if (Object.prototype.hasOwnProperty.call(merged.syncMeta.ops, op)) slotOnlyOps[op] = merged.syncMeta.ops[op];
      });
      if (Object.keys(slotOnlyOps).length) merged.syncMeta.ops = slotOnlyOps;
      else delete merged.syncMeta.ops;
    }
    if (utf8ByteLength(JSON.stringify(merged)) > MAX_PROGRESS_BYTES - 4096 && merged.syncMeta.rawNorm) {
      delete merged.syncMeta.rawNorm;
    }
    if (utf8ByteLength(JSON.stringify(merged)) > MAX_PROGRESS_BYTES - 4096 && merged.syncMeta.futureOps) {
      const slotOnlyFuture = trimOpMap(merged.syncMeta.futureOps, MAX_SYNC_FUTURE_OPS, pinnedSlotOps, new Set());
      const keptSlotFuture = {};
      pinnedSlotOps.forEach(function (op) {
        if (Object.prototype.hasOwnProperty.call(slotOnlyFuture, op)) keptSlotFuture[op] = slotOnlyFuture[op];
      });
      if (Object.keys(keptSlotFuture).length) merged.syncMeta.futureOps = keptSlotFuture;
      else delete merged.syncMeta.futureOps;
    }
    if (utf8ByteLength(JSON.stringify(merged)) > MAX_PROGRESS_BYTES - 4096 && merged.syncMeta.pendingRegs) {
      delete merged.syncMeta.pendingRegs;
    }
  }
  return { ok: true, progress: merged, syncEpoch: nextEpoch, syncRegistration: syncRegistration };
}

function mergeProgress(localProgress, cloudProgress, nowMs) {
  const res = mergeProgressWithStatus(localProgress, cloudProgress, nowMs);
  return res.ok ? res.progress : res.cloudProgress;
}

function validateProgressInput(rawProgress) {
  if (rawProgress === undefined || rawProgress === null) {
    return { ok: true, progress: {} };
  }
  if (typeof rawProgress !== "object" || Array.isArray(rawProgress)) {
    return { ok: false, status: 400, code: "BAD_REQUEST", error: "Invalid progress payload." };
  }
  let jsonStr = "";
  try {
    jsonStr = JSON.stringify(rawProgress);
  } catch (_e) {
    return { ok: false, status: 400, code: "BAD_REQUEST", error: "Invalid progress payload." };
  }
  if (utf8ByteLength(jsonStr) > MAX_PROGRESS_BYTES) {
    return { ok: false, status: 413, code: "TOO_LARGE", error: "Progress data too large." };
  }
  return { ok: true, progress: rawProgress };
}

function describeClientRegistration(cloudProgress, rawClientId, rawClientGen, rawTabTag, nowMs) {
  const cid = safeClientId(rawClientId);
  if (!cid) return null;
  const tTag = safeTabTag(rawTabTag);
  const suppliedGen = Number(rawClientGen);
  const hasSuppliedGen = Number.isSafeInteger(suppliedGen) && suppliedGen >= 1;
  const cloudMeta = sanitizeSyncMetaFromCloud(cloudProgress && cloudProgress.syncMeta, nowMs);
  const cRec = cloudMeta.clients[cid];
  const tabRec = cRec && tTag && cRec.tabs ? cRec.tabs[tTag] : null;
  if (cRec && cRec.ack === 1 && cRec.g >= 1 && (!hasSuppliedGen || cRec.g === suppliedGen) && (!tTag || tabRec || !(cRec.evictedTabEpoch > 0))) {
    return {
      status: "active",
      clientId: cid,
      gen: cRec.g,
      tabTag: tTag,
      seq: tabRec ? tabRec.s : 0,
      baselineEpoch: cRec.b || cloudMeta.epoch || 0,
      syncEpoch: cloudMeta.epoch || 0,
      protocolVersion: MAX_SYNC_PROTOCOL_VERSION,
      minSupportedVersion: MAX_SYNC_PROTOCOL_VERSION,
    };
  }
  let reason = "CLIENT_RECONCILE_REQUIRED";
  if (!cRec && cloudMeta.evictedClientEpoch > 0) reason = "CLIENT_HISTORY_EVICTED";
  else if (cRec && hasSuppliedGen && cRec.g !== suppliedGen) reason = "CLIENT_GENERATION_MISMATCH";
  else if (cRec && cRec.ack !== 1) reason = "CLIENT_RECONCILE_REQUIRED";
  else if (cRec && tTag && !tabRec && cRec.evictedTabEpoch > 0) reason = "TAB_HISTORY_EVICTED";
  return {
    status: "reconcile_required",
    reason: reason,
    clientId: cid,
    gen: cRec && cRec.g ? cRec.g : 0,
    tabTag: tTag,
    seq: 0,
    baselineEpoch: cloudMeta.epoch || 0,
    syncEpoch: cloudMeta.epoch || 0,
    protocolVersion: MAX_SYNC_PROTOCOL_VERSION,
    minSupportedVersion: MAX_SYNC_PROTOCOL_VERSION,
  };
}

function fitSyncMetaIntoBudget(progressObj) {
  if (!progressObj || !progressObj.syncMeta) return progressObj;
  if (utf8ByteLength(JSON.stringify(progressObj)) <= MAX_PROGRESS_BYTES) return progressObj;
  const meta = progressObj.syncMeta;
  const slots = meta.slots || {};
  const pinnedSlotOps = new Set();
  if (slots.bmGlobal) pinnedSlotOps.add(slots.bmGlobal);
  if (slots.mkGlobal) pinnedSlotOps.add(slots.mkGlobal);
  [slots.bmSubj, slots.mkSubj, slots.bmDel, slots.mkDel].forEach(function (m) {
    if (m && typeof m === "object") Object.values(m).forEach(function (v) { if (v) pinnedSlotOps.add(v); });
  });
  if (meta.ops) {
    const nextOps = {};
    pinnedSlotOps.forEach(function (op) {
      if (Object.prototype.hasOwnProperty.call(meta.ops, op)) nextOps[op] = meta.ops[op];
    });
    if (Object.keys(nextOps).length) meta.ops = nextOps;
    else delete meta.ops;
  }
  if (utf8ByteLength(JSON.stringify(progressObj)) > MAX_PROGRESS_BYTES && meta.rawNorm) {
    delete meta.rawNorm;
  }
  if (utf8ByteLength(JSON.stringify(progressObj)) > MAX_PROGRESS_BYTES && meta.futureOps) {
    const nextFuture = {};
    pinnedSlotOps.forEach(function (op) {
      if (Object.prototype.hasOwnProperty.call(meta.futureOps, op)) nextFuture[op] = meta.futureOps[op];
    });
    if (Object.keys(nextFuture).length) meta.futureOps = nextFuture;
    else delete meta.futureOps;
  }
  return progressObj;
}

function applySyncReconcileInit(cloudProgress, rawClientId, rawTabTag, nowMs, studentId) {
  const cid = safeClientId(rawClientId);
  if (!cid) {
    return { abort: true, status: 400, code: "BAD_REQUEST", error: "Valid syncClientId is required." };
  }
  const tTag = safeTabTag(rawTabTag);
  if (!tTag) {
    return { abort: true, status: 400, code: "BAD_REQUEST", error: "Valid syncTabTag is required." };
  }
  const accountId = safeId(studentId, 120);
  const mergeNowMs = Number(nowMs) || Date.now();
  const cloud = cloudProgress && typeof cloudProgress === "object" ? cloudProgress : {};
  const cloudMeta = sanitizeSyncMetaFromCloud(cloud.syncMeta, mergeNowMs);
  const nextProgress = Object.assign({}, cloud);
  const nextEpoch = (cloudMeta.epoch || 0) + 1;
  const issuedGen = Math.min(MAX_CLIENT_GEN, cloudMeta.nextGen || 1);
  const nextGen = Math.min(MAX_CLIENT_GEN, issuedGen + 1);
  const challenge = randomHex(12);
  const nextPending = Object.assign({}, cloudMeta.pendingRegs);
  const pKey = pendingRegKey(cid, tTag);
  const pendingEntry = { c: cid, tab: tTag, g: issuedGen, b: nextEpoch, t: challenge, e: nextEpoch };
  if (accountId) pendingEntry.a = accountId;
  nextPending[pKey] = pendingEntry;
  const trimmedPending = trimPendingRegsMap(nextPending, MAX_PENDING_SYNC_REGS);
  const nextMeta = {
    v: MAX_SYNC_PROTOCOL_VERSION,
    epoch: nextEpoch,
    nextGen: nextGen,
    pendingRegs: trimmedPending,
  };
  if (cloudMeta.evictedClientEpoch > 0) nextMeta.evictedClientEpoch = cloudMeta.evictedClientEpoch;
  if (Object.keys(cloudMeta.clients).length) nextMeta.clients = cloudMeta.clients;
  if (Object.keys(cloudMeta.ops).length) nextMeta.ops = cloudMeta.ops;
  if (Object.keys(cloudMeta.futureOps).length) nextMeta.futureOps = cloudMeta.futureOps;
  const slotsNonEmpty = {};
  if (cloudMeta.slots.bmGlobal) slotsNonEmpty.bmGlobal = cloudMeta.slots.bmGlobal;
  if (cloudMeta.slots.mkGlobal) slotsNonEmpty.mkGlobal = cloudMeta.slots.mkGlobal;
  if (Object.keys(cloudMeta.slots.bmSubj).length) slotsNonEmpty.bmSubj = cloudMeta.slots.bmSubj;
  if (Object.keys(cloudMeta.slots.mkSubj).length) slotsNonEmpty.mkSubj = cloudMeta.slots.mkSubj;
  if (Object.keys(cloudMeta.slots.bmDel).length) slotsNonEmpty.bmDel = cloudMeta.slots.bmDel;
  if (Object.keys(cloudMeta.slots.mkDel).length) slotsNonEmpty.mkDel = cloudMeta.slots.mkDel;
  if (Object.keys(slotsNonEmpty).length) nextMeta.slots = slotsNonEmpty;
  const rawNormNonEmpty = {};
  if (cloudMeta.rawNorm.bmGlobal) rawNormNonEmpty.bmGlobal = cloudMeta.rawNorm.bmGlobal;
  if (cloudMeta.rawNorm.mkGlobal) rawNormNonEmpty.mkGlobal = cloudMeta.rawNorm.mkGlobal;
  ["bmSubj", "mkSubj", "bmDel", "mkDel", "bmItem", "mkItem"].forEach(function (k) {
    if (Object.keys(cloudMeta.rawNorm[k]).length) rawNormNonEmpty[k] = cloudMeta.rawNorm[k];
  });
  if (Object.keys(rawNormNonEmpty).length) nextMeta.rawNorm = rawNormNonEmpty;
  nextProgress.syncMeta = nextMeta;
  fitSyncMetaIntoBudget(nextProgress);
  return {
    abort: false,
    nextProgress: nextProgress,
    meta: {
      serverTime: mergeNowMs,
      syncEpoch: nextEpoch,
      registration: {
        status: "pending_ack",
        clientId: cid,
        gen: issuedGen,
        tabTag: tTag,
        challenge: challenge,
        baselineEpoch: nextEpoch,
        syncEpoch: nextEpoch,
        protocolVersion: MAX_SYNC_PROTOCOL_VERSION,
        minSupportedVersion: MAX_SYNC_PROTOCOL_VERSION,
      },
    },
  };
}

function applySyncReconcileAck(cloudProgress, rawClientId, rawTabTag, rawGen, rawChallenge, rawBaselineEpoch, nowMs, studentId) {
  const cid = safeClientId(rawClientId);
  if (!cid) {
    return { abort: true, status: 400, code: "BAD_REQUEST", error: "Valid syncClientId is required." };
  }
  const tTag = safeTabTag(rawTabTag);
  if (!tTag) {
    return { abort: true, status: 400, code: "BAD_REQUEST", error: "Valid syncTabTag is required." };
  }
  const accountId = safeId(studentId, 120);
  const suppliedGen = Number(rawGen);
  const suppliedBaseEpoch = Number(rawBaselineEpoch);
  const suppliedChallenge = typeof rawChallenge === "string" ? rawChallenge.trim() : "";
  const mergeNowMs = Number(nowMs) || Date.now();
  const cloud = cloudProgress && typeof cloudProgress === "object" ? cloudProgress : {};
  const cloudMeta = sanitizeSyncMetaFromCloud(cloud.syncMeta, mergeNowMs);
  const pKey = pendingRegKey(cid, tTag);
  const pending = cloudMeta.pendingRegs[pKey];
  const existingClient = cloudMeta.clients[cid];
  const genStaleVsActive = Boolean(existingClient && existingClient.ack === 1 && existingClient.g >= suppliedGen);
  const challengeMatches = Boolean(
    pending &&
    pending.c === cid &&
    pending.tab === tTag &&
    (!pending.a || !accountId || pending.a === accountId) &&
    Number.isSafeInteger(suppliedGen) &&
    pending.g === suppliedGen &&
    suppliedChallenge &&
    constantTimeEqual(pending.t, suppliedChallenge) &&
    Number.isSafeInteger(suppliedBaseEpoch) &&
    pending.b === suppliedBaseEpoch &&
    cloudMeta.epoch >= pending.b &&
    !genStaleVsActive
  );
  if (!challengeMatches) {
    const resync = buildSyncResyncResult("RECONCILE_CHALLENGE_MISMATCH", cloud, mergeNowMs, cloudMeta.epoch);
    return {
      abort: true,
      status: 409,
      code: resync.code,
      reason: resync.reason,
      error: resync.error,
      extra: resync,
    };
  }
  const nextEpoch = (cloudMeta.epoch || 0) + 1;
  const nextClients = {};
  Object.keys(cloudMeta.clients).forEach(function (k) {
    nextClients[k] = cloneClientRecord(cloudMeta.clients[k]);
  });
  const initialTabs = {};
  initialTabs[tTag] = { s: 0, e: nextEpoch };
  nextClients[cid] = {
    g: pending.g,
    s: 0,
    e: nextEpoch,
    b: pending.b,
    ack: 1,
    tabs: initialTabs,
  };
  const trimmedClients = trimClientsMap(nextClients, MAX_SYNC_CLIENTS, cloudMeta.evictedClientEpoch);
  const nextPending = Object.assign({}, cloudMeta.pendingRegs);
  delete nextPending[pKey];

  const nextProgress = Object.assign({}, cloud);
  const nextMeta = {
    v: MAX_SYNC_PROTOCOL_VERSION,
    epoch: nextEpoch,
    nextGen: Math.max(cloudMeta.nextGen || 1, pending.g + 1),
    clients: trimmedClients.clients,
  };
  if (trimmedClients.evictedClientEpoch > 0) nextMeta.evictedClientEpoch = trimmedClients.evictedClientEpoch;
  if (Object.keys(nextPending).length) nextMeta.pendingRegs = nextPending;
  if (Object.keys(cloudMeta.ops).length) nextMeta.ops = cloudMeta.ops;
  if (Object.keys(cloudMeta.futureOps).length) nextMeta.futureOps = cloudMeta.futureOps;
  const slotsNonEmpty = {};
  if (cloudMeta.slots.bmGlobal) slotsNonEmpty.bmGlobal = cloudMeta.slots.bmGlobal;
  if (cloudMeta.slots.mkGlobal) slotsNonEmpty.mkGlobal = cloudMeta.slots.mkGlobal;
  if (Object.keys(cloudMeta.slots.bmSubj).length) slotsNonEmpty.bmSubj = cloudMeta.slots.bmSubj;
  if (Object.keys(cloudMeta.slots.mkSubj).length) slotsNonEmpty.mkSubj = cloudMeta.slots.mkSubj;
  if (Object.keys(cloudMeta.slots.bmDel).length) slotsNonEmpty.bmDel = cloudMeta.slots.bmDel;
  if (Object.keys(cloudMeta.slots.mkDel).length) slotsNonEmpty.mkDel = cloudMeta.slots.mkDel;
  if (Object.keys(slotsNonEmpty).length) nextMeta.slots = slotsNonEmpty;
  const rawNormNonEmpty = {};
  if (cloudMeta.rawNorm.bmGlobal) rawNormNonEmpty.bmGlobal = cloudMeta.rawNorm.bmGlobal;
  if (cloudMeta.rawNorm.mkGlobal) rawNormNonEmpty.mkGlobal = cloudMeta.rawNorm.mkGlobal;
  ["bmSubj", "mkSubj", "bmDel", "mkDel", "bmItem", "mkItem"].forEach(function (k) {
    if (Object.keys(cloudMeta.rawNorm[k]).length) rawNormNonEmpty[k] = cloudMeta.rawNorm[k];
  });
  if (Object.keys(rawNormNonEmpty).length) nextMeta.rawNorm = rawNormNonEmpty;
  nextProgress.syncMeta = nextMeta;
  fitSyncMetaIntoBudget(nextProgress);
  return {
    abort: false,
    nextProgress: nextProgress,
    meta: {
      serverTime: mergeNowMs,
      syncEpoch: nextEpoch,
      registration: {
        status: "active",
        clientId: cid,
        gen: pending.g,
        tabTag: tTag,
        seq: 0,
        baselineEpoch: pending.b,
        syncEpoch: nextEpoch,
        protocolVersion: MAX_SYNC_PROTOCOL_VERSION,
        minSupportedVersion: MAX_SYNC_PROTOCOL_VERSION,
      },
    },
  };
}

function isMissingCasColumnError(err) {
  const msg = err && err.message ? err.message : String(err || "");
  return /(?:no such column|has no column named):?.*\bprogress_(?:rev|write_id)\b/i.test(msg);
}

function isEnvWriteFrozen(env) {
  return Boolean(
    env && (
      env.PROGRESS_WRITE_FREEZE === "1" ||
      env.PROGRESS_WRITE_FREEZE === true ||
      env.MAINTENANCE_WRITE_FREEZE === "1" ||
      env.MAINTENANCE_WRITE_FREEZE === true
    )
  );
}

function isRequireProgressCas(env) {
  return Boolean(env && (env.REQUIRE_PROGRESS_CAS === "1" || env.REQUIRE_PROGRESS_CAS === true));
}

async function isDbWriteFrozen(env) {
  if (!env || !env.DB) return false;
  try {
    const row = await env.DB.prepare("SELECT config_json FROM admin_config WHERE config_key = 'progress_write_fence'").first();
    if (!row || !row.config_json) return false;
    try {
      const parsed = JSON.parse(row.config_json);
      return Boolean(parsed && (parsed.frozen === true || parsed.frozen === 1 || parsed.frozen === "1" || parsed.frozen === "true"));
    } catch (_e) {
      return /"frozen"\s*:\s*(true|1|"true"|"1")/.test(String(row.config_json));
    }
  } catch (_err) {
    return false;
  }
}

async function requireProgressWriteFenceClear(env) {
  if (isEnvWriteFrozen(env) || (await isDbWriteFrozen(env))) {
    return jsonResponse(
      {
        ok: false,
        error: "Synchronization writes are temporarily paused for database maintenance. Your local progress is preserved; please retry shortly.",
        code: "MAINTENANCE_WRITE_FREEZE",
      },
      503,
      { "Retry-After": "30" }
    );
  }
  return null;
}

const SQL_WRITE_FENCE_PREDICATE =
  "NOT EXISTS (SELECT 1 FROM admin_config WHERE config_key = 'progress_write_fence' AND (" +
  "(json_valid(config_json) AND json_extract(config_json, '$.frozen') IN (1, '1', 'true')) OR " +
  "(NOT json_valid(config_json) AND replace(replace(replace(config_json, ' ', ''), char(9), ''), char(10), '') LIKE '%\"frozen\":true%')" +
  "))";

async function readUserProgressSnapshot(env, studentId) {
  let row = null;
  let hasRevCols = true;
  try {
    row = await env.DB.prepare(
      "SELECT student_id, username, display_name, password_hash, is_admin, progress_json, progress_rev FROM users WHERE student_id = ?1"
    ).bind(studentId).first();
  } catch (err) {
    if (!isMissingCasColumnError(err)) throw err;
    hasRevCols = false;
    row = await env.DB.prepare(
      "SELECT student_id, username, display_name, password_hash, is_admin, progress_json FROM users WHERE student_id = ?1"
    ).bind(studentId).first();
  }
  if (!row) return null;
  let progress = {};
  try { progress = JSON.parse((row && row.progress_json) || "{}"); } catch (_e) { progress = {}; }
  return {
    user: row,
    rawJson: String(row.progress_json == null ? "{}" : row.progress_json),
    rev: hasRevCols ? (Number(row.progress_rev) || 0) : 0,
    hasRevCols: hasRevCols,
    progress: progress && typeof progress === "object" && !Array.isArray(progress) ? progress : {},
  };
}

async function saveProgressWithCas(env, studentId, snapshot, nextProgress, casOpts) {
  const opts = casOpts || {};
  const upgradeHash = typeof opts.upgradePasswordHash === "string" && opts.upgradePasswordHash ? opts.upgradePasswordHash : "";
  const rehashPasswordHash = typeof opts.rehashPasswordHash === "string" && opts.rehashPasswordHash ? opts.rehashPasswordHash : "";
  const sessionTokenHash = typeof opts.sessionTokenHash === "string" && opts.sessionTokenHash ? opts.sessionTokenHash : "";

  let json = "";
  try {
    json = JSON.stringify(nextProgress);
  } catch (_e) {
    return { ok: false, badPayload: true };
  }
  if (utf8ByteLength(json) > MAX_PROGRESS_BYTES) {
    return { ok: false, tooLarge: true };
  }
  const bookmarksJson = JSON.stringify(nextProgress.bookmarks || []);
  const mistakesJson = JSON.stringify(nextProgress.mistakes || {});
  const lecturesJson = JSON.stringify(nextProgress.lectureStats || {});
  const nowMs = Date.now();

  let batchRes;
  if (snapshot.hasRevCols) {
    const expectedRev = Number(snapshot.rev) || 0;
    const nextRev = expectedRev + 1;
    const writeId = randomHex(16);
    const setParts = [
      "progress_json = ?1",
      "progress_rev = ?2",
      "progress_write_id = ?3",
      "updated_at = datetime('now')",
    ];
    const updBinds = [json, nextRev, writeId, studentId, expectedRev];
    const whereParts = ["student_id = ?4", "progress_rev = ?5", SQL_WRITE_FENCE_PREDICATE];
    // For rev === 0 rows right after Migration 0008, also check prior JSON when within D1 binding size
    // so an in-flight pre-0008 fallback write that did not bump progress_rev is never silently overwritten.
    if (expectedRev === 0 && utf8ByteLength(snapshot.rawJson) <= MAX_PROGRESS_BYTES) {
      updBinds.push(snapshot.user && snapshot.user.progress_json === null ? null : snapshot.rawJson);
      whereParts.push("progress_json IS ?" + updBinds.length);
    }
    if (upgradeHash) {
      updBinds.push(upgradeHash);
      setParts.push("password_hash = ?" + updBinds.length);
      whereParts.push("(password_hash IS NULL OR password_hash = '')");
    } else if (rehashPasswordHash) {
      updBinds.push(rehashPasswordHash);
      setParts.push("password_hash = ?" + updBinds.length);
    }
    if (sessionTokenHash) {
      updBinds.push(sessionTokenHash, nowMs);
      const tokIdx = updBinds.length - 1;
      const expIdx = updBinds.length;
      whereParts.push(
        "EXISTS (SELECT 1 FROM user_sessions us WHERE us.token_hash = ?" + tokIdx +
        " AND us.student_id = users.student_id AND us.expires_at > ?" + expIdx + ")"
      );
    }
    const stmt0 = env.DB.prepare(
      "UPDATE users SET " + setParts.join(", ") + " WHERE " + whereParts.join(" AND ")
    );
    const stmt1 = env.DB.prepare(
      "INSERT INTO student_progress (student_id, bookmarks_json, mistakes_json, completed_lectures_json, updated_at) " +
      "SELECT student_id, ?2, ?3, ?4, datetime('now') FROM users WHERE student_id = ?1 AND progress_rev = ?5 AND progress_write_id = ?6 " +
      "ON CONFLICT(student_id) DO UPDATE SET bookmarks_json = excluded.bookmarks_json, mistakes_json = excluded.mistakes_json, completed_lectures_json = excluded.completed_lectures_json, updated_at = datetime('now')"
    );
    batchRes = await env.DB.batch([
      stmt0.bind.apply(stmt0, updBinds),
      stmt1.bind(studentId, bookmarksJson, mistakesJson, lecturesJson, nextRev, writeId),
    ]);
    const updatedChanges = Number(batchRes && batchRes[0] && batchRes[0].meta && batchRes[0].meta.changes) || 0;
    if (updatedChanges === 1) return { ok: true, rev: nextRev, json: json };
  } else {
    const rawSnap = snapshot.user && snapshot.user.progress_json === null ? null : snapshot.rawJson;
    const setParts = ["progress_json = ?1", "updated_at = datetime('now')"];
    const updBinds = [json, studentId, rawSnap];
    const whereParts = ["student_id = ?2", "progress_json IS ?3", SQL_WRITE_FENCE_PREDICATE];
    const mirrorWhere = ["student_id = ?1", "progress_json = ?5"];
    const mirrorBinds = [studentId, bookmarksJson, mistakesJson, lecturesJson, json];
    if (upgradeHash) {
      updBinds.push(upgradeHash);
      setParts.push("password_hash = ?" + updBinds.length);
      whereParts.push("(password_hash IS NULL OR password_hash = '')");
      mirrorBinds.push(upgradeHash);
      mirrorWhere.push("password_hash = ?" + mirrorBinds.length);
    } else if (rehashPasswordHash) {
      updBinds.push(rehashPasswordHash);
      setParts.push("password_hash = ?" + updBinds.length);
      mirrorBinds.push(rehashPasswordHash);
      mirrorWhere.push("password_hash = ?" + mirrorBinds.length);
    }
    if (sessionTokenHash) {
      updBinds.push(sessionTokenHash, nowMs);
      const tokIdx = updBinds.length - 1;
      const expIdx = updBinds.length;
      whereParts.push(
        "EXISTS (SELECT 1 FROM user_sessions us WHERE us.token_hash = ?" + tokIdx +
        " AND us.student_id = users.student_id AND us.expires_at > ?" + expIdx + ")"
      );
    }
    const stmt0 = env.DB.prepare(
      "UPDATE users SET " + setParts.join(", ") + " WHERE " + whereParts.join(" AND ")
    );
    const stmt1 = env.DB.prepare(
      "INSERT INTO student_progress (student_id, bookmarks_json, mistakes_json, completed_lectures_json, updated_at) " +
      "SELECT student_id, ?2, ?3, ?4, datetime('now') FROM users WHERE " + mirrorWhere.join(" AND ") + " " +
      "ON CONFLICT(student_id) DO UPDATE SET bookmarks_json = excluded.bookmarks_json, mistakes_json = excluded.mistakes_json, completed_lectures_json = excluded.completed_lectures_json, updated_at = datetime('now')"
    );
    batchRes = await env.DB.batch([
      stmt0.bind.apply(stmt0, updBinds),
      stmt1.bind.apply(stmt1, mirrorBinds),
    ]);
    const updatedChanges = Number(batchRes && batchRes[0] && batchRes[0].meta && batchRes[0].meta.changes) || 0;
    if (updatedChanges === 1) return { ok: true, rev: 0, json: json };
  }
  if (await isDbWriteFrozen(env)) return { ok: false, frozen: true };
  const exists = await env.DB.prepare("SELECT 1 AS x FROM users WHERE student_id = ?1").bind(studentId).first();
  if (!exists) return { ok: false, notFound: true };
  if (sessionTokenHash) {
    const sessRow = await env.DB.prepare(
      "SELECT 1 AS x FROM user_sessions WHERE token_hash = ?1 AND student_id = ?2 AND expires_at > ?3"
    ).bind(sessionTokenHash, studentId, Date.now()).first();
    if (!sessRow) return { ok: false, unauthorized: true };
  }
  return { ok: false, conflict: true };
}

async function insertUserWithProgress(env, userFields, initialProgress) {
  if (isEnvWriteFrozen(env) || (await isDbWriteFrozen(env))) {
    return { ok: false, frozen: true };
  }
  const json = JSON.stringify(initialProgress);
  if (utf8ByteLength(json) > MAX_PROGRESS_BYTES) return { ok: false, tooLarge: true };
  const bookmarksJson = JSON.stringify(initialProgress.bookmarks || []);
  const mistakesJson = JSON.stringify(initialProgress.mistakes || {});
  const lecturesJson = JSON.stringify(initialProgress.lectureStats || {});
  const writeId = randomHex(16);
  try {
    const batchRes = await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO users (student_id, username, display_name, username_change_count, password_hash, is_admin, progress_json, progress_rev, progress_write_id) " +
        "SELECT ?1, ?2, ?3, 0, ?4, 0, ?5, 1, ?6 WHERE " + SQL_WRITE_FENCE_PREDICATE
      ).bind(userFields.studentId, userFields.username, userFields.displayName, userFields.passwordHash || "", json, writeId),
      env.DB.prepare(
        "INSERT INTO student_progress (student_id, bookmarks_json, mistakes_json, completed_lectures_json, updated_at) " +
        "SELECT student_id, ?2, ?3, ?4, datetime('now') FROM users WHERE student_id = ?1 AND progress_rev = 1 AND progress_write_id = ?5 AND " + SQL_WRITE_FENCE_PREDICATE + " " +
        "ON CONFLICT(student_id) DO UPDATE SET bookmarks_json = excluded.bookmarks_json, mistakes_json = excluded.mistakes_json, completed_lectures_json = excluded.completed_lectures_json, updated_at = datetime('now')"
      ).bind(userFields.studentId, bookmarksJson, mistakesJson, lecturesJson, writeId)
    ]);
    const inserted = Number(batchRes && batchRes[0] && batchRes[0].meta && batchRes[0].meta.changes) || 0;
    if (inserted === 1) return { ok: true };
    if (await isDbWriteFrozen(env)) return { ok: false, frozen: true };
    return { ok: false, usernameTaken: true };
  } catch (err) {
    if (isMissingCasColumnError(err)) {
      if (isRequireProgressCas(env)) {
        return { ok: false, require0008: true };
      }
      try {
        const fallbackBatch = await env.DB.batch([
          env.DB.prepare(
            "INSERT INTO users (student_id, username, display_name, username_change_count, password_hash, is_admin, progress_json) " +
            "SELECT ?1, ?2, ?3, 0, ?4, 0, ?5 WHERE " + SQL_WRITE_FENCE_PREDICATE
          ).bind(userFields.studentId, userFields.username, userFields.displayName, userFields.passwordHash || "", json),
          env.DB.prepare(
            "INSERT INTO student_progress (student_id, bookmarks_json, mistakes_json, completed_lectures_json, updated_at) " +
            "SELECT student_id, ?2, ?3, ?4, datetime('now') FROM users WHERE student_id = ?1 AND " + SQL_WRITE_FENCE_PREDICATE + " " +
            "ON CONFLICT(student_id) DO UPDATE SET bookmarks_json = excluded.bookmarks_json, mistakes_json = excluded.mistakes_json, completed_lectures_json = excluded.completed_lectures_json, updated_at = datetime('now')"
          ).bind(userFields.studentId, bookmarksJson, mistakesJson, lecturesJson)
        ]);
        const fallbackInserted = Number(fallbackBatch && fallbackBatch[0] && fallbackBatch[0].meta && fallbackBatch[0].meta.changes) || 0;
        if (fallbackInserted === 1) return { ok: true };
        if (await isDbWriteFrozen(env)) return { ok: false, frozen: true };
        return { ok: false, usernameTaken: true };
      } catch (innerErr) {
        return { ok: false, usernameTaken: true, err: innerErr };
      }
    }
    return { ok: false, usernameTaken: true, err: err };
  }
}

async function runProgressCasUpdate(env, studentId, computeNextFn, casOpts) {
  if (isEnvWriteFrozen(env) || (await isDbWriteFrozen(env))) {
    return {
      ok: false,
      status: 503,
      code: "MAINTENANCE_WRITE_FREEZE",
      error: "Synchronization writes are temporarily paused for database maintenance. Your local progress is preserved; please retry shortly.",
    };
  }
  for (let attempt = 0; attempt < MAX_PROGRESS_CAS_RETRIES; attempt += 1) {
    const snap = await readUserProgressSnapshot(env, studentId);
    if (!snap) {
      return { ok: false, status: 401, code: "AUTH_REQUIRED", error: "Authentication required." };
    }
    if (!snap.hasRevCols && isRequireProgressCas(env)) {
      return {
        ok: false,
        status: 503,
        code: "MIGRATION_0008_REQUIRED",
        error: "Database migration 0008 is required before progress writes can proceed.",
      };
    }
    const step = await computeNextFn(snap);
    if (step.abort) return step;
    const cas = await saveProgressWithCas(env, studentId, snap, step.nextProgress, step.casOpts || casOpts);
    if (cas.ok) {
      return Object.assign({ ok: true, progress: step.nextProgress, rev: cas.rev }, step.meta || {});
    }
    if (cas.frozen) {
      return {
        ok: false,
        status: 503,
        code: "MAINTENANCE_WRITE_FREEZE",
        error: "Synchronization writes are temporarily paused for database maintenance. Your local progress is preserved; please retry shortly.",
      };
    }
    if (cas.tooLarge) {
      return { ok: false, status: 413, code: "TOO_LARGE", error: "Progress data too large." };
    }
    if (cas.badPayload) {
      return { ok: false, status: 400, code: "BAD_REQUEST", error: "Invalid progress payload." };
    }
    if (cas.notFound || cas.unauthorized) {
      return { ok: false, status: 401, code: "AUTH_REQUIRED", error: "Authentication required." };
    }
  }
  return { ok: false, status: 409, code: "SYNC_CONTENTION", error: "Concurrent synchronization update in progress. Please retry." };
}

// ---------------------------------------------------------------------------
// Quiz grading (server side only)
// ---------------------------------------------------------------------------
function getCollection(subjectId, quizId) {
  const collections = (answerKeyModule && answerKeyModule.collections) || {};
  const entry = collections[subjectId + "::" + quizId];
  return entry && entry.answers ? entry : null;
}

/**
 * Grade a submission against the private answer key.
 * Returns { ok:false, status, code, error } or { ok:true, score, total, answered, percentage, complete }.
 * `total` always comes from the key (never from the client); unanswered questions count as wrong.
 */
function gradeQuizSubmission(payload, overrideCollection) {
  const subjectId = safeId(payload && payload.subjectId, 120);
  const quizId = safeId(payload && payload.quizId, 120);
  const collection = (overrideCollection && overrideCollection.answers) ? overrideCollection : getCollection(subjectId, quizId);
  if (!collection) return { ok: false, status: 400, code: "UNKNOWN_QUIZ", error: "Unknown quiz." };

  const answers = payload && payload.answers;
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
    return { ok: false, status: 400, code: "ANSWERS_REQUIRED", error: "A map of answers is required." };
  }
  const keys = Object.keys(answers);
  if (keys.length === 0) return { ok: false, status: 400, code: "ANSWERS_REQUIRED", error: "At least one answer is required." };
  if (keys.length > MAX_ANSWERS_PER_SUBMISSION) return { ok: false, status: 400, code: "TOO_MANY_ANSWERS", error: "Too many answers." };

  const expectedMap = collection.answers;
  const ungradable = new Set(collection.ungradableIds || []);
  // Both the composite internal id and the legacy short id map to one question; count each question once.
  const answeredQuestions = new Set();
  let correct = 0;
  for (let i = 0; i < keys.length; i += 1) {
    const qKey = keys[i];
    const rawValue = answers[qKey];
    if (qKey.length > 200 || typeof rawValue !== "string" || !/^[A-Za-z0-9]{1,4}$/.test(rawValue.trim())) {
      return { ok: false, status: 400, code: "BAD_ANSWER_FORMAT", error: "Malformed answer entry." };
    }
    if (!Object.prototype.hasOwnProperty.call(expectedMap, qKey)) {
      if (ungradable.has(qKey)) continue; // real question without a recorded key: ignored
      return { ok: false, status: 400, code: "UNKNOWN_QUESTION", error: "A submitted question does not belong to this quiz." };
    }
    const expected = String(expectedMap[qKey]).trim().toUpperCase();
    const questionIdentity = expected + "|" + (qKey.indexOf("::") !== -1 ? qKey.split("::").pop() : qKey);
    if (answeredQuestions.has(questionIdentity)) continue;
    answeredQuestions.add(questionIdentity);
    if (rawValue.trim().toUpperCase() === expected) correct += 1;
  }
  const total = Number(collection.gradableQuestions) || 0;
  const answered = answeredQuestions.size;
  if (total <= 0 || answered === 0) return { ok: false, status: 400, code: "NOTHING_TO_GRADE", error: "Nothing to grade." };
  if (answered > total) return { ok: false, status: 400, code: "TOO_MANY_ANSWERS", error: "More answers than questions." };
  const score = Math.min(correct, total);
  return {
    ok: true,
    subjectId: subjectId,
    quizId: quizId,
    score: score,
    total: total,
    answered: answered,
    percentage: Math.round((score / total) * 1000) / 10,
    complete: answered >= total
  };
}

// ---------------------------------------------------------------------------
// User deletion helper (children first; works with or without FK enforcement)
// ---------------------------------------------------------------------------
async function deleteUserData(env, studentId) {
  if (isEnvWriteFrozen(env) || (await isDbWriteFrozen(env))) {
    return { ok: false, frozen: true };
  }
  const batchRes = await env.DB.batch([
    env.DB.prepare("DELETE FROM user_sessions WHERE student_id = ?1 AND " + SQL_WRITE_FENCE_PREDICATE).bind(studentId),
    env.DB.prepare("DELETE FROM student_progress WHERE student_id = ?1 AND " + SQL_WRITE_FENCE_PREDICATE).bind(studentId),
    env.DB.prepare("DELETE FROM best_scores WHERE student_id = ?1 AND " + SQL_WRITE_FENCE_PREDICATE).bind(studentId),
    env.DB.prepare("DELETE FROM quiz_attempts WHERE student_id = ?1 AND " + SQL_WRITE_FENCE_PREDICATE).bind(studentId),
    env.DB.prepare("DELETE FROM users WHERE student_id = ?1 AND " + SQL_WRITE_FENCE_PREDICATE).bind(studentId),
    env.DB.prepare("DELETE FROM admin_config WHERE config_key = ?1 AND " + SQL_WRITE_FENCE_PREDICATE).bind(quizGateKey({ studentId }))
  ]);
  const deletedUsers = Number(batchRes && batchRes[4] && batchRes[4].meta && batchRes[4].meta.changes) || 0;
  if (deletedUsers === 0 && (await isDbWriteFrozen(env))) {
    return { ok: false, frozen: true };
  }
  await removeOnlineUser(env, studentId);
  return { ok: true, deleted: deletedUsers > 0 };
}

// ---------------------------------------------------------------------------
// Content overlay validation (admin-managed library, shared with all students)
// ---------------------------------------------------------------------------
const OVERLAY_LIMITS = { pdfs: 500, pdfCategories: 200, videos: 500, images: 500 };
const URL_FIELDS = ["url", "path", "src", "thumbnail", "thumbnailUrl", "embedUrl", "href"];

function isSafeUrlValue(value) {
  const s = String(value).trim();
  if (!s) return true;
  if (/^https?:\/\//i.test(s)) return true;
  if (s.indexOf("..") !== -1 || s.indexOf("\\") !== -1) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return false; // javascript:, data:, blob:, file: ...
  if (s.startsWith("//")) return false;
  return true;
}

function sanitizeHttpUrl(value, allowTelegramHandle) {
  const raw = String(value == null ? "" : value).trim();
  if (!raw) return { ok: true, value: "" };
  if (allowTelegramHandle && /^@[A-Za-z0-9_]{3,64}$/.test(raw)) {
    return { ok: true, value: raw };
  }
  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return { ok: true, value: raw.slice(0, 500) };
      }
    } catch (_e) { /* invalid URL */ }
    return { ok: false, value: "" };
  }
  if (raw.startsWith("/") && !raw.startsWith("//") && raw.indexOf("..") === -1 && raw.indexOf("\\") === -1) {
    return { ok: true, value: raw.slice(0, 500) };
  }
  return { ok: false, value: "" };
}

function sanitizeSiteSettings(settings) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return { ok: false, error: "settings object required." };
  }
  const clone = Object.assign({}, settings);
  ["bannerUrl", "countdownLink", "ctaUrl", "logoUrl"].forEach(function (k) {
    if (typeof clone[k] === "string" && clone[k].trim()) {
      const checked = sanitizeHttpUrl(clone[k], false);
      if (!checked.ok) clone[k] = "__INVALID_URL__";
      else clone[k] = checked.value;
    }
  });
  for (let i = 0; i < ["bannerUrl", "countdownLink", "ctaUrl", "logoUrl"].length; i += 1) {
    const k = ["bannerUrl", "countdownLink", "ctaUrl", "logoUrl"][i];
    if (clone[k] === "__INVALID_URL__") {
      return { ok: false, error: "Unsafe URL in settings field: " + k };
    }
  }
  if (Array.isArray(clone.teamMembers)) {
    const cleanMembers = [];
    for (let i = 0; i < Math.min(clone.teamMembers.length, 50); i += 1) {
      const m = clone.teamMembers[i];
      if (!m || typeof m !== "object" || Array.isArray(m)) continue;
      const member = Object.assign({}, m);
      const urlKeys = ["web", "telegram", "linkedin", "github", "avatar", "url"];
      for (let u = 0; u < urlKeys.length; u += 1) {
        const uk = urlKeys[u];
        if (typeof member[uk] === "string" && member[uk].trim()) {
          const checked = sanitizeHttpUrl(member[uk], uk === "telegram");
          if (!checked.ok) {
            return { ok: false, error: "Unsafe URL in team member field: " + uk };
          }
          member[uk] = checked.value;
        }
      }
      cleanMembers.push(member);
    }
    clone.teamMembers = cleanMembers;
  }
  if (clone.offlineDownloads !== undefined) {
    if (!clone.offlineDownloads || typeof clone.offlineDownloads !== "object" || Array.isArray(clone.offlineDownloads)) {
      return { ok: false, error: "offlineDownloads must be an object." };
    }
    const od = clone.offlineDownloads;
    const validMode = (v) => (v === "all" || v === "selected" ? v : "disabled");
    const cleanIdList = (arr) => {
      if (!Array.isArray(arr)) return [];
      const out = [];
      const seen = new Set();
      for (let i = 0; i < Math.min(arr.length, 500); i += 1) {
        const v = String(arr[i] || "").trim().slice(0, 140);
        if (!v || !/^[a-zA-Z0-9_.:/*-]+$/.test(v) || seen.has(v)) continue;
        seen.add(v);
        out.push(v);
      }
      return out;
    };
    clone.offlineDownloads = {
      quizzesMode: validMode(od.quizzesMode),
      lecturesMode: validMode(od.lecturesMode),
      allowedQuizIds: cleanIdList(od.allowedQuizIds),
      allowedLectureIds: cleanIdList(od.allowedLectureIds),
    };
  }
  return { ok: true, settings: clone };
}

function utcDayOffset(dateStr, deltaDays) {
  const d = new Date(dateStr + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return "";
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function computeStreakFromDates(dateStrings) {
  const unique = Array.from(new Set((dateStrings || []).filter(function (s) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
  }))).sort().reverse();
  if (!unique.length) return 0;
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = utcDayOffset(today, -1);
  if (unique[0] !== today && unique[0] !== yesterday) return 0;
  let streak = 1;
  let cursor = unique[0];
  for (let i = 1; i < unique.length; i += 1) {
    const expectedPrev = utcDayOffset(cursor, -1);
    if (unique[i] === expectedPrev) {
      streak += 1;
      cursor = unique[i];
    } else if (unique[i] < expectedPrev) {
      break;
    }
  }
  return streak;
}

function computeBadges(metrics) {
  const quizzesCount = Number(metrics && metrics.quizzesCount) || 0;
  const bestPct = Number(metrics && metrics.bestPct) || 0;
  const fastestDurationMs = Number(metrics && metrics.fastestDurationMs) || 0;
  const streakDays = Number(metrics && metrics.streakDays) || 0;
  const xp = Number(metrics && metrics.xp) || 0;
  const out = [];
  if (quizzesCount >= 1) out.push({ id: "first_quiz", label: "First Steps", icon: "🌱" });
  if (streakDays >= 3) out.push({ id: "streak_3", label: streakDays + "d Streak", icon: "🔥" });
  if (streakDays >= 7) out.push({ id: "streak_7", label: "7-Day Focus", icon: "📅" });
  if (bestPct >= 100 && quizzesCount >= 1) out.push({ id: "perfect_100", label: "100% Perfect", icon: "💯" });
  else if (bestPct >= 95 && quizzesCount >= 1) out.push({ id: "ace_95", label: "95%+ Ace", icon: "🎯" });
  if (quizzesCount >= 5) out.push({ id: "explorer_5", label: "Quiz Explorer", icon: "🧭" });
  if (quizzesCount >= 15) out.push({ id: "scholar_15", label: "Scholar", icon: "🎓" });
  if (fastestDurationMs > 0 && fastestDurationMs <= 120000 && quizzesCount >= 1) out.push({ id: "speed_runner", label: "Fast Finisher", icon: "⚡" });
  if (xp >= 1000) out.push({ id: "xp_1000", label: "1K+ XP", icon: "🏆" });
  return out;
}

async function getUserStudyStats(env, studentId) {
  if (!env || !env.DB || !studentId) return { xp: 0, streakDays: 0, quizzesCount: 0, bestPct: 0, badges: [] };
  const agg = await env.DB.prepare(
    "SELECT COUNT(*) AS quizzesCount, COALESCE(SUM(" + XP_SQL + "), 0) AS xp, " +
    "COALESCE(MAX(b.best_percentage), 0) AS bestPct, COALESCE(MIN(NULLIF(b.fastest_duration_ms, 0)), 0) AS fastestDurationMs " +
    "FROM best_scores b WHERE b.student_id = ?1 AND b.validated_by_server = 1"
  ).bind(studentId).first();
  const daysRes = await env.DB.prepare(
    "SELECT DISTINCT substr(submitted_at, 1, 10) AS day FROM quiz_attempts WHERE student_id = ?1 AND validated_by_server = 1 ORDER BY day DESC LIMIT 60"
  ).bind(studentId).all();
  const dayList = ((daysRes && daysRes.results) || []).map(function (r) { return r.day; });
  const quizzesCount = Number(agg && agg.quizzesCount) || 0;
  const xp = Number(agg && agg.xp) || 0;
  const bestPct = Number(agg && agg.bestPct) || 0;
  const fastestDurationMs = Number(agg && agg.fastestDurationMs) || 0;
  const streakDays = computeStreakFromDates(dayList);
  const badges = computeBadges({ quizzesCount, bestPct, fastestDurationMs, streakDays, xp });
  return { xp, streakDays, quizzesCount, bestPct, badges };
}

function cleanOverlayItem(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  if (!safeId(item.id, 160)) return null;
  const out = {};
  const keys = Object.keys(item);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    const value = item[key];
    if (key === "__proto__" || key === "constructor") continue;
    if (typeof value === "string") {
      if (value.length > 4000) return null;
      if (URL_FIELDS.indexOf(key) !== -1 && !isSafeUrlValue(value)) return null;
      out[key] = value;
    } else if (typeof value === "number" || typeof value === "boolean" || value === null) {
      out[key] = value;
    } else if (Array.isArray(value) && value.length <= 100 && value.every(function (v) { return typeof v === "string" && v.length <= 400; })) {
      out[key] = value;
    }
    // nested objects are dropped on purpose
  }
  return out;
}

/** Returns { ok, overlay } | { ok:false, error }. */
function sanitizeOverlay(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "Overrides must be an object." };
  const overlay = { schemaVersion: 1, removed: {}, updatedAt: new Date().toISOString() };
  const types = Object.keys(OVERLAY_LIMITS);
  for (let t = 0; t < types.length; t += 1) {
    const type = types[t];
    const list = Array.isArray(raw[type]) ? raw[type] : [];
    if (list.length > OVERLAY_LIMITS[type]) return { ok: false, error: "Too many " + type + "." };
    overlay[type] = [];
    for (let i = 0; i < list.length; i += 1) {
      const cleaned = cleanOverlayItem(list[i]);
      if (!cleaned) return { ok: false, error: "Invalid entry in " + type + "." };
      overlay[type].push(cleaned);
    }
    const removed = raw.removed && Array.isArray(raw.removed[type]) ? raw.removed[type] : [];
    overlay.removed[type] = removed.filter(function (id) { return typeof id === "string" && id.length <= 160; }).slice(0, OVERLAY_LIMITS[type] * 2);
  }
  if (utf8ByteLength(JSON.stringify(overlay)) > MAX_OVERLAY_BYTES) return { ok: false, error: "Content library is too large." };
  return { ok: true, overlay: overlay };
}

function overlayContentSignature(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return "";
  const canonical = {};
  Object.keys(item).sort().forEach(function (k) {
    if (k === "__proto__" || k === "constructor" || k === "active" || k === "updatedAt") return;
    if (item[k] !== undefined) canonical[k] = item[k];
  });
  return JSON.stringify(canonical);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
const XP_SQL =
  "(b.best_score * 10 + CASE " +
  "WHEN b.best_score * 100.0 / MAX(b.total, 1) >= 95 THEN b.best_score * 5 " +
  "WHEN b.best_score * 100.0 / MAX(b.total, 1) >= 85 THEN b.best_score * 3 " +
  "WHEN b.best_score * 100.0 / MAX(b.total, 1) >= 70 THEN b.best_score ELSE 0 END + 25)";

async function handleApiRequest(request, env) {
  try {
    return await route(request, env);
  } catch (err) {
    // Never leak internals to clients.
    if (typeof console !== "undefined" && console.error) console.error("API error:", err && err.stack ? err.stack : err);
    return fail(500, "Internal server error.", "INTERNAL");
  }
}

async function route(request, env) {
  const url = new URL(request.url);
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  const method = (request.method || "GET").toUpperCase();

  if (method === "OPTIONS") {
    // The app is same-origin; no cross-origin access is granted.
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  }

  // Cross-site request protection for cookie-authenticated writes.
  if (method !== "GET" && method !== "HEAD") {
    const origin = request.headers.get("Origin");
    if (origin) {
      let originHost = "";
      try { originHost = new URL(origin).host; } catch (_e) { /* invalid */ }
      if (originHost !== url.host) return fail(403, "Cross-origin request blocked.", "CROSS_ORIGIN");
    }
  }

  if (pathname === "/api/health" && method === "GET") {
    return jsonResponse({ ok: true, service: "elgo-lab-api" });
  }

  const dbRequired = pathname !== "/api/health";
  if (dbRequired && (!env || !env.DB)) return fail(503, "Database is not available.", "DB_UNBOUND");

  if (pathname === "/api/presence" && method === "POST") return handlePresence(request, env);

  // ---- Auth ---------------------------------------------------------------
  if (pathname === "/api/auth/guest" && method === "POST") return handleGuest(request, env);
  if (pathname === "/api/auth/upgrade" && method === "POST") return handleGuestUpgrade(request, env);
  if ((pathname === "/api/auth/register" || pathname === "/api/auth/login") && method === "POST") {
    return pathname.endsWith("register") ? handleRegister(request, env) : handleLogin(request, env);
  }
  if (pathname === "/api/auth/claim" && method === "POST") return handleClaim(request, env);

  if (pathname === "/api/auth/logout" && method === "POST") {
    const session = await getUserSession(request, env);
    if (session) {
      await env.DB.prepare("DELETE FROM user_sessions WHERE token_hash = ?1").bind(session.tokenHash).run();
      await removeOnlineUser(env, session.studentId);
    }
    return jsonResponse({ ok: true });
  }

  if (pathname === "/api/auth/me" && method === "GET") {
    const session = await getUserSession(request, env);
    if (!session) return fail(401, "Authentication required.", "AUTH_REQUIRED");
    const now = Date.now();
    // Sliding renewal: active sessions refresh automatically when < 15 days remain so active guests are not locked out.
    if (session.expiresAt > now && (session.expiresAt - now) < Math.floor(USER_SESSION_TTL_MS / 2)) {
      const renewed = now + USER_SESSION_TTL_MS;
      await env.DB.prepare("UPDATE user_sessions SET expires_at = ?1 WHERE token_hash = ?2").bind(renewed, session.tokenHash).run();
    }
    await touchOnlineUser(env, { studentId: session.studentId, username: session.username, displayName: session.displayName, isGuest: session.guest, isAdmin: session.isAdmin }, now, "");
    const stats = await getUserStudyStats(env, session.studentId);
    let progress = {};
    try {
      const snap = await readUserProgressSnapshot(env, session.studentId);
      progress = snap ? snap.progress : {};
    } catch (_e) { /* ignore missing or malformed progress */ }
    const qClientId = url.searchParams.get("syncClientId");
    const qTabTag = url.searchParams.get("syncTabTag");
    const qClientGen = url.searchParams.get("syncClientGen");
    const clientRegistration = qClientId ? describeClientRegistration(progress, qClientId, qClientGen, qTabTag, now) : null;
    const sanitized = publicProgressForClient(sanitizeStoredProgressOnRead(progress, now));
    const epoch = Number(sanitized && sanitized.syncMeta && sanitized.syncMeta.epoch) || 0;
    const out = {
      ok: true,
      serverTime: now,
      syncEpoch: epoch,
      protocolVersion: MAX_SYNC_PROTOCOL_VERSION,
      minSupportedVersion: MAX_SYNC_PROTOCOL_VERSION,
      profile: { studentId: session.studentId, username: session.username, isAdmin: session.isAdmin, guest: session.guest, stats: stats, progress: sanitized },
    };
    if (clientRegistration) out.clientRegistration = clientRegistration;
    return jsonResponse(out);
  }

  if (pathname === "/api/auth/sync-progress" && method === "POST") {
    const session = await getUserSession(request, env);
    if (!session) return fail(401, "Authentication required.", "AUTH_REQUIRED");
    const frozenRes = await requireProgressWriteFenceClear(env);
    if (frozenRes) return frozenRes;
    const parsed = await readJson(request);
    if (parsed.tooLarge) return fail(413, "Request too large.", "TOO_LARGE");
    if (parsed.invalid) return fail(400, "Invalid JSON payload.", "BAD_REQUEST");
    const body = parsed.body && typeof parsed.body === "object" ? parsed.body : {};
    const action = typeof body.action === "string" ? body.action.trim() : "";
    const casOpts = { sessionTokenHash: session.tokenHash };

    if (action === "reconcile_init") {
      const casRes = await runProgressCasUpdate(env, session.studentId, function (snap) {
        return applySyncReconcileInit(snap.progress, body.syncClientId, body.syncTabTag, Date.now(), session.studentId);
      }, casOpts);
      if (!casRes.ok) {
        return fail(casRes.status || 409, casRes.error || "Failed to initialize reconciliation.", casRes.code || "SYNC_CONFLICT", casRes.extra || {});
      }
      return jsonResponse({
        ok: true,
        action: "reconcile_init",
        serverTime: casRes.serverTime,
        syncEpoch: casRes.syncEpoch,
        registration: casRes.registration,
        progress: publicProgressForClient(sanitizeStoredProgressOnRead(casRes.progress, casRes.serverTime)),
      });
    }

    if (action === "reconcile_ack") {
      const ackBodyMeta = body.progress && typeof body.progress === "object" && body.progress.syncMeta && typeof body.progress.syncMeta === "object"
        ? body.progress.syncMeta
        : null;
      if (ackBodyMeta && (
        (ackBodyMeta.tabTag && String(ackBodyMeta.tabTag) !== String(body.syncTabTag || "")) ||
        (ackBodyMeta.clientId && String(ackBodyMeta.clientId) !== String(body.syncClientId || ""))
      )) {
        return fail(409, "Reconciliation acknowledgment payload identity mismatch.", "SYNC_RESYNC_REQUIRED", {
          reason: "RECONCILE_CHALLENGE_MISMATCH",
        });
      }
      const casRes = await runProgressCasUpdate(env, session.studentId, function (snap) {
        return applySyncReconcileAck(snap.progress, body.syncClientId, body.syncTabTag, body.syncClientGen, body.challenge, body.baselineEpoch, Date.now(), session.studentId);
      }, casOpts);
      if (!casRes.ok) {
        if (casRes.status === 409 && casRes.extra && casRes.extra.cloudProgress) {
          const ex = casRes.extra;
          return jsonResponse({
            ok: false,
            code: ex.code,
            reason: ex.reason,
            actionRequired: ex.actionRequired,
            protocolVersion: ex.protocolVersion,
            minSupportedVersion: ex.minSupportedVersion,
            upgradeRecommended: ex.upgradeRecommended,
            error: ex.error,
            serverTime: ex.serverTime,
            syncEpoch: ex.syncEpoch,
            progress: publicProgressForClient(sanitizeStoredProgressOnRead(ex.cloudProgress, ex.serverTime)),
          }, 409);
        }
        return fail(casRes.status || 409, casRes.error || "Reconciliation acknowledgment failed.", casRes.code || "SYNC_CONFLICT");
      }
      return jsonResponse({
        ok: true,
        action: "reconcile_ack",
        serverTime: casRes.serverTime,
        syncEpoch: casRes.syncEpoch,
        registration: casRes.registration,
        progress: publicProgressForClient(sanitizeStoredProgressOnRead(casRes.progress, casRes.serverTime)),
      });
    }

    const valid = validateProgressInput(body.progress);
    if (!valid.ok) return fail(valid.status, valid.error, valid.code);

    const reqClientId = safeClientId(body.syncClientId);
    const reqTabTag = safeTabTag(body.syncTabTag);
    const reqClientGen = Number(body.syncClientGen);

    const casRes = await runProgressCasUpdate(env, session.studentId, function (snap) {
      const syncNowMs = Date.now();
      const mergeRes = mergeProgressWithStatus(valid.progress, snap.progress, syncNowMs, {
        authClientId: reqClientId,
        authTabTag: reqTabTag,
        authClientGen: reqClientGen,
      });
      if (!mergeRes.ok) {
        return {
          abort: true,
          status: 409,
          code: mergeRes.code,
          reason: mergeRes.reason,
          error: mergeRes.error,
          extra: mergeRes,
          syncNowMs: syncNowMs,
        };
      }
      return {
        abort: false,
        nextProgress: mergeRes.progress,
        meta: { serverTime: syncNowMs, syncEpoch: mergeRes.syncEpoch },
      };
    }, casOpts);

    if (!casRes.ok) {
      if (casRes.status === 409 && casRes.extra && casRes.extra.cloudProgress) {
        const ex = casRes.extra;
        return jsonResponse({
          ok: false,
          code: ex.code,
          reason: ex.reason,
          actionRequired: ex.actionRequired,
          protocolVersion: ex.protocolVersion,
          minSupportedVersion: ex.minSupportedVersion,
          upgradeRecommended: ex.upgradeRecommended,
          error: ex.error,
          serverTime: ex.serverTime,
          syncEpoch: ex.syncEpoch,
          progress: publicProgressForClient(sanitizeStoredProgressOnRead(ex.cloudProgress, ex.serverTime)),
        }, 409);
      }
      return fail(casRes.status || 409, casRes.error || "Progress sync failed.", casRes.code || "SYNC_CONFLICT");
    }

    return jsonResponse({
      ok: true,
      serverTime: casRes.serverTime,
      syncEpoch: casRes.syncEpoch,
      protocolVersion: MAX_SYNC_PROTOCOL_VERSION,
      minSupportedVersion: MAX_SYNC_PROTOCOL_VERSION,
      progress: publicProgressForClient(casRes.progress),
    });
  }

  // ---- Public site data ----------------------------------------------------
  if(pathname === "/api/subject-names" && method === "GET") {
    const row=await env.DB.prepare("SELECT config_json FROM admin_config WHERE config_key = 'subject_name_overrides'").first();
    let names={};try{names=JSON.parse(row?.config_json||"{}");}catch(_){}
    return jsonResponse({ok:true,names},200,{"Cache-Control":"no-store"});
  }
  if(pathname === "/api/admin/subjects/name" && method === "POST") {
    if(!(await requireAdmin(request,env)))return fail(401,"Admin authentication required.","AUTH_REQUIRED");
    const parsed=await readJson(request);if(parsed.tooLarge)return fail(413,"Request too large.","TOO_LARGE");
    const subjectId=safeId(parsed.body.subjectId,120),name=String(parsed.body.name||"").normalize("NFKC").trim();
    if(!subjectId||!name||name.length>120||/[<>\x00-\x1f]/.test(name))return fail(400,"Use a plain subject name of 1–120 characters.","BAD_NAME");
    await env.DB.prepare("INSERT INTO admin_config(config_key,config_json,updated_at) VALUES('subject_name_overrides',json_object(?1,?2),datetime('now')) ON CONFLICT(config_key) DO UPDATE SET config_json=json_set(admin_config.config_json,?3,?2),updated_at=datetime('now')").bind(subjectId,name,"$."+JSON.stringify(subjectId)).run();
    return jsonResponse({ok:true,subjectId,name});
  }
  if(pathname === "/api/quiz-names" && method === "GET") {
    const row=await env.DB.prepare("SELECT config_json FROM admin_config WHERE config_key = 'quiz_name_overrides'").first();
    let names={};try{names=JSON.parse(row?.config_json||"{}");}catch(_){}
    return jsonResponse({ok:true,names},200,{"Cache-Control":"no-store"});
  }
  if(pathname === "/api/admin/quizzes/name" && method === "POST") {
    if(!(await requireAdmin(request,env)))return fail(401,"Admin authentication required.","AUTH_REQUIRED");
    const parsed=await readJson(request);if(parsed.tooLarge)return fail(413,"Request too large.","TOO_LARGE");
    const subjectId=safeId(parsed.body.subjectId,120),quizId=safeId(parsed.body.quizId,120),name=String(parsed.body.name||"").normalize("NFKC").trim();
    if(!subjectId||!quizId||!name||name.length>160||/[<>\x00-\x1f]/.test(name))return fail(400,"Use a plain quiz name of 1–160 characters.","BAD_NAME");
    const key=subjectId+"::"+quizId;
    await env.DB.prepare("INSERT INTO admin_config(config_key,config_json,updated_at) VALUES('quiz_name_overrides',json_object(?1,?2),datetime('now')) ON CONFLICT(config_key) DO UPDATE SET config_json=json_set(admin_config.config_json,?3,?2),updated_at=datetime('now')").bind(key,name,"$."+JSON.stringify(key)).run();
    return jsonResponse({ok:true,key,subjectId,quizId,name});
  }

  if (pathname === "/api/site-settings" && method === "GET") {
    const cfg = await env.DB.prepare("SELECT config_json, updated_at FROM admin_config WHERE config_key = 'site_global_settings'").first();
    let settings = null;
    if (cfg && cfg.config_json) { try { settings = JSON.parse(cfg.config_json); } catch (_e) { /* ignore */ } }
    return jsonResponse({ ok: true, settings: settings, updatedAt: cfg ? cfg.updated_at : null }, 200, { "Cache-Control": "public, max-age=60, s-maxage=300" });
  }

  if (pathname === "/api/content/overrides" && method === "GET") {
    const cfg = await env.DB.prepare("SELECT config_json, updated_at FROM admin_config WHERE config_key = 'content_library_overrides'").first();
    let overrides = null;
    if (cfg && cfg.config_json) { try { overrides = JSON.parse(cfg.config_json); } catch (_e) { /* ignore */ } }
    return jsonResponse({ ok: true, overrides: overrides, updatedAt: cfg ? cfg.updated_at : null }, 200, { "Cache-Control": "no-cache" });
  }

  if (pathname === "/api/catalog/dynamic" && method === "GET") {
    return handleDynamicCatalogGet(request, env, url);
  }

  // ---- Own profile ---------------------------------------------------------
  if (pathname === "/api/user/profile") {
    const session = await getUserSession(request, env);
    if (!session) return fail(401, "Authentication required.", "AUTH_REQUIRED");
    if (method === "GET") return handleProfileGet(request, env, session, url);
    if (method === "POST") return handleProfileRename(request, env, session);
    if (method === "DELETE") return handleProfileDelete(request, env, session);
    return fail(405, "Method not allowed.", "METHOD");
  }

  // ---- Quiz ----------------------------------------------------------------
  if (pathname === "/api/quiz/feedback" && method === "POST") return handleQuizFeedback(request, env);
  if (pathname === "/api/quiz/submit" && method === "POST") return handleQuizSubmit(request, env);

  // ---- Leaderboard ---------------------------------------------------------
  if (pathname === "/api/leaderboard" && method === "GET") return handleLeaderboard(request, env, url);

  // ---- Admin ---------------------------------------------------------------
  if (pathname === "/api/admin/login" && method === "POST") return handleAdminLogin(request, env);

  if (pathname === "/api/admin/logout" && method === "POST") {
    const master = await getMasterSession(request, env);
    if (master) await env.DB.prepare("DELETE FROM admin_sessions WHERE token_hash = ?1").bind(master.token_hash).run();
    return jsonResponse({ ok: true }, 200, { "Set-Cookie": "mcq_admin_session=; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=0" });
  }

  if (pathname === "/api/admin/session" && method === "GET") {
    const admin = await requireAdmin(request, env);
    if (!admin) return fail(401, "Not authenticated.", "AUTH_REQUIRED", { authenticated: false });
    return jsonResponse({ ok: true, authenticated: true, role: admin.kind, expiresAt: admin.expiresAt || null });
  }

  if (pathname === "/api/admin/online-users" && method === "GET") {
    const admin = await requireAdmin(request, env);
    if (!admin) return fail(401, "Admin authentication required.", "AUTH_REQUIRED");
    const stats = await listOnlineUsers(env, Date.now(), { includeStudentIds: admin.kind === "master" });
    return jsonResponse(Object.assign({ ok: true, generatedAt: new Date().toISOString() }, stats));
  }

  if (pathname === "/api/admin/users" && method === "GET") {
    const admin = await requireAdmin(request, env);
    if (!admin) return fail(401, "Admin authentication required.", "AUTH_REQUIRED");
    const showAll = url.searchParams.get("all") === "1";
    const query = String(url.searchParams.get("q") || "").normalize("NFKC").trim();
    const includeIds = admin.kind === "master";
    const sanitizeUserRow = function (u) {
      const out = {
        username: u.username,
        displayName: u.displayName,
        isAdmin: u.isAdmin,
        hasPassword: u.hasPassword,
        createdAt: u.createdAt,
        updatedAt: u.updatedAt,
      };
      if (includeIds) out.studentId = u.studentId;
      return out;
    };
    if (showAll && !query) {
      const result = await env.DB.prepare(
        "SELECT student_id AS studentId, username, display_name AS displayName, is_admin AS isAdmin, (CASE WHEN password_hash IS NOT NULL AND password_hash != '' THEN 1 ELSE 0 END) AS hasPassword, created_at AS createdAt, updated_at AS updatedAt FROM users ORDER BY username COLLATE NOCASE ASC LIMIT 201"
      ).all();
      const rows = ((result && result.results) || []).slice(0, 200).map(sanitizeUserRow);
      return jsonResponse({ ok: true, users: rows, hasMore: ((result && result.results) || []).length > 200 });
    }
    if (query.length < 2) return jsonResponse({ ok: true, users: [], hasMore: false });
    if (query.length > 24) return fail(400, "Search must be 2–24 characters.", "BAD_SEARCH");
    const pattern = "%" + query.replace(/[\\%_]/g, "\\$&") + "%";
    const result = await env.DB.prepare(
      "SELECT student_id AS studentId, username, display_name AS displayName, is_admin AS isAdmin, (CASE WHEN password_hash IS NOT NULL AND password_hash != '' THEN 1 ELSE 0 END) AS hasPassword, created_at AS createdAt, updated_at AS updatedAt FROM users WHERE username LIKE ?1 ESCAPE '\\' COLLATE NOCASE ORDER BY username COLLATE NOCASE ASC LIMIT 21"
    ).bind(pattern).all();
    const rawRows = (result && result.results) || [];
    const rows = rawRows.slice(0, 20).map(sanitizeUserRow);
    return jsonResponse({ ok: true, users: rows, hasMore: rawRows.length > 20 });
  }

  if (pathname === "/api/admin/users/role" && method === "POST") {
    if (!(await requireMaster(request, env))) return fail(403, "Master admin session required.", "FORBIDDEN");
    const frozenRes = await requireProgressWriteFenceClear(env);
    if (frozenRes) return frozenRes;
    const parsed = await readJson(request);
    const target = await resolveTargetUser(env, parsed.body);
    if (!target) return fail(404, "User not found.", "NOT_FOUND");
    const nextAdmin = parsed.body.isAdmin === true || parsed.body.isAdmin === 1 ? 1 : 0;
    if (nextAdmin === 1 && !target.password_hash) {
      return fail(409, "This student must protect their account with a password before receiving admin access.", "NEEDS_PASSWORD");
    }
    const roleRes = await env.DB.prepare(
      "UPDATE users SET is_admin = ?1, updated_at = datetime('now') WHERE student_id = ?2 AND " + SQL_WRITE_FENCE_PREDICATE
    ).bind(nextAdmin, target.student_id).run();
    const roleChanges = Number(roleRes && roleRes.meta && roleRes.meta.changes) || 0;
    if (roleChanges === 0) {
      if (await isDbWriteFrozen(env)) {
        return (await requireProgressWriteFenceClear(env)) || fail(503, "Synchronization writes are temporarily paused for database maintenance.", "MAINTENANCE_WRITE_FREEZE");
      }
      return fail(404, "User not found.", "NOT_FOUND");
    }
    return jsonResponse({ ok: true, studentId: target.student_id, isAdmin: Boolean(nextAdmin) });
  }

  if (pathname === "/api/admin/users/delete" && method === "POST") {
    const gate = await requireMasterAdmin(request, env);
    if (!gate.ok) return gate.response;
    const frozenRes = await requireProgressWriteFenceClear(env);
    if (frozenRes) return frozenRes;
    const parsed = await readJson(request);
    const target = await resolveTargetUser(env, parsed.body);
    if (!target) return fail(404, "User not found.", "NOT_FOUND");
    const delRes = await deleteUserData(env, target.student_id);
    if (delRes && delRes.frozen) {
      return (await requireProgressWriteFenceClear(env)) || fail(503, "Synchronization writes are temporarily paused for database maintenance.", "MAINTENANCE_WRITE_FREEZE");
    }
    return jsonResponse({ ok: true, deleted: true });
  }

  if (pathname === "/api/admin/site-settings" && method === "POST") {
    if (!(await requireAdmin(request, env))) return fail(401, "Admin authentication required.", "AUTH_REQUIRED");
    const parsed = await readJson(request);
    if (parsed.tooLarge) return fail(413, "Request too large.", "TOO_LARGE");
    const rawSettings = parsed.body.settings && typeof parsed.body.settings === "object" ? parsed.body.settings : null;
    const sanitized = sanitizeSiteSettings(rawSettings);
    if (!sanitized.ok) return fail(400, sanitized.error, "BAD_REQUEST");
    const json = JSON.stringify(sanitized.settings);
    if (utf8ByteLength(json) > MAX_SITE_SETTINGS_BYTES) return fail(413, "Settings too large.", "TOO_LARGE");
    await env.DB.prepare(
      "INSERT INTO admin_config (config_key, config_json, updated_at) VALUES ('site_global_settings', ?1, datetime('now')) ON CONFLICT(config_key) DO UPDATE SET config_json = ?1, updated_at = datetime('now')"
    ).bind(json).run();
    return jsonResponse({ ok: true });
  }

  // ---- Question Reports ----------------------------------------------------
  if (pathname === "/api/questions/report" && method === "POST") return handleQuestionReport(request, env);
  if (pathname === "/api/admin/reports" && method === "GET") return handleAdminReports(request, env, url);
  if (pathname === "/api/admin/reports" && method === "DELETE") return handleAdminReportDelete(request, env, url);
  if (pathname === "/api/admin/reports/resolve" && method === "POST") return handleAdminReportResolve(request, env);

  if (pathname === "/api/admin/subjects" && method === "POST") return handleAdminSubjectSave(request, env);
  if (pathname === "/api/admin/subjects" && method === "DELETE") return handleAdminSubjectDelete(request, env, url);
  if (pathname === "/api/admin/quizzes" && method === "POST") return handleAdminQuizSave(request, env);
  if (pathname === "/api/admin/quizzes" && method === "DELETE") return handleAdminQuizDelete(request, env, url);
  if (pathname === "/api/admin/quizzes/delete-preview" && method === "GET") return handleAdminQuizDeletePreview(request, env, url);
  if (pathname === "/api/admin/quizzes/export" && method === "GET") return handleAdminQuizExport(request, env, url);
  if (pathname === "/api/admin/quizzes/permanent-delete" && method === "POST") return handleAdminQuizPermanentDelete(request, env);
  if (pathname === "/api/admin/quizzes/visibility" && method === "POST") return handleAdminQuizVisibility(request, env);
  if (pathname === "/api/admin/quizzes/images" && method === "POST") return handleAdminQuizImagesSave(request, env);

  if (pathname === "/api/admin/content" && method === "POST") return handleAdminContent(request, env);
  if (pathname === "/api/admin/r2/upload" && method === "POST") return handleAdminUpload(request, env, url);
  if (pathname === "/api/admin/r2/upload-image" && method === "POST") return handleAdminImageUpload(request, env, url);
  if (pathname === "/api/admin/r2/file" && method === "DELETE") return handleAdminFileDelete(request, env, url);
  if (pathname === "/api/admin/r2/image" && method === "DELETE") return handleAdminImageDelete(request, env, url);

  if (pathname === "/api/admin/diagnostics" && method === "GET") {
    if (!(await requireMaster(request, env))) return fail(403, "Master admin session required.", "FORBIDDEN");
    const cols = await env.DB.prepare("PRAGMA table_info(best_scores)").all();
    const names = ((cols && cols.results) || []).map(function (c) { return c.name; });
    const userCols = await env.DB.prepare("PRAGMA table_info(users)").all();
    const userNames = ((userCols && userCols.results) || []).map(function (c) { return c.name; });
    const envWriteFrozen = isEnvWriteFrozen(env);
    const dbWriteFrozen = await isDbWriteFrozen(env);
    const writeFrozen = envWriteFrozen || dbWriteFrozen;
    return jsonResponse({
      ok: true,
      d1Bound: true,
      r2Bound: Boolean(env.FILES),
      storageMode: env.STORAGE_MODE || "cloudflare-d1-r2",
      adminSecretConfigured: Boolean(env.ADMIN_PASSWORD || env.ADMIN_PASSWORD_HASH),
      writeFrozen: writeFrozen,
      envWriteFrozen: envWriteFrozen,
      dbWriteFrozen: dbWriteFrozen,
      requireProgressCas: isRequireProgressCas(env),
      schema: {
        bestScoresValidatedColumn: names.indexOf("validated_by_server") !== -1,
        usersProgressCasColumns: userNames.indexOf("progress_rev") !== -1 && userNames.indexOf("progress_write_id") !== -1,
      }
    });
  }

  // ---- Files ---------------------------------------------------------------
  if (pathname.startsWith("/api/r2/") && (method === "GET" || method === "HEAD")) return handleFileGet(request, env, pathname);

  return fail(404, "API route not found.", "NOT_FOUND");
}

// ---------------------------------------------------------------------------
// Handlers — accounts
// ---------------------------------------------------------------------------
const ONLINE_ACTIVE_WINDOW_MS = 90000;
const ALLOWED_PRESENCE_AREAS = ["hub", "player", "leaderboard", "saved", "mistakes", "settings", "lecture", "admin"];

function sanitizePresenceArea(raw) {
  const s = String(raw == null ? "" : raw).trim().toLowerCase();
  return ALLOWED_PRESENCE_AREAS.indexOf(s) !== -1 ? s : "";
}

async function touchOnlineUser(env, identity, now, area) {
  if (!env || !env.DB || !identity || !identity.studentId || !identity.username) return;
  const ts = Number(now) || Date.now();
  const cutoff = ts - ONLINE_ACTIVE_WINDOW_MS;
  const cleanArea = sanitizePresenceArea(area);
  const isGuest = identity.isGuest ? 1 : 0;
  const isAdmin = identity.isAdmin ? 1 : 0;
  const displayName = String(identity.displayName || identity.username).trim().slice(0, 40);
  try {
    await env.DB.prepare(
      "INSERT INTO online_users_presence (student_id, username, display_name, is_guest, is_admin, current_area, last_seen) " +
      "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) " +
      "ON CONFLICT(student_id) DO UPDATE SET username = excluded.username, display_name = excluded.display_name, " +
      "is_guest = excluded.is_guest, is_admin = excluded.is_admin, " +
      "current_area = CASE WHEN excluded.current_area != '' THEN excluded.current_area ELSE online_users_presence.current_area END, " +
      "last_seen = excluded.last_seen"
    ).bind(identity.studentId, identity.username, displayName, isGuest, isAdmin, cleanArea, ts).run();
    await env.DB.prepare("DELETE FROM online_users_presence WHERE last_seen <= ?1").bind(cutoff).run();
  } catch (_err) {
    // Graceful fallback if D1 migration 0006 has not been applied yet on a live instance.
    try {
      const map = await readConfigJson(env, "live_online_users", {});
      const next = {};
      const keys = Object.keys(map && typeof map === "object" ? map : {});
      for (let i = 0; i < keys.length; i += 1) {
        const entry = map[keys[i]];
        if (entry && Number(entry.lastSeen) > cutoff) next[keys[i]] = entry;
      }
      const prev = next[identity.studentId];
      next[identity.studentId] = {
        studentId: identity.studentId,
        username: identity.username,
        displayName: displayName,
        isGuest: Boolean(isGuest),
        isAdmin: Boolean(isAdmin),
        currentArea: cleanArea || (prev && prev.currentArea) || "",
        lastSeen: ts,
      };
      const entries = Object.values(next).sort(function (a, b) { return Number(b.lastSeen) - Number(a.lastSeen); }).slice(0, 200);
      const bounded = {};
      for (let i = 0; i < entries.length; i += 1) bounded[entries[i].studentId] = entries[i];
      await writeConfigJson(env, "live_online_users", bounded);
    } catch (_fallbackErr) { /* ignore non-critical presence fallback errors */ }
  }
}

async function removeOnlineUser(env, studentId) {
  if (!env || !env.DB || !studentId) return;
  try {
    await env.DB.prepare("DELETE FROM online_users_presence WHERE student_id = ?1").bind(studentId).run();
  } catch (_err) {
    try {
      const map = await readConfigJson(env, "live_online_users", {});
      if (map && typeof map === "object" && Object.prototype.hasOwnProperty.call(map, studentId)) {
        delete map[studentId];
        await writeConfigJson(env, "live_online_users", map);
      }
    } catch (_fallbackErr) { /* ignore */ }
  }
}

async function listOnlineUsers(env, now, opts) {
  const includeIds = Boolean(opts && opts.includeStudentIds);
  const ts = Number(now) || Date.now();
  const cutoff = ts - ONLINE_ACTIVE_WINDOW_MS;
  let totalBrowsers = 0;
  try {
    await env.DB.prepare("DELETE FROM site_presence WHERE last_seen <= ?1").bind(cutoff).run();
    const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM site_presence WHERE last_seen > ?1").bind(cutoff).first();
    totalBrowsers = Number(row && row.count) || 0;
  } catch (_err) {
    totalBrowsers = 0;
  }

  let rawUsers = [];
  try {
    await env.DB.prepare("DELETE FROM online_users_presence WHERE last_seen <= ?1").bind(cutoff).run();
    const res = await env.DB.prepare(
      "SELECT student_id AS studentId, username, display_name AS displayName, is_guest AS isGuest, is_admin AS isAdmin, " +
      "current_area AS currentArea, last_seen AS lastSeen FROM online_users_presence WHERE last_seen > ?1 " +
      "ORDER BY last_seen DESC, username COLLATE NOCASE ASC LIMIT 200"
    ).bind(cutoff).all();
    rawUsers = (res && res.results) || [];
  } catch (_err) {
    try {
      const map = await readConfigJson(env, "live_online_users", {});
      rawUsers = Object.values(map && typeof map === "object" ? map : {})
        .filter(function (entry) { return entry && Number(entry.lastSeen) > cutoff; })
        .sort(function (a, b) { return Number(b.lastSeen) - Number(a.lastSeen); })
        .slice(0, 200);
    } catch (_fallbackErr) {
      rawUsers = [];
    }
  }

  const users = rawUsers.map(function (u) {
    const seen = Number(u.lastSeen) || ts;
    const item = {
      username: String(u.username || ""),
      displayName: String(u.displayName || u.username || ""),
      isGuest: Boolean(Number(u.isGuest)),
      isAdmin: Boolean(Number(u.isAdmin)),
      currentArea: sanitizePresenceArea(u.currentArea),
      lastSeen: seen,
      idleSeconds: Math.max(0, Math.round((ts - seen) / 1000)),
    };
    if (includeIds) item.studentId = String(u.studentId || "");
    return item;
  }).filter(function (u) { return Boolean(u.username); });

  const totalOnline = Math.max(totalBrowsers, users.length);
  return {
    activeWindowSeconds: Math.round(ONLINE_ACTIVE_WINDOW_MS / 1000),
    totalOnline: totalOnline,
    identifiedCount: users.length,
    anonymousCount: Math.max(0, totalOnline - users.length),
    users: users,
  };
}

async function handlePresence(request, env) {
  if (request.headers.get("Sec-Fetch-Site") === "cross-site") {
    return fail(403, "Cross-origin request blocked.", "CROSS_ORIGIN");
  }
  const cookie = (request.headers.get("Cookie") || "").match(/(?:^|;\s*)elgo_presence=([a-f0-9]{32})(?:;|$)/);
  const visitorId = cookie ? cookie[1] : crypto.randomUUID().replace(/-/g, "");
  const now = Date.now();
  try {
    // Throttle writes per browser, including multiple tabs. Count only recent visible visits.
    await env.DB.prepare(
      "INSERT INTO site_presence(visitor_id, last_seen) VALUES (?1, ?2) " +
      "ON CONFLICT(visitor_id) DO UPDATE SET last_seen = excluded.last_seen " +
      "WHERE site_presence.last_seen < ?3"
    ).bind(visitorId, now, now - 15000).run();
    await env.DB.prepare("DELETE FROM site_presence WHERE last_seen <= ?1").bind(now - ONLINE_ACTIVE_WINDOW_MS).run();
    const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM site_presence WHERE last_seen > ?1").bind(now - ONLINE_ACTIVE_WINDOW_MS).first();

    if (bearerToken(request)) {
      try {
        const userSess = await getUserSession(request, env);
        if (userSess) {
          let area = "";
          const ctype = (request.headers.get("Content-Type") || "").toLowerCase();
          if (ctype.indexOf("application/json") !== -1) {
            const parsed = await readJson(request);
            if (!parsed.tooLarge && parsed.body && typeof parsed.body.area === "string") {
              area = sanitizePresenceArea(parsed.body.area);
            }
          }
          await touchOnlineUser(env, {
            studentId: userSess.studentId,
            username: userSess.username,
            displayName: userSess.displayName,
            isGuest: userSess.guest,
            isAdmin: userSess.isAdmin,
          }, now, area);
        }
      } catch (_ignoreUserPresence) { /* never fail public presence count */ }
    }

    const headers = cookie ? {} : {
      "Set-Cookie": "elgo_presence=" + visitorId + "; Path=/api/presence; HttpOnly; Secure; SameSite=Lax; Max-Age=86400"
    };
    return jsonResponse({ ok: true, online: Number(row.count), activeWindowSeconds: 90 }, 200, headers);
  } catch (_err) {
    // An unapplied migration or a temporary DB failure must never produce a fabricated zero.
    return fail(503, "Live count is temporarily unavailable.", "PRESENCE_UNAVAILABLE");
  }
}

async function resolveTargetUser(env, body) {
  const studentId = safeId(body && body.studentId, 120);
  const username = String((body && body.username) || "").trim();
  if (studentId) return env.DB.prepare("SELECT student_id, username, is_admin, password_hash FROM users WHERE student_id = ?1").bind(studentId).first();
  if (username) return env.DB.prepare("SELECT student_id, username, is_admin, password_hash FROM users WHERE username = ?1").bind(username).first();
  return null;
}

function profileResponse(user, token, progress, serverTime, extra) {
  const out = {
    ok: true,
    token: token.token,
    expiresAt: token.expiresAt,
    serverTime: Number(serverTime) || Date.now(),
    protocolVersion: MAX_SYNC_PROTOCOL_VERSION,
    minSupportedVersion: MAX_SYNC_PROTOCOL_VERSION,
    profile: {
      studentId: user.student_id,
      username: user.username,
      displayName: user.display_name || user.username,
      isAdmin: Number(user.is_admin) === 1,
      guest: String(user.student_id).startsWith("gst_") && !user.password_hash,
      progress: publicProgressForClient(progress)
    }
  };
  if (extra && extra.syncRegistration) out.syncRegistration = extra.syncRegistration;
  if (extra && extra.syncEpoch !== undefined) out.syncEpoch = extra.syncEpoch;
  if (extra && extra.syncResyncRequired) {
    out.syncResyncRequired = true;
    if (extra.syncResyncReason) out.syncResyncReason = extra.syncResyncReason;
    if (extra.syncResyncActionRequired) out.syncResyncActionRequired = extra.syncResyncActionRequired;
  }
  return out;
}

async function authThrottle(env, request, usernameKey) {
  const now = Date.now();
  const ipRetry = await rateLocked(env, "auth:ip:" + getClientIp(request, env), now);
  const userRetry = usernameKey ? await rateLocked(env, "auth:user:" + usernameKey, now) : 0;
  const retry = Math.max(ipRetry, userRetry);
  return retry ? fail(429, "Too many attempts. Try again in " + retry + "s.", "RATE_LIMITED", { retryAfterSeconds: retry }) : null;
}

async function authFailure(env, request, usernameKey) {
  const now = Date.now();
  await rateRecordFailure(env, "auth:ip:" + getClientIp(request, env), now, AUTH_IP_LIMIT.max, AUTH_IP_LIMIT.windowMs, AUTH_IP_LIMIT.lockMs);
  if (usernameKey) await rateRecordFailure(env, "auth:user:" + usernameKey, now, AUTH_USER_LIMIT.max, AUTH_USER_LIMIT.windowMs, AUTH_USER_LIMIT.lockMs);
}

async function handleGuest(request, env) {
  const frozenRes = await requireProgressWriteFenceClear(env);
  if (frozenRes) return frozenRes;
  const parsed = await readJson(request);
  if (parsed.tooLarge) return fail(413, "Request too large.", "TOO_LARGE");
  if (parsed.invalid) return fail(400, "Invalid JSON payload.", "BAD_REQUEST");
  const valid = validateProgressInput(parsed.body.progress);
  if (!valid.ok) return fail(valid.status, valid.error, valid.code);
  const now = Date.now();
  const guestIpKey = "guest:ip:" + getClientIp(request, env);
  const locked = await rateLocked(env, guestIpKey, now);
  if (locked) return fail(429, "Too many guest accounts created. Try again in " + locked + "s.", "RATE_LIMITED", { retryAfterSeconds: locked });
  const check = validateUsernameServer(parsed.body.username);
  if (!check.ok) return fail(400, check.error, "BAD_USERNAME");
  const taken = await env.DB.prepare("SELECT student_id FROM users WHERE username = ?1").bind(check.username).first();
  if (taken) return fail(409, "That username is already taken. Sign in or choose another name.", "USERNAME_TAKEN");
  // Record guest creation against its own dedicated bucket (never triggers auth lockout).
  await rateRecordFailure(env, guestIpKey, now, GUEST_CREATE_LIMIT.max, GUEST_CREATE_LIMIT.windowMs, GUEST_CREATE_LIMIT.lockMs);
  const studentId = "gst_" + randomHex(16);
  const mergeAt = Date.now();
  const authClientId = safeClientId(parsed.body.syncClientId);
  const authTabTag = safeTabTag(parsed.body.syncTabTag);
  const authClientGen = Number(parsed.body.syncClientGen);
  let mergeRes = mergeProgressWithStatus(valid.progress, {}, mergeAt, {
    authClientId: authClientId,
    authTabTag: authTabTag,
    authClientGen: authClientGen,
    registerClientMode: "initial",
  });
  let syncResyncRequired = false;
  let syncResyncReason = "";
  let syncResyncActionRequired = "";
  if (!mergeRes.ok) {
    syncResyncRequired = true;
    syncResyncReason = mergeRes.reason || "";
    syncResyncActionRequired = mergeRes.actionRequired || "";
    mergeRes = mergeProgressWithStatus({}, {}, mergeAt, {
      authClientId: authClientId,
      authTabTag: authTabTag,
      registerClientMode: "initial",
    });
  }
  const progress = mergeRes.ok ? mergeRes.progress : {};
  const ins = await insertUserWithProgress(env, { studentId, username: check.username, displayName: check.username, passwordHash: "" }, progress);
  if (!ins.ok) {
    if (ins.frozen) return await requireProgressWriteFenceClear(env) || fail(503, "Maintenance in progress.", "MAINTENANCE_WRITE_FREEZE");
    if (ins.require0008) return fail(503, "Database migration 0008 is required before progress writes can proceed.", "MIGRATION_0008_REQUIRED");
    if (ins.tooLarge) return fail(413, "Progress data too large.", "TOO_LARGE");
    return fail(409, "That username is already taken.", "USERNAME_TAKEN");
  }
  const token = await createUserSession(env, studentId);
  await touchOnlineUser(env, { studentId, username: check.username, displayName: check.username, isGuest: true, isAdmin: false }, now, "");
  return jsonResponse(profileResponse({ student_id: studentId, username: check.username, is_admin: 0 }, token, progress, mergeAt, {
    syncRegistration: mergeRes.syncRegistration,
    syncEpoch: mergeRes.syncEpoch,
    syncResyncRequired: syncResyncRequired,
    syncResyncReason: syncResyncReason,
    syncResyncActionRequired: syncResyncActionRequired,
  }));
}

async function handleGuestUpgrade(request, env) {
  const session = await getUserSession(request, env);
  if (!session) return fail(401, "Authentication required.", "AUTH_REQUIRED");
  const frozenRes = await requireProgressWriteFenceClear(env);
  if (frozenRes) return frozenRes;
  const parsed = await readJson(request);
  if (parsed.tooLarge) return fail(413, "Request too large.", "TOO_LARGE");
  if (parsed.invalid) return fail(400, "Invalid JSON payload.", "BAD_REQUEST");
  const valid = validateProgressInput(parsed.body.progress);
  if (!valid.ok) return fail(valid.status, valid.error, valid.code);
  const password = typeof parsed.body.password === "string" ? parsed.body.password : "";
  if (password.length < MIN_PASSWORD_LENGTH_NEW || password.length > 200) return fail(400, "Choose a password with at least " + MIN_PASSWORD_LENGTH_NEW + " characters.", "BAD_PASSWORD");
  const user = await env.DB.prepare("SELECT student_id, username, display_name, password_hash, is_admin, progress_json FROM users WHERE student_id = ?1").bind(session.studentId).first();
  if (!user || !String(user.student_id).startsWith("gst_") || user.password_hash) return fail(409, "This account already has a password.", "ALREADY_SECURED");
  const throttled = await authThrottle(env, request, ""); if (throttled) return throttled;
  const hash = await hashUserPassword(password);
  const authClientId = safeClientId(parsed.body.syncClientId);
  const authTabTag = safeTabTag(parsed.body.syncTabTag);
  const authClientGen = Number(parsed.body.syncClientGen);
  // Commit password_hash and merged progress atomically inside one CAS batch so a CAS failure,
  // 413 payload overflow, or concurrent upgrade never leaves a partial password-protected state.
  const casRes = await runProgressCasUpdate(env, session.studentId, function (snap) {
    if (!snap.user || !String(snap.user.student_id).startsWith("gst_") || snap.user.password_hash) {
      return { abort: true, status: 409, code: "ALREADY_SECURED", error: "This account already has a password." };
    }
    const mergeAt = Date.now();
    let mergeRes = mergeProgressWithStatus(valid.progress, snap.progress, mergeAt, {
      authClientId: authClientId,
      authTabTag: authTabTag,
      authClientGen: authClientGen,
      registerClientMode: "auth",
    });
    let resyncRequired = false;
    let resyncReason = "";
    let resyncActionRequired = "";
    if (!mergeRes.ok) {
      resyncRequired = true;
      resyncReason = mergeRes.reason || "";
      resyncActionRequired = mergeRes.actionRequired || "";
      mergeRes = mergeProgressWithStatus({}, snap.progress, mergeAt, {
        authClientId: authClientId,
        authTabTag: authTabTag,
        registerClientMode: "auth",
      });
    }
    if (!mergeRes.ok) {
      return {
        abort: true,
        status: 409,
        code: mergeRes.code || "SYNC_CONFLICT",
        error: mergeRes.error || "Failed to merge guest progress.",
      };
    }
    return {
      abort: false,
      nextProgress: mergeRes.progress,
      meta: {
        mergeAt: mergeAt,
        syncEpoch: mergeRes.syncEpoch,
        syncRegistration: mergeRes.syncRegistration,
        syncResyncRequired: resyncRequired,
        syncResyncReason: resyncReason,
        syncResyncActionRequired: resyncActionRequired,
      },
    };
  }, { upgradePasswordHash: hash, sessionTokenHash: session.tokenHash });
  if (!casRes.ok) {
    return fail(casRes.status || 409, casRes.error || "Failed to persist upgraded guest progress.", casRes.code || "SYNC_CONFLICT");
  }
  user.password_hash = hash;
  await touchOnlineUser(env, { studentId: session.studentId, username: user.username, displayName: user.display_name || user.username, isGuest: false, isAdmin: Number(user.is_admin) === 1 }, Date.now(), "");
  return jsonResponse(profileResponse(user, await createUserSession(env, session.studentId), casRes.progress, casRes.mergeAt, {
    syncRegistration: casRes.syncRegistration,
    syncEpoch: casRes.syncEpoch,
    syncResyncRequired: casRes.syncResyncRequired,
    syncResyncReason: casRes.syncResyncReason,
    syncResyncActionRequired: casRes.syncResyncActionRequired,
  }));
}

async function handleRegister(request, env) {
  const frozenRes = await requireProgressWriteFenceClear(env);
  if (frozenRes) return frozenRes;
  const parsed = await readJson(request);
  if (parsed.tooLarge) return fail(413, "Request too large.", "TOO_LARGE");
  if (parsed.invalid) return fail(400, "Invalid JSON payload.", "BAD_REQUEST");
  const body = parsed.body;
  const valid = validateProgressInput(body.progress);
  if (!valid.ok) return fail(valid.status, valid.error, valid.code);
  const check = validateUsernameServer(body.username);
  if (!check.ok) return fail(400, check.error, "BAD_USERNAME");
  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < MIN_PASSWORD_LENGTH_NEW || password.length > 200) {
    return fail(400, "Password must be " + MIN_PASSWORD_LENGTH_NEW + "–200 characters.", "BAD_PASSWORD");
  }
  const throttled = await authThrottle(env, request, "");
  if (throttled) return throttled;

  const taken = await env.DB.prepare("SELECT student_id FROM users WHERE username = ?1").bind(check.username).first();
  if (taken) return fail(409, "That username is already taken.", "USERNAME_TAKEN");

  const studentId = "stu_" + randomHex(10); // always generated by the server
  const mergeAt = Date.now();
  const authClientId = safeClientId(body.syncClientId);
  const authTabTag = safeTabTag(body.syncTabTag);
  const authClientGen = Number(body.syncClientGen);
  let mergeRes = mergeProgressWithStatus(valid.progress, {}, mergeAt, {
    authClientId: authClientId,
    authTabTag: authTabTag,
    authClientGen: authClientGen,
    registerClientMode: "initial",
  });
  let syncResyncRequired = false;
  let syncResyncReason = "";
  let syncResyncActionRequired = "";
  if (!mergeRes.ok) {
    syncResyncRequired = true;
    syncResyncReason = mergeRes.reason || "";
    syncResyncActionRequired = mergeRes.actionRequired || "";
    mergeRes = mergeProgressWithStatus({}, {}, mergeAt, {
      authClientId: authClientId,
      authTabTag: authTabTag,
      registerClientMode: "initial",
    });
  }
  const progress = mergeRes.ok ? mergeRes.progress : {};
  const hash = await hashUserPassword(password);
  const ins = await insertUserWithProgress(env, { studentId, username: check.username, displayName: check.username, passwordHash: hash }, progress);
  if (!ins.ok) {
    if (ins.frozen) return await requireProgressWriteFenceClear(env) || fail(503, "Maintenance in progress.", "MAINTENANCE_WRITE_FREEZE");
    if (ins.require0008) return fail(503, "Database migration 0008 is required before progress writes can proceed.", "MIGRATION_0008_REQUIRED");
    if (ins.tooLarge) return fail(413, "Progress data too large.", "TOO_LARGE");
    return fail(409, "That username is already taken.", "USERNAME_TAKEN");
  }
  const token = await createUserSession(env, studentId);
  await touchOnlineUser(env, { studentId, username: check.username, displayName: check.username, isGuest: false, isAdmin: false }, Date.now(), "");
  return jsonResponse(profileResponse({ student_id: studentId, username: check.username, display_name: check.username, is_admin: 0 }, token, progress, mergeAt, {
    syncRegistration: mergeRes.syncRegistration,
    syncEpoch: mergeRes.syncEpoch,
    syncResyncRequired: syncResyncRequired,
    syncResyncReason: syncResyncReason,
    syncResyncActionRequired: syncResyncActionRequired,
  }));
}

async function handleLogin(request, env) {
  const frozenRes = await requireProgressWriteFenceClear(env);
  if (frozenRes) return frozenRes;
  const parsed = await readJson(request);
  if (parsed.tooLarge) return fail(413, "Request too large.", "TOO_LARGE");
  const body = parsed.body || {};
  const check = validateUsernameServer(body.username);
  const password = typeof body.password === "string" ? body.password : "";
  if (!check.ok || !password || password.length > 200) return fail(401, "Incorrect username or password.", "BAD_CREDENTIALS");
  const key = check.username.toLowerCase();
  const throttled = await authThrottle(env, request, key);
  if (throttled) return throttled;

  const user = await env.DB.prepare(
    "SELECT student_id, username, display_name, password_hash, is_admin, progress_json FROM users WHERE username = ?1"
  ).bind(check.username).first();

  if (!user) {
    await verifyUserPassword(password, "pbkdf2$" + PBKDF2_ITERATIONS + "$" + "00".repeat(16) + "$" + "00".repeat(32)); // equalise timing
    await authFailure(env, request, key);
    return fail(401, "Incorrect username or password.", "BAD_CREDENTIALS");
  }
  if (!user.password_hash) {
    if (String(user.student_id || "").startsWith("gst_")) {
      return fail(409, "This name was created without a password on another browser. Open Elgo Lab on that browser and choose 'Protect account' to use it here.", "GUEST_ACCOUNT");
    }
    // A password is NEVER created by whoever logs in first, and insecure self-claim is disabled.
    return fail(409, "This legacy account has no password yet. Self-service claiming is disabled for security; contact the site administrator for assistance.", "ACCOUNT_NEEDS_CLAIM");
  }
  const verified = await verifyUserPassword(password, user.password_hash);
  if (!verified.ok) {
    await authFailure(env, request, key);
    return fail(401, "Incorrect username or password.", "BAD_CREDENTIALS");
  }
  const valid = validateProgressInput(body.progress);
  if (!valid.ok) return fail(valid.status, valid.error, valid.code);

  await rateClear(env, "auth:user:" + key);
  const upgradedPasswordHash = verified.needsRehash ? await hashUserPassword(password) : "";
  const authClientId = safeClientId(body.syncClientId);
  const authTabTag = safeTabTag(body.syncTabTag);
  const authClientGen = Number(body.syncClientGen);
  const casRes = await runProgressCasUpdate(env, user.student_id, function (snap) {
    const mergeAt = Date.now();
    let mergeRes = mergeProgressWithStatus(valid.progress, snap.progress, mergeAt, {
      authClientId: authClientId,
      authTabTag: authTabTag,
      authClientGen: authClientGen,
      registerClientMode: "auth",
    });
    let resyncRequired = false;
    let resyncReason = "";
    let resyncActionRequired = "";
    if (!mergeRes.ok) {
      resyncRequired = true;
      resyncReason = mergeRes.reason || "";
      resyncActionRequired = mergeRes.actionRequired || "";
      mergeRes = mergeProgressWithStatus({}, snap.progress, mergeAt, {
        authClientId: authClientId,
        authTabTag: authTabTag,
        registerClientMode: "auth",
      });
    }
    return {
      abort: false,
      nextProgress: mergeRes.progress,
      meta: {
        mergeAt: mergeAt,
        syncEpoch: mergeRes.syncEpoch,
        syncRegistration: mergeRes.syncRegistration,
        syncResyncRequired: resyncRequired,
        syncResyncReason: resyncReason,
        syncResyncActionRequired: resyncActionRequired,
      },
    };
  }, upgradedPasswordHash ? { rehashPasswordHash: upgradedPasswordHash } : undefined);
  if (!casRes.ok) {
    return fail(casRes.status || 409, casRes.error || "Failed to synchronize login progress.", casRes.code || "SYNC_CONFLICT");
  }
  const token = await createUserSession(env, user.student_id);
  await touchOnlineUser(env, { studentId: user.student_id, username: user.username, displayName: user.display_name || user.username, isGuest: false, isAdmin: Number(user.is_admin) === 1 }, Date.now(), "");
  return jsonResponse(profileResponse(user, token, casRes.progress, casRes.mergeAt, {
    syncRegistration: casRes.syncRegistration,
    syncEpoch: casRes.syncEpoch,
    syncResyncRequired: casRes.syncResyncRequired,
    syncResyncReason: casRes.syncResyncReason,
    syncResyncActionRequired: casRes.syncResyncActionRequired,
  }));
}

/** Legacy self-service claim route kept for backward compatibility; disabled because studentId is not a verifiable secret. */
async function handleClaim(request, _env) {
  await readJson(request);
  return fail(403, "Self-service account claiming is disabled for security. Contact the site administrator for assistance.", "CLAIM_DISABLED");
}

async function handleProfileGet(request, env, session, url) {
  const requested = (url.searchParams.get("studentId") || "").trim();
  if (requested && requested !== session.studentId) return fail(403, "You can only read your own profile.", "FORBIDDEN");
  const row = await env.DB.prepare(
    "SELECT student_id AS studentId, username, display_name AS displayName, username_change_count AS changeCount, created_at AS createdAt, updated_at AS updatedAt FROM users WHERE student_id = ?1"
  ).bind(session.studentId).first();
  return jsonResponse({ ok: true, profile: row || null });
}

async function handleProfileRename(request, env, session) {
  const frozenRes = await requireProgressWriteFenceClear(env);
  if (frozenRes) return frozenRes;
  const parsed = await readJson(request);
  const body = parsed.body;
  // A body studentId, if sent, must match the session; it is never used to pick the target.
  if (body.studentId && String(body.studentId) !== session.studentId) return fail(403, "You can only edit your own profile.", "FORBIDDEN");
  const check = validateUsernameServer(body.username);
  if (!check.ok) return fail(400, check.error, "BAD_USERNAME");
  const current = await env.DB.prepare("SELECT username, username_change_count FROM users WHERE student_id = ?1").bind(session.studentId).first();
  if (!current) return fail(404, "Account not found.", "NOT_FOUND");
  const same = current.username.toLowerCase() === check.username.toLowerCase();
  const nextCount = Number(current.username_change_count || 0) + (same ? 0 : 1);
  if (!same && nextCount > MAX_USERNAME_CHANGES) return fail(429, "Maximum username change limit (" + MAX_USERNAME_CHANGES + ") reached.", "LIMIT");
  const clash = await env.DB.prepare("SELECT student_id FROM users WHERE username = ?1").bind(check.username).first();
  if (clash && clash.student_id !== session.studentId) return fail(409, "Username is already taken by another student.", "USERNAME_TAKEN");
  try {
    const renameBatch = await env.DB.batch([
      env.DB.prepare("UPDATE users SET username = ?1, display_name = ?1, username_change_count = ?2, updated_at = datetime('now') WHERE student_id = ?3 AND " + SQL_WRITE_FENCE_PREDICATE).bind(check.username, nextCount, session.studentId),
      env.DB.prepare("UPDATE best_scores SET username = ?1, updated_at = datetime('now') WHERE student_id = ?2 AND " + SQL_WRITE_FENCE_PREDICATE).bind(check.username, session.studentId)
    ]);
    const updatedUserRows = Number(renameBatch && renameBatch[0] && renameBatch[0].meta && renameBatch[0].meta.changes) || 0;
    if (updatedUserRows === 0) {
      if (await isDbWriteFrozen(env)) {
        return (await requireProgressWriteFenceClear(env)) || fail(503, "Synchronization writes are temporarily paused for database maintenance.", "MAINTENANCE_WRITE_FREEZE");
      }
      return fail(404, "Account not found.", "NOT_FOUND");
    }
  } catch (_e) {
    return fail(409, "Username is already taken by another student.", "USERNAME_TAKEN");
  }
  await touchOnlineUser(env, { studentId: session.studentId, username: check.username, displayName: check.username, isGuest: session.guest, isAdmin: session.isAdmin }, Date.now(), "");
  return jsonResponse({ ok: true, profile: { studentId: session.studentId, username: check.username, changeCount: nextCount } });
}

async function handleProfileDelete(request, env, session) {
  const frozenRes = await requireProgressWriteFenceClear(env);
  if (frozenRes) return frozenRes;
  const parsed = await readJson(request);
  const body = parsed.body || {};
  const password = typeof body.password === "string" ? body.password : "";
  const confirmUsername = typeof body.confirmUsername === "string" ? body.confirmUsername : "";
  const row = await env.DB.prepare("SELECT username, password_hash FROM users WHERE student_id = ?1").bind(session.studentId).first();
  if (!row) return fail(404, "Account not found.", "NOT_FOUND");
  if (row.password_hash) {
    const verified = await verifyUserPassword(password, row.password_hash);
    if (!verified.ok) return fail(403, "Password confirmation required to delete the account.", "CONFIRM_REQUIRED");
  } else {
    const norm = function (s) { return String(s || "").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase(); };
    if (!confirmUsername || norm(confirmUsername) !== norm(row.username)) {
      return fail(403, "Type your exact username to confirm account deletion.", "CONFIRM_REQUIRED");
    }
  }
  const delRes = await deleteUserData(env, session.studentId);
  if (delRes && delRes.frozen) {
    return (await requireProgressWriteFenceClear(env)) || fail(503, "Synchronization writes are temporarily paused for database maintenance.", "MAINTENANCE_WRITE_FREEZE");
  }
  return jsonResponse({ ok: true, deleted: true });
}

// ---------------------------------------------------------------------------
// Handlers — quiz & leaderboard
// ---------------------------------------------------------------------------
function quizGateKey(session) {
  return "quiz_active_test:" + session.studentId;
}

function isQuizQuestionId(value) {
  return typeof value === "string" && value.length <= 200 &&
    /^[A-Za-z0-9_-]+::(?:quiz|sheet|lecture)::[A-Za-z0-9_-]+::[A-Za-z0-9_-]+$/.test(value);
}

function finishQuizGateStatement(env, session, gate, answers) {
  const questionIds = gate.questionIds.filter((id) => typeof answers?.[id] === "string" && /^[A-Za-z0-9]{1,4}$/.test(answers[id]));
  const finished = { ...gate, finished: true, questionIds };
  return env.DB.prepare("UPDATE admin_config SET config_json = ?3, updated_at = datetime('now') WHERE config_key = ?1 AND config_json = ?2 AND " + SQL_WRITE_FENCE_PREDICATE)
    .bind(quizGateKey(session), JSON.stringify(gate), JSON.stringify(finished));
}

async function readQuizGate(env, session) {
  const row = await env.DB.prepare("SELECT config_json FROM admin_config WHERE config_key = ?1").bind(quizGateKey(session)).first();
  const gate = row ? JSON.parse(row.config_json) : null;
  return gate && gate.expiresAt > Date.now() ? gate : null;
}

async function readQuestionFeedback(env, questionIds, prefetchedMap) {
  const uniqueKeys = [];
  const seenKeys = new Set();
  for (const id of questionIds) {
    const [subject, , quiz] = id.split("::");
    const key = subject + "::" + quiz;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      uniqueKeys.push(key);
    }
  }
  const neededConfigKeys = ["deleted_subjects", "deleted_quizzes", "hidden_quizzes"];
  for (const key of uniqueKeys) {
    neededConfigKeys.push("custom_quiz_key:" + key, "custom_quiz:" + key);
  }
  const configMap = prefetchedMap || await readConfigJsonBatch(env, neededConfigKeys);
  const deletedSubjects = new Set(Array.isArray(configMap.deleted_subjects) ? configMap.deleted_subjects : []);
  const blocked = new Set([
    ...(Array.isArray(configMap.deleted_quizzes) ? configMap.deleted_quizzes : []),
    ...(Array.isArray(configMap.hidden_quizzes) ? configMap.hidden_quizzes : []),
  ]);
  const collections = new Map();
  const feedback = Object.create(null);
  for (const id of questionIds) {
    const [subject, kind, quiz] = id.split("::");
    const key = subject + "::" + quiz;
    if (deletedSubjects.has(subject) || blocked.has(key)) continue;
    if (!collections.has(key)) {
      const custom = configMap["custom_quiz_key:" + key] || null;
      const customQuiz = custom ? (configMap["custom_quiz:" + key] || null) : null;
      collections.set(key, { key: custom || getCollection(subject, quiz), quiz: customQuiz });
    }
    const entry = collections.get(key);
    if (!entry.key) continue;
    const answer = Object.hasOwn(entry.key.answers || {}, id) ? entry.key.answers[id] : null;
    if (!answer && !(entry.key.ungradableIds || []).includes(id)) continue;
    const question = entry.quiz && entry.quiz.kind === kind &&
      (entry.quiz.questions || []).find((item) => item.internalId === id);
    const details = { correctOptionId: answer };
    const source = entry.quiz ? question : bundledExplanations[id];
    if (source) {
      for (const field of ["explanation", "explanationArabic", "arabicTranslation", "academicExplanation", "correctReasoning", "wrongAnswerClarification", "memoryTrick", "rule", "whyYouMightErr", "teachingReview"]) {
        if (typeof source[field] === "string" && source[field]) details[field] = source[field];
      }
    }
    feedback[id] = details;
  }
  return feedback;
}

function withServerTiming(response, dbMs, totalMs) {
  const headers = new Headers(response.headers);
  headers.set("Server-Timing", `db;dur=${dbMs.toFixed(2)}, total;dur=${totalMs.toFixed(2)}`);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function handleQuizFeedback(request, env) {
  const reqStart = Date.now();
  const parsed = await readJson(request);
  if (parsed.tooLarge) return fail(413, "Request too large.", "TOO_LARGE");
  const body = parsed.body;
  const action = body && body.action;

  // Fast single-round-trip path for Study & Practice feedback (most latency-sensitive student action)
  if ((action === "study" || action === "practice") && env && env.DB) {
    const token = bearerToken(request);
    if (!token) return fail(401, "Sign in to use online quiz feedback.", "AUTH_REQUIRED");
    if (action === "practice" && !/^[A-Za-z0-9]{1,4}$/.test(String(body.selectedOptionId || ""))) {
      return fail(400, "Select an answer before opening practice feedback.", "ANSWER_REQUIRED");
    }
    const questionId = String(body.questionId || "");
    if (!isQuizQuestionId(questionId)) {
      return fail(400, "Invalid question.", "BAD_REQUEST");
    }
    const [subject, , quiz] = questionId.split("::");
    const compositeKey = subject + "::" + quiz;
    const tokenHash = await sha256Hex(token);
    const now = Date.now();
    const dbStart = Date.now();
    const res = await env.DB.prepare(
      "SELECT '__session__' AS k, json_object('studentId', u.student_id, 'username', u.username) AS v " +
      "FROM user_sessions us JOIN users u ON u.student_id = us.student_id WHERE us.token_hash = ?1 AND us.expires_at > ?2 " +
      "UNION ALL " +
      "SELECT config_key AS k, config_json AS v FROM admin_config WHERE config_key IN (?3, ?4, ?5, ?6, ?7) " +
      "OR config_key = ('quiz_active_test:' || (SELECT student_id FROM user_sessions WHERE token_hash = ?1 AND expires_at > ?2 LIMIT 1))"
    ).bind(
      tokenHash,
      now,
      "deleted_subjects",
      "deleted_quizzes",
      "hidden_quizzes",
      "custom_quiz_key:" + compositeKey,
      "custom_quiz:" + compositeKey
    ).all();
    const dbMs = Date.now() - dbStart;
    const rows = (res && Array.isArray(res.results)) ? res.results : [];
    let sessionRow = null;
    const configMap = Object.create(null);
    let rawGate = null;
    for (const row of rows) {
      if (!row || !row.k || !row.v) continue;
      try {
        const parsedVal = JSON.parse(row.v);
        if (row.k === "__session__") sessionRow = parsedVal;
        else if (row.k.startsWith("quiz_active_test:")) rawGate = { key: row.k, value: parsedVal };
        else configMap[row.k] = parsedVal;
      } catch (_e) { /* ignore malformed entry */ }
    }
    if (!sessionRow || !sessionRow.studentId) {
      return withServerTiming(fail(401, "Sign in to use online quiz feedback.", "AUTH_REQUIRED"), dbMs, Date.now() - reqStart);
    }
    const gate = rawGate && rawGate.key === ("quiz_active_test:" + sessionRow.studentId) ? rawGate.value : null;
    if (gate && gate.expiresAt > now && !gate.finished) {
      return withServerTiming(fail(403, "Finish your active Test before opening study feedback.", "TEST_FEEDBACK_LOCKED"), dbMs, Date.now() - reqStart);
    }
    const feedback = await readQuestionFeedback(env, [questionId], configMap);
    if (!Object.hasOwn(feedback, questionId)) {
      return withServerTiming(fail(404, "Question not available.", "UNKNOWN_QUESTION"), dbMs, Date.now() - reqStart);
    }
    return withServerTiming(jsonResponse({ ok: true, feedback }), dbMs, Date.now() - reqStart);
  }

  const session = await getUserSession(request, env);
  if (!session) return fail(401, "Sign in to use online quiz feedback.", "AUTH_REQUIRED");
  const gate = await readQuizGate(env, session);
  const activeTest = gate && !gate.finished;
  const attemptId = safeId(body.attemptId, 80);
  if (body.action === "abandon") {
    if (activeTest && gate.attemptId === attemptId) {
      await env.DB.prepare("DELETE FROM admin_config WHERE config_key = ?1 AND config_json = ?2 AND " + SQL_WRITE_FENCE_PREDICATE)
        .bind(quizGateKey(session), JSON.stringify(gate)).run();
    }
    return jsonResponse({ ok: true });
  }
  if (body.action === "start") {
    if (attemptId.length < 8) return fail(400, "An attempt identifier is required.", "BAD_REQUEST");
    if (!Array.isArray(body.questionIds) || !body.questionIds.length ||
        body.questionIds.length > MAX_ANSWERS_PER_SUBMISSION || !body.questionIds.every(isQuizQuestionId)) {
      return fail(400, "A valid list of Test questions is required.", "BAD_REQUEST");
    }
    if (activeTest && gate.attemptId === attemptId) return jsonResponse({ ok: true });
    if (activeTest) return fail(409, "Finish or discard your active Test first.", "TEST_ACTIVE");
    const frozen = await requireProgressWriteFenceClear(env);
    if (frozen) return frozen;
    const next = { attemptId, expiresAt: Date.now() + 4 * 3600 * 1000, finished: false, questionIds: [...new Set(body.questionIds)] };
    const saved = await env.DB.prepare(
      "INSERT INTO admin_config(config_key,config_json,updated_at) SELECT ?1,?2,datetime('now') WHERE " + SQL_WRITE_FENCE_PREDICATE +
      " ON CONFLICT(config_key) DO UPDATE SET config_json=excluded.config_json,updated_at=excluded.updated_at " +
      "WHERE json_extract(admin_config.config_json,'$.finished') = 1 OR json_extract(admin_config.config_json,'$.expiresAt') <= ?3"
    ).bind(quizGateKey(session), JSON.stringify(next), Date.now()).run();
    return saved.meta.changes ? jsonResponse({ ok: true }) : fail(409, "Could not open Test. Retry or resume your current Test.", "TEST_ACTIVE");
  }
  if (body.action === "finish-unranked") {
    if (gate && gate.finished && gate.attemptId === attemptId) return jsonResponse({ ok: true });
    if (!activeTest || gate.attemptId !== attemptId) return fail(403, "Open the Test before finishing it.", "TEST_FEEDBACK_LOCKED");
    const frozen = await requireProgressWriteFenceClear(env);
    if (frozen) return frozen;
    const saved = await finishQuizGateStatement(env, session, gate, body.answers).run();
    return saved.meta.changes ? jsonResponse({ ok: true }) : fail(409, "The Test changed. Try again.", "SUBMISSION_CONFLICT");
  }
  if (body.action === "review") {
    if (activeTest || !gate || gate.attemptId !== attemptId) {
      return fail(403, "Submit your Test before opening feedback.", "TEST_FEEDBACK_LOCKED");
    }
    return jsonResponse({ ok: true, feedback: await readQuestionFeedback(env, gate.questionIds || []) });
  }
  if (activeTest) return fail(403, "Finish your active Test before opening study feedback.", "TEST_FEEDBACK_LOCKED");
  return fail(400, "Unknown quiz feedback action.", "BAD_REQUEST");
}

async function handleQuizSubmit(request, env) {
  const session = await getUserSession(request, env);
  if (!session) return fail(401, "Log in to submit a ranked quiz.", "AUTH_REQUIRED");
  const frozenRes = await requireProgressWriteFenceClear(env);
  if (frozenRes) return frozenRes;
  const parsed = await readJson(request);
  if (parsed.tooLarge) return fail(413, "Request too large.", "TOO_LARGE");
  const body = parsed.body;

  const attemptId = safeId(body.attemptId, 80);
  if (attemptId.length < 8) return fail(400, "A unique attemptId is required.", "BAD_REQUEST");
  const quizGate = await readQuizGate(env, session);
  if (quizGate && !quizGate.finished && (quizGate.attemptId !== attemptId || body.mode !== "test")) {
    return fail(403, "Complete the active Test before submitting another attempt.", "TEST_ACTIVE");
  }
  if (quizGate && !quizGate.finished && Object.keys(body.answers || {}).some((id) => !quizGate.questionIds.includes(id))) {
    return fail(400, "Submitted answers must belong to the active Test.", "UNKNOWN_QUESTION");
  }

  const reqSubjectId = safeId(body.subjectId, 120);
  const reqQuizId = safeId(body.quizId, 120);
  const deletedSubjects = await readConfigJson(env, "deleted_subjects", []);
  const deletedQuizzes = await readConfigJson(env, "deleted_quizzes", []);
  const hiddenQuizzes = await readConfigJson(env, "hidden_quizzes", []);
  const compositeKey = reqSubjectId + "::" + reqQuizId;
  if ((Array.isArray(deletedSubjects) && deletedSubjects.indexOf(reqSubjectId) !== -1) ||
      (Array.isArray(deletedQuizzes) && deletedQuizzes.indexOf(compositeKey) !== -1)) {
    return fail(400, "This quiz is no longer active.", "UNKNOWN_QUIZ");
  }
  if (Array.isArray(hiddenQuizzes) && hiddenQuizzes.indexOf(compositeKey) !== -1) {
    return fail(400, "This quiz is currently hidden by the instructor.", "UNKNOWN_QUIZ");
  }
  const customCollection = await readConfigJson(env, "custom_quiz_key:" + compositeKey, null);
  const graded = gradeQuizSubmission(body, customCollection); // score/total/percentage supplied by the client are ignored
  if (!graded.ok) return fail(graded.status, graded.error, graded.code);

  const now = Date.now();
  const windowStart = new Date(now - SUBMISSION_WINDOW_MS).toISOString().replace("T", " ").slice(0, 19);
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM quiz_attempts WHERE student_id = ?1 AND submitted_at >= ?2").bind(session.studentId, windowStart).first();
  if (recent && Number(recent.n) >= MAX_SUBMISSIONS_PER_WINDOW) return fail(429, "Too many submissions. Slow down.", "RATE_LIMITED");

  const attemptHash = await sha256Hex(session.studentId + "|" + attemptId);
  const existing = await env.DB.prepare(
    "SELECT score, total, percentage, duration_ms AS durationMs, rank_status AS rankStatus FROM quiz_attempts WHERE attempt_hash = ?1"
  ).bind(attemptHash).first();
  if (existing) {
    return jsonResponse({ ok: true, duplicate: true, attempt: attemptView(graded, existing.durationMs, existing.rankStatus, existing) });
  }

  const requestedDuration = Math.round(Number(body.durationMs));
  const durationMs = Math.max(1000, Math.min(4 * 3600 * 1000, Number.isFinite(requestedDuration) ? requestedDuration : 60000));
  const quizTitle = String(body.quizTitle || graded.quizId).trim().slice(0, 160);
  const mode = String(body.mode || "practice").trim().slice(0, 32);

  let rankStatus = "ranked";
  if (!graded.complete) rankStatus = "partial";
  else if (durationMs < graded.answered * MIN_MS_PER_ANSWER) rankStatus = "implausible_time";

  const statements = [
    env.DB.prepare(
      "INSERT INTO quiz_attempts (attempt_hash, student_id, username, subject_id, quiz_id, quiz_title, mode, score, total, percentage, duration_ms, validated_by_server, rank_status) " +
      "SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 1, ?12 WHERE " + SQL_WRITE_FENCE_PREDICATE
    ).bind(attemptHash, session.studentId, session.username, graded.subjectId, graded.quizId, quizTitle, mode, graded.score, graded.total, graded.percentage, durationMs, rankStatus)
  ];
  if (rankStatus === "ranked") {
    // An existing row that is not server-validated (old season / legacy data) is replaced outright:
    // its score must never be carried into the ranking just because a new attempt arrived.
    const better =
      "(best_scores.validated_by_server = 0 OR excluded.best_percentage > best_scores.best_percentage OR (excluded.best_percentage = best_scores.best_percentage AND " +
      "(excluded.best_score > best_scores.best_score OR (excluded.best_score = best_scores.best_score AND excluded.fastest_duration_ms < best_scores.fastest_duration_ms))))";
    statements.push(
      env.DB.prepare(
        "INSERT INTO best_scores (student_id, subject_id, quiz_id, username, quiz_title, best_score, total, best_percentage, fastest_duration_ms, attempts_count, validated_by_server) " +
        "SELECT student_id, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1, 1 FROM users WHERE student_id = ?1 AND EXISTS (SELECT 1 FROM quiz_attempts WHERE attempt_hash = ?10) AND " + SQL_WRITE_FENCE_PREDICATE + " " +
        "ON CONFLICT(student_id, subject_id, quiz_id) DO UPDATE SET " +
        "attempts_count = CASE WHEN best_scores.validated_by_server = 0 THEN 1 ELSE best_scores.attempts_count + 1 END, " +
        "updated_at = datetime('now'), username = excluded.username, validated_by_server = 1, " +
        "quiz_title = CASE WHEN " + better + " THEN excluded.quiz_title ELSE best_scores.quiz_title END, " +
        "best_score = CASE WHEN " + better + " THEN excluded.best_score ELSE best_scores.best_score END, " +
        "total = CASE WHEN " + better + " THEN excluded.total ELSE best_scores.total END, " +
        "best_percentage = CASE WHEN " + better + " THEN excluded.best_percentage ELSE best_scores.best_percentage END, " +
        "fastest_duration_ms = CASE WHEN " + better + " THEN excluded.fastest_duration_ms ELSE best_scores.fastest_duration_ms END, " +
        "achieved_at = CASE WHEN " + better + " THEN datetime('now') ELSE best_scores.achieved_at END"
      ).bind(session.studentId, graded.subjectId, graded.quizId, session.username, quizTitle, graded.score, graded.total, graded.percentage, durationMs, attemptHash)
    );
  }
  if (quizGate && !quizGate.finished) statements.push(finishQuizGateStatement(env, session, quizGate, body.answers));
  try {
    const batchRes = await env.DB.batch(statements);
    const attemptInserted = Number(batchRes && batchRes[0] && batchRes[0].meta && batchRes[0].meta.changes) || 0;
    if (attemptInserted === 0) {
      if (await isDbWriteFrozen(env)) {
        return (await requireProgressWriteFenceClear(env)) || fail(503, "Synchronization writes are temporarily paused for database maintenance. Your local progress is preserved; please retry shortly.", "MAINTENANCE_WRITE_FREEZE");
      }
      return fail(409, "Quiz submission did not commit; please retry.", "SUBMISSION_CONFLICT");
    }
  } catch (_e) {
    // Lost a race with an identical attemptId: treat as a replay.
    const again = await env.DB.prepare("SELECT 1 AS x FROM quiz_attempts WHERE attempt_hash = ?1").bind(attemptHash).first();
    if (again) return jsonResponse({ ok: true, duplicate: true, attempt: attemptView(graded, durationMs, rankStatus, null) });
    throw _e;
  }
  const stats = await getUserStudyStats(env, session.studentId);
  return jsonResponse({ ok: true, attempt: attemptView(graded, durationMs, rankStatus, null), stats: stats });
}

function attemptView(graded, durationMs, rankStatus, stored) {
  const score = stored ? Number(stored.score) : graded.score;
  const total = stored ? Number(stored.total) : graded.total;
  return {
    subjectId: graded.subjectId,
    quizId: graded.quizId,
    score: score,
    total: total,
    percentage: stored ? Number(stored.percentage) : graded.percentage,
    durationMs: durationMs,
    validatedByServer: true,
    countedInRanking: rankStatus === "ranked",
    rankStatus: rankStatus
  };
}

async function handleLeaderboard(request, env, url) {
  let subject = (url.searchParams.get("subjectId") || "").trim();
  if (subject === "all") subject = "";
  let quiz = (url.searchParams.get("quizId") || "").trim();
  if (quiz === "all") quiz = "";
  const includeAll = url.searchParams.get("includeAll") === "1" && !quiz;
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit")) || 50));
  const viewer = await getUserSession(request, env); // optional; only used for the isMe flag

  let sql;
  const binds = [];
  if (includeAll) {
    let joinCond = "b.student_id = u.student_id AND b.validated_by_server = 1";
    if (subject) {
      binds.push(subject);
      joinCond += " AND b.subject_id = ?" + binds.length;
    }
    binds.push(Math.min(500, limit * 3));
    sql =
      "SELECT u.student_id AS sid, u.username AS username, " +
      "COALESCE(SUM(b.best_score), 0) AS score, COALESCE(SUM(b.total), 0) AS total, " +
      "COALESCE(SUM(b.fastest_duration_ms), 0) AS durationMs, COALESCE(SUM(b.attempts_count), 0) AS attemptsCount, " +
      "COUNT(b.student_id) AS quizzesCount, COALESCE(MAX(b.best_percentage), 0) AS maxPct, " +
      "MIN(NULLIF(b.fastest_duration_ms, 0)) AS fastestMs, " +
      "COALESCE(SUM(CASE WHEN b.student_id IS NOT NULL THEN " + XP_SQL + " ELSE 0 END), 0) AS xp, " +
      "COALESCE(MAX(b.achieved_at), u.created_at) AS submittedAt " +
      "FROM users u LEFT JOIN best_scores b ON " + joinCond + " " +
      "GROUP BY u.student_id " +
      "ORDER BY (COUNT(b.student_id) > 0) DESC, xp DESC, (COALESCE(SUM(b.best_score), 0) * 1.0 / MAX(COALESCE(SUM(b.total), 0), 1)) DESC, score DESC, durationMs ASC, u.username COLLATE NOCASE ASC LIMIT ?" + binds.length;
  } else {
    sql =
      "SELECT b.student_id AS sid, u.username AS username, SUM(b.best_score) AS score, SUM(b.total) AS total, " +
      "SUM(b.fastest_duration_ms) AS durationMs, SUM(b.attempts_count) AS attemptsCount, COUNT(*) AS quizzesCount, " +
      "MAX(b.best_percentage) AS maxPct, MIN(NULLIF(b.fastest_duration_ms, 0)) AS fastestMs, " +
      "SUM(" + XP_SQL + ") AS xp, MAX(b.achieved_at) AS submittedAt " +
      "FROM best_scores b JOIN users u ON u.student_id = b.student_id WHERE b.validated_by_server = 1";
    if (subject) { binds.push(subject); sql += " AND b.subject_id = ?" + binds.length; }
    if (quiz) { binds.push(quiz); sql += " AND b.quiz_id = ?" + binds.length; }
    // Fetch extra rows: entries with a rejected username are hidden below, then the list is cut to `limit`.
    binds.push(Math.min(500, limit * 3));
    sql += " GROUP BY b.student_id ORDER BY xp DESC, (SUM(b.best_score) * 1.0 / MAX(SUM(b.total), 1)) DESC, score DESC, durationMs ASC, submittedAt ASC LIMIT ?" + binds.length;
  }

  const stmt = env.DB.prepare(sql);
  const res = await stmt.bind.apply(stmt, binds).all();
  const rows = (res && res.results) || [];
  const visibleRows = rows
    .filter(function (r) { return validateUsernameServer(String(r.username || "")).ok; })
    .slice(0, limit);

  // Batch-load recent activity dates to compute daily streaks & badges safely across all D1 schemas.
  const streakMap = {};
  if (visibleRows.length) {
    try {
      const sids = visibleRows.map(function (r) { return r.sid; });
      const placeholders = sids.map(function (_s, i) { return "?" + (i + 1); }).join(",");
      const dayStmt = env.DB.prepare(
        "SELECT student_id AS sid, substr(submitted_at, 1, 10) AS day FROM quiz_attempts " +
        "WHERE validated_by_server = 1 AND student_id IN (" + placeholders + ") GROUP BY student_id, substr(submitted_at, 1, 10)"
      );
      const dayRes = await dayStmt.bind.apply(dayStmt, sids).all();
      const grouped = {};
      ((dayRes && dayRes.results) || []).forEach(function (d) {
        if (!grouped[d.sid]) grouped[d.sid] = [];
        grouped[d.sid].push(d.day);
      });
      Object.keys(grouped).forEach(function (sid) {
        streakMap[sid] = computeStreakFromDates(grouped[sid]);
      });
    } catch (_e) { /* graceful fallback if table unavailable */ }
  }

  const entries = visibleRows.map(function (r, idx) {
    const total = Number(r.total) || 0;
    const score = Number(r.score) || 0;
    const xp = Number(r.xp) || 0;
    const streakDays = streakMap[r.sid] || 0;
    const quizzesCount = Number(r.quizzesCount) || 0;
    const bestPct = Number(r.maxPct) || 0;
    const fastestDurationMs = Number(r.fastestMs) || 0;
    const badges = computeBadges({ quizzesCount, bestPct, fastestDurationMs, streakDays, xp });
    return {
      rank: idx + 1,
      username: r.username,
      guest: String(r.sid || "").startsWith("gst_"),
      isGuest: String(r.sid || "").startsWith("gst_"),
      subjectId: subject || "all",
      subjectName: subject || "All Subjects",
      quizId: quiz || "all",
      quizTitle: subject ? "Subject total" : "All subjects",
      score: score,
      total: total,
      percentage: total > 0 ? Math.round((score / total) * 1000) / 10 : 0,
      durationMs: Number(r.durationMs) || 0,
      attemptsCount: Number(r.attemptsCount) || 0,
      quizzesCount: quizzesCount,
      points: xp,
      xp: xp,
      streakDays: streakDays,
      badges: badges,
      submittedAt: r.submittedAt,
      isMe: Boolean(viewer && viewer.studentId === r.sid)
    };
  });
  return jsonResponse({ ok: true, entries: entries }, 200, { "Cache-Control": "no-cache, no-store, must-revalidate", "Vary": "Authorization" });
}

// ---------------------------------------------------------------------------
// Handlers — admin
// ---------------------------------------------------------------------------
async function handleAdminLogin(request, env) {
  const secret = env.ADMIN_PASSWORD || "";
  const secretHash = env.ADMIN_PASSWORD_HASH || "";
  if (!secret && !secretHash) return fail(503, "Admin login is not configured.", "NOT_CONFIGURED");
  const ip = getClientIp(request, env);
  const key = "admin:" + ip;
  const globalKey = "admin:global";
  const now = Date.now();
  const ipRetry = await rateLocked(env, key, now);
  const retry = ipRetry || 0;
  if (retry) return fail(429, "Too many failed login attempts. Try again in " + retry + "s.", "RATE_LIMITED", { retryAfterSeconds: retry });

  const parsed = await readJson(request);
  const supplied = String(parsed.body.password == null ? "" : parsed.body.password);
  if (supplied.length > 200) return fail(400, "Password is too long.", "BAD_REQUEST");
  // Preferred: ADMIN_PASSWORD_HASH in the salted "pbkdf2$iterations$salt$digest" format written by
  // tools/admin-password.js. It wins over a plaintext ADMIN_PASSWORD so changing the password with the
  // tool always takes effect. Legacy forms (plaintext secret, unsalted SHA-256 hex) still work.
  let matches = false;
  if (/^pbkdf2\$/.test(secretHash)) {
    matches = (await verifyUserPassword(supplied, secretHash)).ok;
  } else {
    const suppliedDigest = await sha256Hex(supplied);
    const expectedDigest = secret ? await sha256Hex(secret) : String(secretHash).toLowerCase();
    matches = constantTimeEqual(suppliedDigest, expectedDigest);
  }
  if (!matches) {
    const [state, globalState] = await Promise.all([
      rateRecordFailure(env, key, now, ADMIN_LIMIT.max, ADMIN_LIMIT.windowMs, ADMIN_LIMIT.lockMs),
      rateRecordFailure(env, globalKey, now, ADMIN_GLOBAL_LIMIT.max, ADMIN_GLOBAL_LIMIT.windowMs, ADMIN_GLOBAL_LIMIT.lockMs),
    ]);
    return fail(401, "Invalid admin password.", "BAD_CREDENTIALS", { remainingAttempts: Math.min(state.remaining, globalState.remaining) });
  }
  await Promise.all([rateClear(env, key), rateClear(env, globalKey)]);
  const raw = generateSessionToken();
  const expiresAt = now + ADMIN_SESSION_TTL_MS;
  await env.DB.prepare(
    "INSERT INTO admin_sessions (token_hash, ip_address, user_agent, created_at, expires_at, is_master_admin, student_id) VALUES (?1, ?2, ?3, ?4, ?5, 1, '')"
  ).bind(await sha256Hex(raw), ip, (request.headers.get("User-Agent") || "").slice(0, 200), now, expiresAt).run();
  await env.DB.prepare("DELETE FROM admin_sessions WHERE expires_at < ?1").bind(now).run();
  // The session lives in an HttpOnly cookie; the token is not returned to page script.
  return jsonResponse(
    { ok: true, expiresAt: expiresAt },
    200,
    { "Set-Cookie": "mcq_admin_session=" + encodeURIComponent(raw) + "; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=" + Math.floor(ADMIN_SESSION_TTL_MS / 1000) }
  );
}

async function handleAdminContent(request, env) {
  const admin = await requireAdmin(request, env);
  if (!admin) return fail(401, "Admin authentication required.", "AUTH_REQUIRED");
  const parsed = await readJson(request);
  if (parsed.tooLarge) return fail(413, "Request too large.", "TOO_LARGE");
  const body = parsed.body;
  const result = sanitizeOverlay(body.overrides);
  if (!result.ok) return fail(400, result.error, "BAD_CONTENT");
  const current = await env.DB.prepare("SELECT config_json, updated_at FROM admin_config WHERE config_key = 'content_library_overrides'").first();
  if (admin.kind !== "master") {
    if (body.force === true) {
      return fail(403, "Master admin session required to force-overwrite the content library.", "FORBIDDEN");
    }
    let currentOverlay = null;
    if (current && current.config_json) {
      try { currentOverlay = JSON.parse(current.config_json); } catch (_e) { currentOverlay = null; }
    }
    const types = Object.keys(OVERLAY_LIMITS);
    for (let t = 0; t < types.length; t += 1) {
      const type = types[t];
      const nextList = result.overlay[type] || [];
      const nextIds = new Set(nextList.map(function (it) { return it && it.id; }).filter(Boolean));
      const prevItems = (currentOverlay && Array.isArray(currentOverlay[type])) ? currentOverlay[type] : [];
      const prevById = new Map();
      for (let i = 0; i < prevItems.length; i += 1) {
        if (!prevItems[i] || !prevItems[i].id) continue;
        if (!nextIds.has(prevItems[i].id)) {
          return fail(403, "Master admin session required to permanently delete or wipe content library items.", "FORBIDDEN");
        }
        prevById.set(prevItems[i].id, prevItems[i]);
      }
      const bundledMap = (answerKeyModule && answerKeyModule.bundledLibrary && answerKeyModule.bundledLibrary[type]) || {};
      for (let k = 0; k < nextList.length; k += 1) {
        const nextItem = nextList[k];
        if (!nextItem || !nextItem.id) continue;
        if (prevById.has(nextItem.id)) {
          if (overlayContentSignature(nextItem) !== overlayContentSignature(prevById.get(nextItem.id))) {
            return fail(403, "Master admin session required to modify existing content library items.", "FORBIDDEN");
          }
        } else if (Object.prototype.hasOwnProperty.call(bundledMap, nextItem.id)) {
          if (overlayContentSignature(nextItem) !== overlayContentSignature(bundledMap[nextItem.id])) {
            return fail(403, "Master admin session required to modify bundled content library items.", "FORBIDDEN");
          }
        }
      }
      const prevRemoved = new Set((currentOverlay && currentOverlay.removed && Array.isArray(currentOverlay.removed[type])) ? currentOverlay.removed[type] : []);
      const nextRemoved = (result.overlay.removed && Array.isArray(result.overlay.removed[type])) ? result.overlay.removed[type] : [];
      for (let j = 0; j < nextRemoved.length; j += 1) {
        if (!prevRemoved.has(nextRemoved[j])) {
          return fail(403, "Master admin session required to permanently remove content library items.", "FORBIDDEN");
        }
      }
    }
  }
  if (current && body.baseUpdatedAt !== current.updated_at && body.force !== true) {
    return fail(409, "Content was changed by someone else. Reload and try again.", "CONFLICT", { updatedAt: current.updated_at });
  }
  await env.DB.prepare(
    "INSERT INTO admin_config (config_key, config_json, updated_at) VALUES ('content_library_overrides', ?1, datetime('now')) ON CONFLICT(config_key) DO UPDATE SET config_json = ?1, updated_at = datetime('now')"
  ).bind(JSON.stringify(result.overlay)).run();
  const saved = await env.DB.prepare("SELECT updated_at FROM admin_config WHERE config_key = 'content_library_overrides'").first();
  return jsonResponse({ ok: true, updatedAt: saved ? saved.updated_at : null });
}

async function handleAdminUpload(request, env, url) {
  if (!(await requireAdmin(request, env))) return fail(401, "Admin authentication required.", "AUTH_REQUIRED");
  if (!env.FILES) return fail(503, "File storage is not available.", "R2_UNBOUND");

  const declared = Number(request.headers.get("Content-Length"));
  if (!Number.isFinite(declared) || declared <= 0) return fail(411, "Content-Length is required.", "LENGTH_REQUIRED");
  if (declared > MAX_PDF_BYTES) return fail(413, "File exceeds the " + Math.round(MAX_PDF_BYTES / 1048576) + " MB limit.", "TOO_LARGE");

  const buffer = await request.arrayBuffer();
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_PDF_BYTES) return fail(413, "Invalid file size.", "TOO_LARGE");
  const magic = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(5, buffer.byteLength)));
  if (magic !== "%PDF-") return fail(415, "Only PDF files are accepted.", "UNSUPPORTED_TYPE");

  const subjectId = String(url.searchParams.get("subjectId") || "general").toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "general";
  const title = String(url.searchParams.get("title") || "Lecture PDF").trim().slice(0, 160) || "Lecture PDF";
  const category = String(url.searchParams.get("category") || "Lectures").trim().slice(0, 80) || "Lectures";
  // The object key is generated here; client-provided keys/paths are never used.
  const key = "pdfs/" + subjectId + "/" + randomHex(16) + ".pdf";
  await env.FILES.put(key, buffer, { httpMetadata: { contentType: "application/pdf" } });

  const id = "pdf-" + randomHex(8);
  const publicUrl = "/api/r2/" + key;
  try {
    await env.DB.prepare(
      "INSERT INTO pdfs_meta (id, subject_id, category, title, r2_key, url, size_label) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"
    ).bind(id, subjectId, category, title, key, publicUrl, Math.max(1, Math.round(buffer.byteLength / 1024)) + " KB").run();
  } catch (e) {
    await env.FILES.delete(key); // never leave an unreferenced object behind
    throw e;
  }
  return jsonResponse({ ok: true, pdf: { id: id, subjectId: subjectId, category: category, title: title, r2Key: key, url: publicUrl, bytes: buffer.byteLength } });
}

async function handleFileGet(request, env, pathname) {
  if (!env.FILES) return fail(503, "File storage is not available.", "R2_UNBOUND");
  let key = "";
  try { key = decodeURIComponent(pathname.slice("/api/r2/".length)); } catch (_e) { return fail(400, "Invalid file key.", "BAD_REQUEST"); }
  if (QUIZ_IMAGE_KEY_PATTERN.test(key)) {
    const imgIndex = await readConfigJson(env, "quiz_images_index", {});
    const imgMeta = imgIndex && imgIndex[key];
    if (!imgMeta) return fail(404, "File not found.", "NOT_FOUND");
    const imgObj = await env.FILES.get(key);
    if (!imgObj) return fail(404, "File not found.", "NOT_FOUND");
    const ext = key.split(".").pop();
    const contentType = QUIZ_IMAGE_MIME[ext] || "application/octet-stream";
    return new Response(request.method === "HEAD" ? null : imgObj.body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "public, max-age=86400"
      }
    });
  }
  // Only PDFs uploaded through the admin route (registered in D1) are ever served.
  if (!PDF_KEY_PATTERN.test(key)) return fail(404, "File not found.", "NOT_FOUND");
  const meta = await env.DB.prepare("SELECT title FROM pdfs_meta WHERE r2_key = ?1 AND is_deleted = 0").bind(key).first();
  if (!meta) return fail(404, "File not found.", "NOT_FOUND");
  const obj = await env.FILES.get(key);
  if (!obj) return fail(404, "File not found.", "NOT_FOUND");
  const wantDownload = new URL(request.url).searchParams.get("download") === "1";
  const fileName = (String(meta.title || "document").replace(/[^A-Za-z0-9._ -]/g, "_").slice(0, 80) || "document") + ".pdf";
  return new Response(request.method === "HEAD" ? null : obj.body, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": (wantDownload ? "attachment" : "inline") + '; filename="' + fileName + '"',
      // Type is forced to application/pdf and sniffing is off, so the browser can only treat it as a PDF.
      // (No CSP `sandbox` here: Chrome refuses to render PDFs inside sandboxed documents.)
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=3600"
    }
  });
}

async function handleQuestionReport(request, env) {
  const now = Date.now();
  const ipKey = "report:ip:" + getClientIp(request, env);
  const locked = await rateLocked(env, ipKey, now);
  if (locked) return fail(429, "Too many reports submitted. Try again in " + locked + "s.", "RATE_LIMITED", { retryAfterSeconds: locked });

  const parsed = await readJson(request);
  if (parsed.tooLarge) return fail(413, "Request too large.", "TOO_LARGE");
  const body = parsed.body;
  const subjectId = safeId(body.subjectId, 120);
  const quizId = safeId(body.quizId, 120);
  const questionId = safeId(body.questionId, 200);
  if (!subjectId || !quizId || !questionId) {
    return fail(400, "subjectId, quizId, and questionId are required.", "BAD_REQUEST");
  }
  const rawReason = String(body.reason || "incorrect_answer").trim().toLowerCase();
  const reason = ALLOWED_REPORT_REASONS.indexOf(rawReason) !== -1 ? rawReason : "other";
  const details = String(body.details || "").normalize("NFKC").replace(/[\x00-\x08\x0b-\x1f]/g, "").trim().slice(0, 1000);
  const questionText = String(body.questionText || "").normalize("NFKC").replace(/[\x00-\x1f]/g, " ").trim().slice(0, 300);

  const session = await getUserSession(request, env);
  const studentId = session ? session.studentId : "";
  const username = session ? session.username : "Anonymous";
  const reportId = "rep_" + randomHex(8);

  await rateRecordFailure(env, ipKey, now, REPORT_SUBMIT_LIMIT.max, REPORT_SUBMIT_LIMIT.windowMs, REPORT_SUBMIT_LIMIT.lockMs);
  try {
    await env.DB.prepare(
      "INSERT INTO question_reports (id, student_id, username, subject_id, quiz_id, question_id, question_text, reason, details, status) " +
      "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'open')"
    ).bind(reportId, studentId, username, subjectId, quizId, questionId, questionText, reason, details).run();
  } catch (_e) {
    return fail(503, "Question reporting storage is not initialized yet.", "REPORTS_UNAVAILABLE");
  }
  return jsonResponse({ ok: true, report: { id: reportId, status: "open", reason: reason, subjectId: subjectId, quizId: quizId, questionId: questionId } });
}

async function handleAdminReports(request, env, url) {
  const admin = await requireAdmin(request, env);
  if (!admin) return fail(401, "Admin authentication required.", "AUTH_REQUIRED");
  const statusFilter = String(url.searchParams.get("status") || "open").trim().toLowerCase();
  const validStatuses = ["open", "resolved", "dismissed", "all"];
  const status = validStatuses.indexOf(statusFilter) !== -1 ? statusFilter : "open";
  try {
    let stmt;
    if (status === "all") {
      stmt = env.DB.prepare(
        "SELECT id, student_id AS studentId, username, subject_id AS subjectId, quiz_id AS quizId, question_id AS questionId, " +
        "question_text AS questionText, reason, details, status, resolution_note AS resolutionNote, resolved_by AS resolvedBy, " +
        "created_at AS createdAt, resolved_at AS resolvedAt FROM question_reports ORDER BY created_at DESC LIMIT 100"
      );
    } else {
      stmt = env.DB.prepare(
        "SELECT id, student_id AS studentId, username, subject_id AS subjectId, quiz_id AS quizId, question_id AS questionId, " +
        "question_text AS questionText, reason, details, status, resolution_note AS resolutionNote, resolved_by AS resolvedBy, " +
        "created_at AS createdAt, resolved_at AS resolvedAt FROM question_reports WHERE status = ?1 ORDER BY created_at DESC LIMIT 100"
      ).bind(status);
    }
    const res = await stmt.all();
    const reports = ((res && res.results) || []).map(function (r) {
      if (admin.kind === "master") return r;
      const copy = Object.assign({}, r);
      delete copy.studentId;
      return copy;
    });
    return jsonResponse({ ok: true, reports: reports });
  } catch (_e) {
    return fail(503, "Question reporting storage is not initialized yet.", "REPORTS_UNAVAILABLE");
  }
}

async function handleAdminReportResolve(request, env) {
  const admin = await requireAdmin(request, env);
  if (!admin) return fail(401, "Admin authentication required.", "AUTH_REQUIRED");
  const parsed = await readJson(request);
  if (parsed.tooLarge) return fail(413, "Request too large.", "TOO_LARGE");
  const id = safeId(parsed.body.id, 64);
  const nextStatus = String(parsed.body.status || "resolved").trim().toLowerCase();
  if (!id || ["open", "resolved", "dismissed"].indexOf(nextStatus) === -1) {
    return fail(400, "Valid report id and status (open, resolved, dismissed) are required.", "BAD_REQUEST");
  }
  const note = String(parsed.body.resolutionNote || "").normalize("NFKC").replace(/[\x00-\x08\x0b-\x1f]/g, "").trim().slice(0, 500);
  const resolvedBy = admin.username || (admin.kind === "master" ? "master" : "admin");
  const resolvedAt = nextStatus === "open" ? null : new Date().toISOString().replace("T", " ").slice(0, 19);
  try {
    const res = await env.DB.prepare(
      "UPDATE question_reports SET status = ?1, resolution_note = ?2, resolved_by = ?3, resolved_at = ?4 WHERE id = ?5"
    ).bind(nextStatus, note, resolvedBy, resolvedAt, id).run();
    if (!res || !res.meta || Number(res.meta.changes) === 0) return fail(404, "Report not found.", "NOT_FOUND");
    return jsonResponse({ ok: true, id: id, status: nextStatus, resolutionNote: note });
  } catch (_e) {
    return fail(503, "Question reporting storage is not initialized yet.", "REPORTS_UNAVAILABLE");
  }
}

// ---------------------------------------------------------------------------
// Config & Dynamic Course / Quiz / Hard-Delete Helpers
// ---------------------------------------------------------------------------
async function readConfigJson(env, configKey, fallback) {
  try {
    const row = await env.DB.prepare("SELECT config_json FROM admin_config WHERE config_key = ?1").bind(configKey).first();
    if (row && row.config_json) return JSON.parse(row.config_json);
  } catch (_e) { /* return fallback */ }
  return fallback;
}

async function readConfigJsonBatch(env, keys) {
  const map = Object.create(null);
  const unique = Array.from(new Set((Array.isArray(keys) ? keys : []).filter(Boolean)));
  if (!unique.length || !env || !env.DB) return map;
  try {
    const placeholders = unique.map((_, idx) => "?" + (idx + 1)).join(", ");
    const res = await env.DB.prepare("SELECT config_key, config_json FROM admin_config WHERE config_key IN (" + placeholders + ")")
      .bind(...unique)
      .all();
    const rows = (res && Array.isArray(res.results)) ? res.results : [];
    for (const row of rows) {
      if (!row || !row.config_key || !row.config_json) continue;
      try { map[row.config_key] = JSON.parse(row.config_json); } catch (_e) { /* ignore malformed */ }
    }
  } catch (_e) { /* return partial/empty map */ }
  return map;
}

async function writeConfigJson(env, configKey, value) {
  const json = JSON.stringify(value);
  await env.DB.prepare(
    "INSERT INTO admin_config (config_key, config_json, updated_at) VALUES (?1, ?2, datetime('now')) " +
    "ON CONFLICT(config_key) DO UPDATE SET config_json = ?2, updated_at = datetime('now')"
  ).bind(configKey, json).run();
}

async function deleteConfigKey(env, configKey) {
  await env.DB.prepare("DELETE FROM admin_config WHERE config_key = ?1").bind(configKey).run();
}

function cleanPlainText(value, maxLen, allowNewlines) {
  const str = String(value == null ? "" : value).normalize("NFKC");
  const re = allowNewlines ? /[\x00-\x08\x0b\x0c\x0e-\x1f]/g : /[\x00-\x1f]/g;
  return str.replace(re, allowNewlines ? "" : " ").trim().slice(0, maxLen || 200);
}

function slugifyId(raw, fallback) {
  const slug = String(raw || "").toLowerCase().normalize("NFKC")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
  return slug || fallback || "";
}

async function readOptionalJsonOrParams(request, url) {
  const body = {};
  const text = await request.text().catch(function () { return ""; });
  if (text && text.length <= MAX_JSON_BODY_BYTES) {
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) Object.assign(body, parsed);
    } catch (_e) { /* ignore non-JSON body */ }
  }
  url.searchParams.forEach(function (v, k) {
    if (body[k] === undefined) body[k] = v;
  });
  return body;
}

function detectQuizImageType(uint8) {
  if (!uint8 || uint8.length < 12) return null;
  if (
    uint8[0] === 0x89 && uint8[1] === 0x50 && uint8[2] === 0x4E && uint8[3] === 0x47 &&
    uint8[4] === 0x0D && uint8[5] === 0x0A && uint8[6] === 0x1A && uint8[7] === 0x0A
  ) {
    return { ext: "png", contentType: "image/png" };
  }
  if (uint8[0] === 0xFF && uint8[1] === 0xD8 && uint8[2] === 0xFF) {
    return { ext: "jpg", contentType: "image/jpeg" };
  }
  if (
    uint8[0] === 0x47 && uint8[1] === 0x49 && uint8[2] === 0x46 && uint8[3] === 0x38 &&
    (uint8[4] === 0x37 || uint8[4] === 0x39) && uint8[5] === 0x61
  ) {
    return { ext: "gif", contentType: "image/gif" };
  }
  if (
    uint8[0] === 0x52 && uint8[1] === 0x49 && uint8[2] === 0x46 && uint8[3] === 0x46 &&
    uint8[8] === 0x57 && uint8[9] === 0x45 && uint8[10] === 0x42 && uint8[11] === 0x50
  ) {
    return { ext: "webp", contentType: "image/webp" };
  }
  return null;
}

function sanitizeQuizImageUrl(raw) {
  if (typeof raw !== "string") return "";
  const s = raw.trim();
  if (!s) return "";
  if (/^\/(?!\/)[^\s"'<>\\]{1,500}$/.test(s)) return s;
  if (/^https:\/\/[^\s"'<>\\]{4,1000}$/i.test(s)) return s;
  if (/^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]{16,380000}$/i.test(s)) return s;
  return "";
}

function normalizeQuestionImageList(rawQuestion) {
  if (!rawQuestion || typeof rawQuestion !== "object") return { ok: true, images: [] };
  const rawList = [];
  const defaultAlt = cleanPlainText(rawQuestion.imageAlt || rawQuestion.alt || "", 200, false);
  const defaultCaption = cleanPlainText(rawQuestion.imageCaption || rawQuestion.caption || "", 300, true);

  if (Array.isArray(rawQuestion.images)) {
    for (let k = 0; k < rawQuestion.images.length; k += 1) {
      rawList.push(rawQuestion.images[k]);
    }
  }
  const singleCandidate = rawQuestion.image || rawQuestion.imageUrl || rawQuestion.img || rawQuestion.diagram || rawQuestion.figure;
  if (singleCandidate) {
    rawList.push(singleCandidate);
  }

  const out = [];
  const seenUrls = new Set();
  for (let k = 0; k < rawList.length; k += 1) {
    const entry = rawList[k];
    if (!entry) continue;
    let rawUrl = "";
    let alt = defaultAlt;
    let caption = defaultCaption;
    if (typeof entry === "string") {
      rawUrl = entry;
    } else if (typeof entry === "object") {
      rawUrl = String(entry.url || entry.src || entry.image || "");
      alt = cleanPlainText(entry.alt || defaultAlt, 200, false);
      caption = cleanPlainText(entry.caption || defaultCaption, 300, true);
    } else {
      continue;
    }
    const trimmed = String(rawUrl || "").trim();
    if (!trimmed) continue;
    const cleanUrl = sanitizeQuizImageUrl(trimmed);
    if (!cleanUrl) {
      return { ok: false, error: "Invalid or unsafe image URL (use /api/r2/..., /content/..., https://..., or safe PNG/JPG/WebP/GIF data URI)." };
    }
    if (seenUrls.has(cleanUrl)) continue;
    seenUrls.add(cleanUrl);
    if (out.length >= MAX_QUIZ_IMAGES_PER_QUESTION) {
      return { ok: false, error: "Maximum " + MAX_QUIZ_IMAGES_PER_QUESTION + " images per question." };
    }
    const obj = { url: cleanUrl };
    if (alt) obj.alt = alt;
    if (caption) obj.caption = caption;
    out.push(obj);
  }

  return { ok: true, images: out };
}

function sanitizeCustomQuizPayload(rawBody) {
  const subjectId = safeId(rawBody && rawBody.subjectId, 64);
  const rawQuizId = safeId((rawBody && (rawBody.quizId || rawBody.id)) || slugifyId(rawBody && rawBody.title), 80);
  if (!subjectId || !rawQuizId) {
    return { ok: false, error: "Valid subjectId and quizId/title are required." };
  }
  const rawKind = String((rawBody && rawBody.kind) || "quiz").trim().toLowerCase();
  const kind = ["quiz", "sheet", "lecture"].indexOf(rawKind) !== -1 ? rawKind : "quiz";
  const title = cleanPlainText(rawBody && rawBody.title, 160, false);
  if (!title || /[<>]/.test(title)) {
    return { ok: false, error: "Quiz title must be 1–160 plain text characters." };
  }
  const rawQuestions = rawBody && Array.isArray(rawBody.questions) ? rawBody.questions : null;
  if (!rawQuestions || rawQuestions.length === 0) {
    return { ok: false, error: "At least 1 question is required." };
  }
  if (rawQuestions.length > 500) {
    return { ok: false, error: "Maximum 500 questions per imported quiz." };
  }

  const seenQIds = new Set();
  const cleanQuestions = [];
  const answers = {};
  const ungradableIds = [];
  let gradableQuestions = 0;

  for (let i = 0; i < rawQuestions.length; i += 1) {
    const q = rawQuestions[i];
    if (!q || typeof q !== "object") return { ok: false, error: "Invalid question at index " + (i + 1) + "." };
    const stem = cleanPlainText(q.question || q.text, 3000, true);
    if (!stem) return { ok: false, error: "Question " + (i + 1) + " is missing text." };
    const rawOpts = Array.isArray(q.options) ? q.options : [];
    if (rawOpts.length < 2 || rawOpts.length > 8) {
      return { ok: false, error: "Question " + (i + 1) + " must have 2–8 options." };
    }
    const cleanOpts = [];
    const optIds = new Set();
    const defaultLetters = ["A", "B", "C", "D", "E", "F", "G", "H"];
    for (let o = 0; o < rawOpts.length; o += 1) {
      const opt = rawOpts[o];
      const optText = typeof opt === "string" ? cleanPlainText(opt, 1200, true) : cleanPlainText(opt && (opt.text || opt.option), 1200, true);
      if (!optText) return { ok: false, error: "Question " + (i + 1) + " has an empty option." };
      let optId = typeof opt === "object" && opt && opt.id ? String(opt.id).trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) : "";
      if (!optId || optIds.has(optId)) optId = defaultLetters[o] || String(o + 1);
      optIds.add(optId);
      cleanOpts.push({ id: optId, text: optText });
    }

    let qId = safeId(q.id, 40) || ("Q" + (i + 1));
    if (seenQIds.has(qId)) {
      let suffix = 2;
      while (seenQIds.has(qId + "_" + suffix)) suffix += 1;
      qId = qId + "_" + suffix;
    }
    seenQIds.add(qId);

    const internalId = subjectId + "::" + kind + "::" + rawQuizId + "::" + qId;
    let correctId = q.correctOptionId ? String(q.correctOptionId).trim().toUpperCase().slice(0, 4) : null;
    if (correctId && !optIds.has(correctId)) correctId = null;

    const cleanQ = {
      id: qId,
      internalId: internalId,
      number: i + 1,
      question: stem,
      text: stem,
      options: cleanOpts,
      correctOptionId: correctId
    };
    const metaFields = [
      ["explanation", 4000],
      ["explanationArabic", 4000],
      ["rule", 1200],
      ["whyYouMightErr", 2000],
      ["memoryTrick", 1000],
      ["arabicTranslation", 2000]
    ];
    for (let m = 0; m < metaFields.length; m += 1) {
      const mf = metaFields[m][0];
      const maxM = metaFields[m][1];
      if (q[mf]) {
        const val = cleanPlainText(q[mf], maxM, true);
        if (val) cleanQ[mf] = val;
      }
    }
    const imgCheck = normalizeQuestionImageList(q);
    if (!imgCheck.ok) {
      return { ok: false, error: "Question " + (i + 1) + ": " + imgCheck.error };
    }
    if (imgCheck.images.length > 0) {
      cleanQ.image = imgCheck.images[0].url;
      if (imgCheck.images[0].alt) cleanQ.imageAlt = imgCheck.images[0].alt;
      if (imgCheck.images[0].caption) cleanQ.imageCaption = imgCheck.images[0].caption;
      cleanQ.images = imgCheck.images;
    }
    cleanQuestions.push(cleanQ);

    if (correctId) {
      answers[internalId] = correctId;
      answers[qId] = correctId;
      gradableQuestions += 1;
    } else {
      ungradableIds.push(internalId);
      ungradableIds.push(qId);
    }
  }

  return {
    ok: true,
    subjectId,
    quizId: rawQuizId,
    kind,
    title,
    quizData: {
      id: rawQuizId,
      subjectId,
      kind,
      title,
      questions: cleanQuestions,
      updatedAt: new Date().toISOString()
    },
    keyData: {
      subjectId,
      quizId: rawQuizId,
      gradableQuestions,
      ungradableIds,
      answers
    }
  };
}

async function handleDynamicCatalogGet(_request, env, url) {
  const customSubjects = await readConfigJson(env, "custom_subjects", {});
  const deletedSubjectIds = await readConfigJson(env, "deleted_subjects", []);
  const quizzesIndex = await readConfigJson(env, "custom_quizzes_index", {});
  const deletedQuizKeys = await readConfigJson(env, "deleted_quizzes", []);
  const hiddenQuizKeys = await readConfigJson(env, "hidden_quizzes", []);
  const questionImagesAll = await readConfigJson(env, "quiz_question_images", {});

  const customQuizzes = Object.keys(quizzesIndex || {}).map(function (k) {
    return quizzesIndex[k];
  }).filter(Boolean);

  const reqSubjectId = safeId(url.searchParams.get("subjectId"), 64);
  let subjectQuizzes = undefined;
  let subjectQuestionImages = undefined;
  if (reqSubjectId) {
    subjectQuizzes = [];
    for (let i = 0; i < customQuizzes.length; i += 1) {
      const meta = customQuizzes[i];
      if (meta.subjectId === reqSubjectId) {
        const fullQuiz = await readConfigJson(env, "custom_quiz:" + reqSubjectId + "::" + meta.quizId, null);
        const composite = reqSubjectId + "::" + meta.quizId;
        if (fullQuiz && !(Array.isArray(deletedSubjectIds) && deletedSubjectIds.includes(reqSubjectId)) &&
            !(Array.isArray(deletedQuizKeys) && deletedQuizKeys.includes(composite))) {
          subjectQuizzes.push({
            id: fullQuiz.id,
            subjectId: fullQuiz.subjectId,
            kind: fullQuiz.kind,
            title: fullQuiz.title,
            updatedAt: fullQuiz.updatedAt,
            questions: (fullQuiz.questions || []).map((q) => ({
              id: q.id,
              internalId: q.internalId,
              number: q.number,
              isGradable: Boolean(q.correctOptionId),
              question: q.question,
              text: q.text,
              options: (q.options || []).map(({ id, text, image }) => ({ id, text, image })),
              image: q.image,
              imageAlt: q.imageAlt,
              imageCaption: q.imageCaption,
              images: Array.isArray(q.images) ? q.images.map(({ url, alt, caption }) => ({ url, alt, caption })) : undefined,
            })),
          });
        }
      }
    }
    subjectQuestionImages = {};
    const prefix = reqSubjectId + "::";
    if (questionImagesAll && typeof questionImagesAll === "object") {
      Object.keys(questionImagesAll).forEach(function (compositeKey) {
        if (compositeKey.indexOf(prefix) === 0 && questionImagesAll[compositeKey]) {
          const qzId = compositeKey.slice(prefix.length);
          subjectQuestionImages[qzId] = questionImagesAll[compositeKey];
        }
      });
    }
  }

  const questionImageCounts = {};
  if (questionImagesAll && typeof questionImagesAll === "object") {
    Object.keys(questionImagesAll).forEach(function (compositeKey) {
      const map = questionImagesAll[compositeKey];
      if (!map || typeof map !== "object") return;
      let count = 0;
      Object.keys(map).forEach(function (qId) {
        if (Array.isArray(map[qId]) && map[qId].length > 0) count += 1;
      });
      if (count > 0) questionImageCounts[compositeKey] = count;
    });
  }

  const payload = {
    ok: true,
    customSubjects: customSubjects && typeof customSubjects === "object" ? customSubjects : {},
    deletedSubjectIds: Array.isArray(deletedSubjectIds) ? deletedSubjectIds : [],
    customQuizzes: customQuizzes,
    deletedQuizKeys: Array.isArray(deletedQuizKeys) ? deletedQuizKeys : [],
    hiddenQuizKeys: Array.isArray(hiddenQuizKeys) ? hiddenQuizKeys : [],
    questionImageCounts: questionImageCounts
  };
  if (subjectQuizzes !== undefined) payload.subjectQuizzes = subjectQuizzes;
  if (subjectQuestionImages !== undefined) payload.subjectQuestionImages = subjectQuestionImages;
  return jsonResponse(payload, 200, { "Cache-Control": "no-store" });
}

async function handleAdminSubjectSave(request, env) {
  const admin = await requireAdmin(request, env);
  if (!admin) return fail(401, "Admin authentication required.", "AUTH_REQUIRED");
  const parsed = await readJson(request);
  if (parsed.tooLarge) return fail(413, "Request too large.", "TOO_LARGE");
  const body = parsed.body || {};

  const name = cleanPlainText(body.name, 120, false);
  if (!name || /[<>]/.test(name)) return fail(400, "Course name must be 1–120 plain text characters.", "BAD_NAME");
  const id = slugifyId(body.id || name);
  if (!id || id.length < 2) return fail(400, "Valid course slug id (2–64 chars) is required.", "BAD_ID");
  const nameAr = cleanPlainText(body.nameAr, 120, false);
  if (/[<>]/.test(nameAr)) return fail(400, "Invalid characters in Arabic name.", "BAD_NAME");
  const description = cleanPlainText(body.description, 300, false);
  if (/[<>]/.test(description)) return fail(400, "Invalid characters in course description.", "BAD_REQUEST");
  const rawAccent = String(body.accent || "").trim();
  const accent = /^#[0-9a-fA-F]{6}$/.test(rawAccent) ? rawAccent : "";

  const customSubjects = await readConfigJson(env, "custom_subjects", {});
  const staticCols = (answerKeyModule && answerKeyModule.collections) || {};
  const isBundledSubject = Object.keys(staticCols).some(function (k) { return k.indexOf(id + "::") === 0; });
  const isExistingSubject = Object.prototype.hasOwnProperty.call(customSubjects, id);
  if ((isBundledSubject || isExistingSubject) && admin.kind !== "master") {
    return fail(403, "Master admin session required to overwrite an existing course.", "FORBIDDEN");
  }
  const prev = customSubjects[id] || {};
  const record = {
    id,
    name,
    nameAr: nameAr || "",
    description: description || "",
    accent: accent || prev.accent || "",
    updatedAt: new Date().toISOString()
  };
  customSubjects[id] = record;
  await writeConfigJson(env, "custom_subjects", customSubjects);

  // If previously deleted/hidden as a bundled course, restore it.
  const deletedSubjects = await readConfigJson(env, "deleted_subjects", []);
  if (Array.isArray(deletedSubjects) && deletedSubjects.indexOf(id) !== -1) {
    await writeConfigJson(env, "deleted_subjects", deletedSubjects.filter(function (s) { return s !== id; }));
  }

  // Clear stale display override so the edited name applies directly.
  const nameOverrides = await readConfigJson(env, "subject_name_overrides", {});
  if (nameOverrides && Object.prototype.hasOwnProperty.call(nameOverrides, id)) {
    delete nameOverrides[id];
    await writeConfigJson(env, "subject_name_overrides", nameOverrides);
  }

  return jsonResponse({ ok: true, subject: record });
}

async function handleAdminSubjectDelete(request, env, url) {
  const gate = await requireMasterAdmin(request, env);
  if (!gate.ok) return gate.response;
  const frozenRes = await requireProgressWriteFenceClear(env);
  if (frozenRes) return frozenRes;
  const body = await readOptionalJsonOrParams(request, url);
  const subjectId = safeId(body.subjectId || body.id, 64);
  if (!subjectId) return fail(400, "Valid subjectId is required.", "BAD_REQUEST");

  // 1. Purge custom subject record + deleted_subjects (if bundled)
  const customSubjects = await readConfigJson(env, "custom_subjects", {});
  delete customSubjects[subjectId];
  await writeConfigJson(env, "custom_subjects", customSubjects);

  const staticCols = (answerKeyModule && answerKeyModule.collections) || {};
  const hasBundledQuizzes = Object.keys(staticCols).some(function (k) { return k.indexOf(subjectId + "::") === 0; });
  if (hasBundledQuizzes || body.isBundled === true || body.isBundled === "1") {
    const deletedSubjects = await readConfigJson(env, "deleted_subjects", []);
    const nextDeleted = Array.isArray(deletedSubjects) ? deletedSubjects.slice() : [];
    if (nextDeleted.indexOf(subjectId) === -1) nextDeleted.push(subjectId);
    await writeConfigJson(env, "deleted_subjects", nextDeleted);
  }

  // 2. Purge all custom quizzes & server grading keys belonging to this course
  const quizzesIndex = await readConfigJson(env, "custom_quizzes_index", {});
  const nextIndex = {};
  const keys = Object.keys(quizzesIndex || {});
  for (let i = 0; i < keys.length; i += 1) {
    const k = keys[i];
    const item = quizzesIndex[k];
    if (item && item.subjectId === subjectId) {
      await deleteConfigKey(env, "custom_quiz:" + k);
      await deleteConfigKey(env, "custom_quiz_key:" + k);
    } else if (item) {
      nextIndex[k] = item;
    }
  }
  await writeConfigJson(env, "custom_quizzes_index", nextIndex);

  // 3. Clean stale name overrides & deleted_quizzes entries
  const subNames = await readConfigJson(env, "subject_name_overrides", {});
  if (subNames && Object.prototype.hasOwnProperty.call(subNames, subjectId)) {
    delete subNames[subjectId];
    await writeConfigJson(env, "subject_name_overrides", subNames);
  }
  const quizNames = await readConfigJson(env, "quiz_name_overrides", {});
  if (quizNames && typeof quizNames === "object") {
    let changed = false;
    Object.keys(quizNames).forEach(function (k) {
      if (k.indexOf(subjectId + "::") === 0) { delete quizNames[k]; changed = true; }
    });
    if (changed) await writeConfigJson(env, "quiz_name_overrides", quizNames);
  }
  const deletedQuizzes = await readConfigJson(env, "deleted_quizzes", []);
  if (Array.isArray(deletedQuizzes)) {
    await writeConfigJson(env, "deleted_quizzes", deletedQuizzes.filter(function (k) { return String(k).indexOf(subjectId + "::") !== 0; }));
  }
  const hiddenQuizzes = await readConfigJson(env, "hidden_quizzes", []);
  if (Array.isArray(hiddenQuizzes)) {
    await writeConfigJson(env, "hidden_quizzes", hiddenQuizzes.filter(function (k) { return String(k).indexOf(subjectId + "::") !== 0; }));
  }
  const qImagesAll = await readConfigJson(env, "quiz_question_images", {});
  if (qImagesAll && typeof qImagesAll === "object") {
    let imgMapChanged = false;
    Object.keys(qImagesAll).forEach(function (k) {
      if (k.indexOf(subjectId + "::") === 0) { delete qImagesAll[k]; imgMapChanged = true; }
    });
    if (imgMapChanged) await writeConfigJson(env, "quiz_question_images", qImagesAll);
  }
  const quizImgIndex = await readConfigJson(env, "quiz_images_index", {});
  if (quizImgIndex && typeof quizImgIndex === "object") {
    let idxChanged = false;
    const imgPrefix = "quiz-images/" + subjectId + "/";
    const keys = Object.keys(quizImgIndex);
    for (let k = 0; k < keys.length; k += 1) {
      const r2Key = keys[k];
      if (r2Key.indexOf(imgPrefix) === 0 || (quizImgIndex[r2Key] && quizImgIndex[r2Key].subjectId === subjectId)) {
        if (env.FILES) await env.FILES.delete(r2Key).catch(function () {});
        delete quizImgIndex[r2Key];
        idxChanged = true;
      }
    }
    if (idxChanged) await writeConfigJson(env, "quiz_images_index", quizImgIndex);
  }

  // 4. Hard-delete all uploaded PDFs for this course from R2 + pdfs_meta + overlay
  const pdfRows = await env.DB.prepare("SELECT id, r2_key FROM pdfs_meta WHERE subject_id = ?1").bind(subjectId).all();
  const rows = (pdfRows && pdfRows.results) || [];
  if (env.FILES) {
    for (let i = 0; i < rows.length; i += 1) {
      if (rows[i].r2_key) await env.FILES.delete(rows[i].r2_key).catch(function () {});
    }
  }
  const overlay = await readConfigJson(env, "content_library_overrides", null);
  if (overlay && typeof overlay === "object") {
    if (Array.isArray(overlay.pdfs)) overlay.pdfs = overlay.pdfs.filter(function (p) { return !p || p.subjectId !== subjectId; });
    if (Array.isArray(overlay.videos)) overlay.videos = overlay.videos.filter(function (v) { return !v || v.subjectId !== subjectId; });
    overlay.updatedAt = new Date().toISOString();
    await writeConfigJson(env, "content_library_overrides", overlay);
  }

  await env.DB.batch([
    env.DB.prepare("DELETE FROM pdfs_meta WHERE subject_id = ?1 AND " + SQL_WRITE_FENCE_PREDICATE).bind(subjectId),
    env.DB.prepare("DELETE FROM best_scores WHERE subject_id = ?1 AND " + SQL_WRITE_FENCE_PREDICATE).bind(subjectId),
    env.DB.prepare("DELETE FROM question_reports WHERE subject_id = ?1 AND " + SQL_WRITE_FENCE_PREDICATE).bind(subjectId)
  ]);

  return jsonResponse({ ok: true, deleted: true, subjectId: subjectId });
}

async function handleAdminQuizSave(request, env) {
  const admin = await requireAdmin(request, env);
  if (!admin) return fail(401, "Admin authentication required.", "AUTH_REQUIRED");
  const parsed = await readJson(request);
  if (parsed.tooLarge) return fail(413, "Quiz payload exceeds 1 MB limit.", "TOO_LARGE");
  const clean = sanitizeCustomQuizPayload(parsed.body);
  if (!clean.ok) return fail(400, clean.error, "BAD_QUIZ");

  const compositeKey = clean.subjectId + "::" + clean.quizId;
  const isBundledQuiz = Boolean(getCollection(clean.subjectId, clean.quizId));
  const existingQuiz = await readConfigJson(env, "custom_quiz:" + compositeKey, null);
  const existingKey = await readConfigJson(env, "custom_quiz_key:" + compositeKey, null);
  if ((isBundledQuiz || existingQuiz || existingKey) && admin.kind !== "master") {
    return fail(403, "Master admin session required to overwrite an existing quiz or replace answer keys.", "FORBIDDEN");
  }
  await writeConfigJson(env, "custom_quiz:" + compositeKey, clean.quizData);
  await writeConfigJson(env, "custom_quiz_key:" + compositeKey, clean.keyData);

  const index = await readConfigJson(env, "custom_quizzes_index", {});
  const nextIndex = index && typeof index === "object" ? index : {};
  nextIndex[compositeKey] = {
    subjectId: clean.subjectId,
    quizId: clean.quizId,
    kind: clean.kind,
    title: clean.title,
    questionCount: clean.quizData.questions.length,
    gradableCount: clean.keyData.gradableQuestions,
    updatedAt: clean.quizData.updatedAt
  };
  await writeConfigJson(env, "custom_quizzes_index", nextIndex);

  const deletedQuizzes = await readConfigJson(env, "deleted_quizzes", []);
  if (Array.isArray(deletedQuizzes) && deletedQuizzes.indexOf(compositeKey) !== -1) {
    await writeConfigJson(env, "deleted_quizzes", deletedQuizzes.filter(function (k) { return k !== compositeKey; }));
  }

  return jsonResponse({ ok: true, quiz: nextIndex[compositeKey] });
}

async function handleAdminQuizDelete(request, env, url) {
  const gate = await requireMasterAdmin(request, env);
  if (!gate.ok) return gate.response;
  const frozenRes = await requireProgressWriteFenceClear(env);
  if (frozenRes) return frozenRes;
  const body = await readOptionalJsonOrParams(request, url);
  const subjectId = safeId(body.subjectId, 64);
  const quizId = safeId(body.quizId || body.id, 80);
  if (!subjectId || !quizId) return fail(400, "Valid subjectId and quizId are required.", "BAD_REQUEST");

  const compositeKey = subjectId + "::" + quizId;
  await deleteConfigKey(env, "custom_quiz:" + compositeKey);
  await deleteConfigKey(env, "custom_quiz_key:" + compositeKey);

  const index = await readConfigJson(env, "custom_quizzes_index", {});
  if (index && Object.prototype.hasOwnProperty.call(index, compositeKey)) {
    delete index[compositeKey];
    await writeConfigJson(env, "custom_quizzes_index", index);
  }

  const quizNames = await readConfigJson(env, "quiz_name_overrides", {});
  if (quizNames && Object.prototype.hasOwnProperty.call(quizNames, compositeKey)) {
    delete quizNames[compositeKey];
    await writeConfigJson(env, "quiz_name_overrides", quizNames);
  }

  if (getCollection(subjectId, quizId) || body.isBundled === true || body.isBundled === "1") {
    const deletedQuizzes = await readConfigJson(env, "deleted_quizzes", []);
    const nextDeleted = Array.isArray(deletedQuizzes) ? deletedQuizzes.slice() : [];
    if (nextDeleted.indexOf(compositeKey) === -1) nextDeleted.push(compositeKey);
    await writeConfigJson(env, "deleted_quizzes", nextDeleted);
  }

  const hiddenQuizzes = await readConfigJson(env, "hidden_quizzes", []);
  if (Array.isArray(hiddenQuizzes) && hiddenQuizzes.indexOf(compositeKey) !== -1) {
    await writeConfigJson(env, "hidden_quizzes", hiddenQuizzes.filter(function (k) { return k !== compositeKey; }));
  }
  const qImagesAll = await readConfigJson(env, "quiz_question_images", {});
  if (qImagesAll && Object.prototype.hasOwnProperty.call(qImagesAll, compositeKey)) {
    delete qImagesAll[compositeKey];
    await writeConfigJson(env, "quiz_question_images", qImagesAll);
  }

  await env.DB.batch([
    env.DB.prepare("DELETE FROM best_scores WHERE subject_id = ?1 AND quiz_id = ?2 AND " + SQL_WRITE_FENCE_PREDICATE).bind(subjectId, quizId),
    env.DB.prepare("DELETE FROM question_reports WHERE subject_id = ?1 AND quiz_id = ?2 AND " + SQL_WRITE_FENCE_PREDICATE).bind(subjectId, quizId)
  ]);

  return jsonResponse({ ok: true, deleted: true, subjectId, quizId });
}

async function inspectQuizForDeletion(env, subjectId, quizId) {
  const compositeKey = subjectId + "::" + quizId;
  const cfg = await readConfigJsonBatch(env, [
    "custom_quiz:" + compositeKey,
    "custom_quiz_key:" + compositeKey,
    "custom_quizzes_index",
    "quiz_name_overrides",
    "deleted_quizzes",
    "hidden_quizzes",
    "quiz_question_images"
  ]);
  const customQuiz = cfg["custom_quiz:" + compositeKey] || null;
  const customKey = cfg["custom_quiz_key:" + compositeKey] || null;
  const customIndex = (cfg.custom_quizzes_index && typeof cfg.custom_quizzes_index === "object") ? cfg.custom_quizzes_index : {};
  const quizNames = (cfg.quiz_name_overrides && typeof cfg.quiz_name_overrides === "object") ? cfg.quiz_name_overrides : {};
  const deletedQuizzes = Array.isArray(cfg.deleted_quizzes) ? cfg.deleted_quizzes : [];
  const hiddenQuizzes = Array.isArray(cfg.hidden_quizzes) ? cfg.hidden_quizzes : [];
  const qImagesAll = (cfg.quiz_question_images && typeof cfg.quiz_question_images === "object") ? cfg.quiz_question_images : {};

  const bundledCol = getCollection(subjectId, quizId);
  const hasCustom = Boolean(customQuiz || customKey || Object.prototype.hasOwnProperty.call(customIndex, compositeKey));
  const isBundled = Boolean(bundledCol);
  const storageType = isBundled
    ? (hasCustom ? "bundled_with_override" : "bundled_static")
    : (hasCustom ? "custom_d1" : "not_found");
  const alreadyDeleted = deletedQuizzes.indexOf(compositeKey) !== -1 && !hasCustom;
  const isHidden = hiddenQuizzes.indexOf(compositeKey) !== -1;

  const attemptsRow = await env.DB.prepare("SELECT COUNT(*) AS n FROM quiz_attempts WHERE subject_id = ?1 AND quiz_id = ?2").bind(subjectId, quizId).first();
  const scoresRow = await env.DB.prepare("SELECT COUNT(*) AS n FROM best_scores WHERE subject_id = ?1 AND quiz_id = ?2").bind(subjectId, quizId).first();
  const reportsRow = await env.DB.prepare("SELECT COUNT(*) AS n FROM question_reports WHERE subject_id = ?1 AND quiz_id = ?2").bind(subjectId, quizId).first();

  const indexMeta = customIndex[compositeKey] || null;
  const title = (typeof quizNames[compositeKey] === "string" && quizNames[compositeKey])
    || (indexMeta && indexMeta.title)
    || (customQuiz && customQuiz.title)
    || quizId;
  const questionCount = (customQuiz && Array.isArray(customQuiz.questions) && customQuiz.questions.length)
    || (indexMeta && Number(indexMeta.questionCount))
    || (bundledCol && bundledCol.answers ? Object.keys(bundledCol.answers).length + ((bundledCol.ungradableIds && bundledCol.ungradableIds.length) || 0) : 0);

  return {
    compositeKey,
    subjectId,
    quizId,
    title,
    storageType,
    isBundled,
    hasCustom,
    exists: storageType !== "not_found" && !alreadyDeleted,
    alreadyDeleted,
    isHidden,
    questionCount,
    customQuiz,
    customKey,
    bundledCol,
    customIndex,
    quizNames,
    deletedQuizzes,
    hiddenQuizzes,
    qImagesAll,
    counts: {
      quizAttempts: Number(attemptsRow && attemptsRow.n) || 0,
      bestScores: Number(scoresRow && scoresRow.n) || 0,
      questionReports: Number(reportsRow && reportsRow.n) || 0
    }
  };
}

async function handleAdminQuizDeletePreview(request, env, url) {
  const gate = await requireMasterAdmin(request, env);
  if (!gate.ok) return gate.response;
  const subjectId = safeId(url.searchParams.get("subjectId"), 64);
  const quizId = safeId(url.searchParams.get("quizId") || url.searchParams.get("id"), 80);
  if (!subjectId || !quizId || subjectId.includes("*") || quizId.includes("*")) {
    return fail(400, "Exact subjectId and quizId are required.", "BAD_REQUEST");
  }
  const info = await inspectQuizForDeletion(env, subjectId, quizId);
  return jsonResponse({
    ok: true,
    preview: {
      subjectId: info.subjectId,
      quizId: info.quizId,
      title: info.title,
      storageType: info.storageType,
      exists: info.exists,
      alreadyDeleted: info.alreadyDeleted,
      isHidden: info.isHidden,
      questionCount: info.questionCount,
      requiredConfirmation: "DELETE " + info.quizId,
      willDelete: {
        authoritativeContent: info.hasCustom ? "D1 custom quiz record (custom_quiz)" : (info.isBundled ? "Authoritative removal tombstone (deleted_quizzes) blocking bundled quiz delivery & grading" : "None"),
        answerKey: Boolean(info.customKey || info.isBundled),
        customIndexEntry: Object.prototype.hasOwnProperty.call(info.customIndex, info.compositeKey),
        nameOverride: Object.prototype.hasOwnProperty.call(info.quizNames, info.compositeKey),
        questionImages: Object.prototype.hasOwnProperty.call(info.qImagesAll, info.compositeKey),
        hiddenFlag: info.isHidden,
        openReportsCount: info.counts.questionReports
      },
      willPreserve: {
        studentIdentities: true,
        quizAttemptsCount: info.counts.quizAttempts,
        bestScoresCount: info.counts.bestScores
      },
      staticAssetNote: info.isBundled
        ? "This quiz is bundled in deployed static JSON assets. Runtime permanent deletion immediately blocks student delivery, feedback, and grading via D1 tombstone and removes all D1 overrides/reports. To also strip its source from the static bundle, run: node tools/remove-bundled-quiz.js " + info.subjectId + " " + info.quizId + " and redeploy."
        : null
    }
  });
}

async function handleAdminQuizExport(request, env, url) {
  const gate = await requireMasterAdmin(request, env);
  if (!gate.ok) return gate.response;
  const subjectId = safeId(url.searchParams.get("subjectId"), 64);
  const quizId = safeId(url.searchParams.get("quizId") || url.searchParams.get("id"), 80);
  if (!subjectId || !quizId) return fail(400, "Valid subjectId and quizId are required.", "BAD_REQUEST");
  const info = await inspectQuizForDeletion(env, subjectId, quizId);
  if (!info.exists && !info.hasCustom && !info.isBundled) {
    return fail(404, "Quiz not found for backup export.", "NOT_FOUND");
  }
  const bundledAnswerEntries = {};
  if (info.bundledCol && info.bundledCol.answers) {
    for (const qid of Object.keys(info.bundledCol.answers)) {
      bundledAnswerEntries[qid] = {
        correctOptionId: info.bundledCol.answers[qid],
        explanation: bundledExplanations[qid] || null
      };
    }
  }
  const payload = {
    schemaVersion: "elgo-quiz-backup-v1",
    exportedAt: new Date().toISOString(),
    subjectId: info.subjectId,
    quizId: info.quizId,
    title: info.title,
    storageType: info.storageType,
    isHidden: info.isHidden,
    customQuiz: info.customQuiz,
    customAnswerKey: info.customKey,
    bundledAnswerKey: info.isBundled ? {
      answers: bundledAnswerEntries,
      ungradableIds: info.bundledCol.ungradableIds || []
    } : null,
    nameOverride: info.quizNames[info.compositeKey] || null,
    questionImages: info.qImagesAll[info.compositeKey] || null,
    dependentRecords: info.counts
  };
  const safeFile = ("quiz-backup-" + subjectId + "-" + quizId).replace(/[^A-Za-z0-9._-]+/g, "_") + ".json";
  return new Response(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="' + safeFile + '"',
      "Cache-Control": "no-store"
    }
  });
}

async function handleAdminQuizPermanentDelete(request, env) {
  const gate = await requireMasterAdmin(request, env);
  if (!gate.ok) return gate.response;
  const frozenRes = await requireProgressWriteFenceClear(env);
  if (frozenRes) return frozenRes;
  const parsed = await readJson(request);
  if (parsed.tooLarge) return fail(413, "Request too large.", "TOO_LARGE");
  const body = parsed.body || {};
  const subjectId = safeId(body.subjectId, 64);
  const quizId = safeId(body.quizId || body.id, 80);
  if (!subjectId || !quizId || subjectId.includes("*") || quizId.includes("*")) {
    return fail(400, "Exact subjectId and quizId are required.", "BAD_REQUEST");
  }
  const expectedPhrase = "DELETE " + quizId;
  if (body.confirmPermanent !== true || String(body.confirmText || "").trim() !== expectedPhrase) {
    return fail(400, 'Explicit confirmation required. Type "' + expectedPhrase + '" to permanently delete this quiz.', "CONFIRMATION_REQUIRED");
  }

  const info = await inspectQuizForDeletion(env, subjectId, quizId);
  if (!info.exists && !info.hasCustom && !info.isBundled) {
    return fail(404, "Quiz not found.", "NOT_FOUND");
  }

  const upsertCfgStmt = (key, val) => env.DB.prepare(
    "INSERT INTO admin_config (config_key, config_json, updated_at) SELECT ?1, ?2, datetime('now') WHERE " + SQL_WRITE_FENCE_PREDICATE +
    " ON CONFLICT(config_key) DO UPDATE SET config_json = excluded.config_json, updated_at = datetime('now')"
  ).bind(key, JSON.stringify(val));

  const statements = [
    env.DB.prepare("DELETE FROM admin_config WHERE config_key = ?1 AND " + SQL_WRITE_FENCE_PREDICATE).bind("custom_quiz:" + info.compositeKey),
    env.DB.prepare("DELETE FROM admin_config WHERE config_key = ?1 AND " + SQL_WRITE_FENCE_PREDICATE).bind("custom_quiz_key:" + info.compositeKey)
  ];

  if (Object.prototype.hasOwnProperty.call(info.customIndex, info.compositeKey)) {
    const nextIndex = Object.assign({}, info.customIndex);
    delete nextIndex[info.compositeKey];
    statements.push(upsertCfgStmt("custom_quizzes_index", nextIndex));
  }
  if (Object.prototype.hasOwnProperty.call(info.quizNames, info.compositeKey)) {
    const nextNames = Object.assign({}, info.quizNames);
    delete nextNames[info.compositeKey];
    statements.push(upsertCfgStmt("quiz_name_overrides", nextNames));
  }
  if (info.isBundled || body.isBundled === true || body.isBundled === "1") {
    const nextDeleted = info.deletedQuizzes.slice();
    if (nextDeleted.indexOf(info.compositeKey) === -1) nextDeleted.push(info.compositeKey);
    statements.push(upsertCfgStmt("deleted_quizzes", nextDeleted));
  }
  if (info.isHidden) {
    const nextHidden = info.hiddenQuizzes.filter((k) => k !== info.compositeKey);
    statements.push(upsertCfgStmt("hidden_quizzes", nextHidden));
  }
  if (Object.prototype.hasOwnProperty.call(info.qImagesAll, info.compositeKey)) {
    const nextImages = Object.assign({}, info.qImagesAll);
    delete nextImages[info.compositeKey];
    statements.push(upsertCfgStmt("quiz_question_images", nextImages));
  }

  // Clean up orphaned question reports only; NEVER cascade into historical quiz_attempts or best_scores!
  statements.push(
    env.DB.prepare("DELETE FROM question_reports WHERE subject_id = ?1 AND quiz_id = ?2 AND " + SQL_WRITE_FENCE_PREDICATE).bind(subjectId, quizId)
  );

  // Record minimal administrative audit trail (capped rolling log of last 100 deletions)
  const existingAudit = await readConfigJson(env, "admin_quiz_delete_audit", []);
  const auditEntry = {
    deletedAt: new Date().toISOString(),
    subjectId: info.subjectId,
    quizId: info.quizId,
    title: info.title,
    storageType: info.storageType,
    actorKind: "master",
    backupExported: Boolean(body.backupExported),
    preservedAttempts: info.counts.quizAttempts,
    preservedBestScores: info.counts.bestScores,
    clearedReports: info.counts.questionReports
  };
  const nextAudit = (Array.isArray(existingAudit) ? existingAudit.slice(-99) : []).concat([auditEntry]);
  statements.push(upsertCfgStmt("admin_quiz_delete_audit", nextAudit));

  await env.DB.batch(statements);

  return jsonResponse({
    ok: true,
    permanentlyDeleted: true,
    subjectId: info.subjectId,
    quizId: info.quizId,
    storageType: info.storageType,
    preserved: {
      quizAttempts: info.counts.quizAttempts,
      bestScores: info.counts.bestScores
    },
    audit: auditEntry
  });
}

async function handleAdminQuizVisibility(request, env) {
  if (!(await requireAdmin(request, env))) return fail(401, "Admin authentication required.", "AUTH_REQUIRED");
  const parsed = await readJson(request);
  if (parsed.tooLarge) return fail(413, "Request too large.", "TOO_LARGE");
  const body = parsed.body || {};
  const subjectId = safeId(body.subjectId, 64);
  const quizId = safeId(body.quizId || body.id, 80);
  if (!subjectId || !quizId) return fail(400, "Valid subjectId and quizId are required.", "BAD_REQUEST");

  const compositeKey = subjectId + "::" + quizId;
  const hiddenQuizzes = await readConfigJson(env, "hidden_quizzes", []);
  const baseList = Array.isArray(hiddenQuizzes) ? hiddenQuizzes.filter(Boolean) : [];
  const hasExplicit = typeof body.hidden === "boolean" || body.hidden === 0 || body.hidden === 1 || body.hidden === "0" || body.hidden === "1" || body.hidden === "true" || body.hidden === "false";
  const currentHidden = baseList.indexOf(compositeKey) !== -1;
  const shouldHide = hasExplicit
    ? (body.hidden === true || body.hidden === 1 || body.hidden === "1" || body.hidden === "true")
    : !currentHidden;

  const nextHidden = baseList.filter(function (k) { return k !== compositeKey; });
  if (shouldHide) nextHidden.push(compositeKey);
  await writeConfigJson(env, "hidden_quizzes", nextHidden);

  return jsonResponse({
    ok: true,
    hidden: shouldHide,
    subjectId: subjectId,
    quizId: quizId,
    hiddenQuizKeys: nextHidden
  });
}

async function handleAdminQuizImagesSave(request, env) {
  const admin = await requireAdmin(request, env);
  if (!admin) return fail(401, "Admin authentication required.", "AUTH_REQUIRED");
  const parsed = await readJson(request);
  if (parsed.tooLarge) return fail(413, "Request exceeds 1 MB limit.", "TOO_LARGE");
  const body = parsed.body || {};
  const subjectId = safeId(body.subjectId, 64);
  const quizId = safeId(body.quizId || body.id, 80);
  if (!subjectId || !quizId) return fail(400, "Valid subjectId and quizId are required.", "BAD_REQUEST");

  const rawMap = body.imagesByQuestionId;
  if (!rawMap || typeof rawMap !== "object" || Array.isArray(rawMap)) {
    return fail(400, "imagesByQuestionId map is required.", "BAD_REQUEST");
  }

  const qKeys = Object.keys(rawMap);
  if (qKeys.length > 500) {
    return fail(400, "Maximum 500 question image entries per quiz.", "BAD_REQUEST");
  }

  const cleanEntry = {};
  for (let i = 0; i < qKeys.length; i += 1) {
    const qId = safeId(qKeys[i], 80);
    if (!qId) continue;
    const rawVal = rawMap[qKeys[i]];
    if (!Array.isArray(rawVal) && (!rawVal || typeof rawVal !== "object")) {
      return fail(400, "Question " + qId + " images must be an array.", "BAD_IMAGE");
    }
    const candidate = Array.isArray(rawVal) ? { images: rawVal } : rawVal;
    const check = normalizeQuestionImageList(candidate);
    if (!check.ok) {
      return fail(400, "Question " + qId + ": " + check.error, "BAD_IMAGE");
    }
    cleanEntry[qId] = check.images;
  }

  const compositeKey = subjectId + "::" + quizId;
  const allMaps = await readConfigJson(env, "quiz_question_images", {});
  const nextAll = allMaps && typeof allMaps === "object" && !Array.isArray(allMaps) ? Object.assign({}, allMaps) : {};
  if (admin.kind !== "master") {
    const existingQuizMap = (nextAll[compositeKey] && typeof nextAll[compositeKey] === "object" && !Array.isArray(nextAll[compositeKey]))
      ? nextAll[compositeKey]
      : {};
    const existingQIds = Object.keys(existingQuizMap);
    for (let eIdx = 0; eIdx < existingQIds.length; eIdx += 1) {
      const qId = existingQIds[eIdx];
      const prevImgs = Array.isArray(existingQuizMap[qId]) ? existingQuizMap[qId] : [];
      const prevUrls = prevImgs.map(function (img) { return img && img.url; }).filter(Boolean);
      if (!prevUrls.length) continue;
      if (!Object.prototype.hasOwnProperty.call(cleanEntry, qId)) {
        return fail(403, "Master admin session required to remove existing quiz images.", "FORBIDDEN");
      }
      const nextUrls = new Set((cleanEntry[qId] || []).map(function (img) { return img && img.url; }).filter(Boolean));
      for (let uIdx = 0; uIdx < prevUrls.length; uIdx += 1) {
        if (!nextUrls.has(prevUrls[uIdx])) {
          return fail(403, "Master admin session required to remove or replace existing quiz images.", "FORBIDDEN");
        }
      }
    }
  }
  if (Object.keys(cleanEntry).length === 0) {
    delete nextAll[compositeKey];
  } else {
    nextAll[compositeKey] = cleanEntry;
  }
  await writeConfigJson(env, "quiz_question_images", nextAll);

  return jsonResponse({
    ok: true,
    subjectId: subjectId,
    quizId: quizId,
    imagesByQuestionId: cleanEntry
  });
}

async function handleAdminImageUpload(request, env, url) {
  if (!(await requireAdmin(request, env))) return fail(401, "Admin authentication required.", "AUTH_REQUIRED");
  if (!env.FILES) return fail(503, "File storage is not available.", "R2_UNBOUND");

  const declared = Number(request.headers.get("Content-Length"));
  if (!Number.isFinite(declared) || declared <= 0) return fail(411, "Content-Length is required.", "LENGTH_REQUIRED");
  if (declared > MAX_QUIZ_IMAGE_BYTES) return fail(413, "Image exceeds the " + Math.round(MAX_QUIZ_IMAGE_BYTES / 1048576) + " MB limit.", "TOO_LARGE");

  const buffer = await request.arrayBuffer();
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_QUIZ_IMAGE_BYTES) return fail(413, "Invalid image size.", "TOO_LARGE");

  const detected = detectQuizImageType(new Uint8Array(buffer));
  if (!detected) return fail(415, "Only PNG, JPEG, WebP, or GIF images are accepted.", "UNSUPPORTED_TYPE");

  const subjectId = String(url.searchParams.get("subjectId") || "general")
    .toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "general";
  const key = "quiz-images/" + subjectId + "/" + randomHex(16) + "." + detected.ext;
  await env.FILES.put(key, buffer, { httpMetadata: { contentType: detected.contentType } });

  try {
    const imgIndex = await readConfigJson(env, "quiz_images_index", {});
    const nextIdx = imgIndex && typeof imgIndex === "object" && !Array.isArray(imgIndex) ? Object.assign({}, imgIndex) : {};
    nextIdx[key] = {
      subjectId: subjectId,
      ext: detected.ext,
      contentType: detected.contentType,
      bytes: buffer.byteLength,
      uploadedAt: new Date().toISOString()
    };
    await writeConfigJson(env, "quiz_images_index", nextIdx);
  } catch (e) {
    await env.FILES.delete(key).catch(function () {});
    throw e;
  }

  return jsonResponse({
    ok: true,
    image: {
      subjectId: subjectId,
      r2Key: key,
      url: "/api/r2/" + key,
      contentType: detected.contentType,
      bytes: buffer.byteLength
    }
  });
}

async function handleAdminImageDelete(request, env, url) {
  const gate = await requireMasterAdmin(request, env);
  if (!gate.ok) return gate.response;
  const body = await readOptionalJsonOrParams(request, url);
  let r2Key = String(body.r2Key || body.key || "").trim();
  const rawUrl = String(body.url || body.path || "").trim();
  if (!r2Key && rawUrl.indexOf("/api/r2/") === 0) {
    try { r2Key = decodeURIComponent(rawUrl.slice("/api/r2/".length)); } catch (_e) { /* ignore */ }
  }
  if (!r2Key || !QUIZ_IMAGE_KEY_PATTERN.test(r2Key)) {
    return fail(400, "Valid quiz image R2 key or URL is required.", "BAD_REQUEST");
  }
  if (env.FILES) {
    await env.FILES.delete(r2Key);
  }
  const imgIndex = await readConfigJson(env, "quiz_images_index", {});
  if (imgIndex && Object.prototype.hasOwnProperty.call(imgIndex, r2Key)) {
    delete imgIndex[r2Key];
    await writeConfigJson(env, "quiz_images_index", imgIndex);
  }
  return jsonResponse({ ok: true, deleted: true, r2Key: r2Key });
}

async function handleAdminFileDelete(request, env, url) {
  const gate = await requireMasterAdmin(request, env);
  if (!gate.ok) return gate.response;
  const body = await readOptionalJsonOrParams(request, url);
  const id = safeId(body.id, 80);
  let r2Key = String(body.r2Key || body.key || "").trim();
  if (!r2Key && typeof body.path === "string" && body.path.indexOf("/api/r2/") === 0) {
    try { r2Key = decodeURIComponent(body.path.slice("/api/r2/".length)); } catch (_e) { /* ignore */ }
  }
  if (!id && (!r2Key || !PDF_KEY_PATTERN.test(r2Key))) {
    return fail(400, "Valid PDF id or R2 key is required.", "BAD_REQUEST");
  }

  let row = null;
  if (id) {
    row = await env.DB.prepare("SELECT id, r2_key FROM pdfs_meta WHERE id = ?1").bind(id).first();
  }
  if (!row && r2Key && PDF_KEY_PATTERN.test(r2Key)) {
    row = await env.DB.prepare("SELECT id, r2_key FROM pdfs_meta WHERE r2_key = ?1").bind(r2Key).first();
  }
  const targetKey = (row && row.r2_key) || (PDF_KEY_PATTERN.test(r2Key) ? r2Key : "");
  const targetId = (row && row.id) || id;

  if (env.FILES && targetKey) {
    await env.FILES.delete(targetKey);
  }
  if (targetId || targetKey) {
    await env.DB.prepare("DELETE FROM pdfs_meta WHERE id = ?1 OR r2_key = ?2").bind(targetId || "", targetKey || "").run();
  }

  return jsonResponse({ ok: true, deleted: true, id: targetId || null, r2Key: targetKey || null });
}

async function handleAdminReportDelete(request, env, url) {
  const gate = await requireMasterAdmin(request, env);
  if (!gate.ok) return gate.response;
  const body = await readOptionalJsonOrParams(request, url);
  const id = safeId(body.id, 64);
  if (!id) return fail(400, "Valid report id is required.", "BAD_REQUEST");
  const res = await env.DB.prepare("DELETE FROM question_reports WHERE id = ?1").bind(id).run();
  if (!res || !res.meta || Number(res.meta.changes) === 0) return fail(404, "Report not found.", "NOT_FOUND");
  return jsonResponse({ ok: true, deleted: true, id: id });
}

const workerExport = {
  fetch: handleApiRequest,
  handleApiRequest: handleApiRequest,
  mergeProgress: mergeProgress,
  mergeProgressWithStatus: mergeProgressWithStatus,
  sanitizeStoredProgressOnRead: sanitizeStoredProgressOnRead,
  opScopeSignature: opScopeSignature,
  parseVersionedOpId: parseVersionedOpId,
  utf8ByteLength: utf8ByteLength,
  gradeQuizSubmission: gradeQuizSubmission,
  validateUsernameServer: validateUsernameServer,
  sanitizeOverlay: sanitizeOverlay,
  sanitizeHttpUrl: sanitizeHttpUrl,
  sanitizeSiteSettings: sanitizeSiteSettings,
  computeStreakFromDates: computeStreakFromDates,
  computeBadges: computeBadges,
  verifyUserPassword: verifyUserPassword,
  hashUserPassword: hashUserPassword
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = workerExport;
}
