/**
 * Elgo Lab — Cloudflare Pages Functions / Worker API (`backend/worker.js`)
 *
 * Bindings:
 *  - env.DB                  D1 database (elgo_lab_db)
 *  - env.FILES               R2 bucket (your configured bucket)
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
  if (text.length > MAX_JSON_BODY_BYTES) return { tooLarge: true, body: {} };
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

const AUTH_IP_LIMIT = { max: 20, windowMs: 10 * 60 * 1000, lockMs: 10 * 60 * 1000 };
const AUTH_USER_LIMIT = { max: 8, windowMs: 10 * 60 * 1000, lockMs: 10 * 60 * 1000 };
const ADMIN_LIMIT = { max: 5, windowMs: 5 * 60 * 1000, lockMs: 5 * 60 * 1000 };
const GUEST_CREATE_LIMIT = { max: 40, windowMs: 10 * 60 * 1000, lockMs: 5 * 60 * 1000 };
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
function parseProgressIsoMs(val) {
  if (!val || typeof val !== "string") return 0;
  const ms = Date.parse(val);
  return Number.isFinite(ms) ? ms : 0;
}

function mergeTimestampMaps(cloudMap, localMap, maxEntries) {
  const out = {};
  const addFrom = function (src) {
    if (!src || typeof src !== "object" || Array.isArray(src)) return;
    for (const [k, v] of Object.entries(src)) {
      if (!k || typeof v !== "string") continue;
      const ms = parseProgressIsoMs(v);
      if (!ms) continue;
      if (!out[k] || ms > parseProgressIsoMs(out[k])) out[k] = v;
    }
  };
  addFrom(cloudMap);
  addFrom(localMap);
  const limit = maxEntries || 500;
  const entries = Object.entries(out);
  if (entries.length <= limit) return out;
  entries.sort(function (a, b) { return parseProgressIsoMs(b[1]) - parseProgressIsoMs(a[1]); });
  const trimmed = {};
  for (let i = 0; i < limit; i++) trimmed[entries[i][0]] = entries[i][1];
  return trimmed;
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

function mergeMistakePair(prev, next) {
  const newer = progressMistakeTimestampMs(prev) > progressMistakeTimestampMs(next) ? prev : next;
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

function mergeProgress(localProgress, cloudProgress) {
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

  const deletedBookmarks = mergeTimestampMaps(cloud.deletedBookmarks, local.deletedBookmarks, 500);
  const bookmarkMap = new Map();
  const cloudBookmarks = Array.isArray(cloud.bookmarks) ? cloud.bookmarks : [];
  const localBookmarks = Array.isArray(local.bookmarks) ? local.bookmarks : [];
  // Process local before cloud for recency order while letting newer timestamps win on conflicts.
  localBookmarks.concat(cloudBookmarks).forEach(function (item) {
    if (!item || typeof item !== "object") return;
    const id = progressBookmarkIdentity(item);
    if (!id) return;
    if (!bookmarkMap.has(id)) {
      bookmarkMap.set(id, item);
      return;
    }
    const prev = bookmarkMap.get(id);
    const newer = parseProgressIsoMs(item.savedAt) > parseProgressIsoMs(prev.savedAt) ? item : prev;
    const older = newer === item ? prev : item;
    const combined = Object.assign({}, older, newer);
    fillMissingFields(combined, older, [
      "id", "internalId", "subjectId", "subjectName", "quizId",
      "sourceLabel", "question", "image", "correctOptionId", "correctAnswer"
    ]);
    if ((!Array.isArray(combined.images) || !combined.images.length) && Array.isArray(older.images) && older.images.length) {
      combined.images = older.images;
    }
    bookmarkMap.set(id, combined);
  });
  merged.bookmarks = [];
  for (const [id, item] of bookmarkMap.entries()) {
    const savedMs = parseProgressIsoMs(item.savedAt);
    const delMs = parseProgressIsoMs(deletedBookmarks[id]);
    if (delMs > savedMs) continue;
    if (savedMs > delMs && deletedBookmarks[id]) delete deletedBookmarks[id];
    merged.bookmarks.push(item);
  }
  merged.deletedBookmarks = deletedBookmarks;

  const deletedMistakes = mergeTimestampMaps(cloud.deletedMistakes, local.deletedMistakes, 500);
  const cloudCleared = typeof cloud.mistakesClearedAt === "string" ? cloud.mistakesClearedAt : null;
  const localCleared = typeof local.mistakesClearedAt === "string" ? local.mistakesClearedAt : null;
  const mistakesClearedAt = parseProgressIsoMs(localCleared) >= parseProgressIsoMs(cloudCleared) ? (localCleared || cloudCleared) : cloudCleared;
  const clearedMs = parseProgressIsoMs(mistakesClearedAt);

  const cloudMistakes = Array.isArray(cloud.mistakes)
    ? cloud.mistakes
    : (cloud.mistakes && Array.isArray(cloud.mistakes.items) ? cloud.mistakes.items : []);
  const localMistakes = Array.isArray(local.mistakes)
    ? local.mistakes
    : (local.mistakes && Array.isArray(local.mistakes.items) ? local.mistakes.items : []);
  const mistakeMap = new Map();
  localMistakes.concat(cloudMistakes).forEach(function (item) {
    if (!item || typeof item !== "object") return;
    const id = progressMistakeIdentity(item);
    if (!id) return;
    if (!mistakeMap.has(id)) {
      mistakeMap.set(id, Object.assign({}, item));
    } else {
      mistakeMap.set(id, mergeMistakePair(mistakeMap.get(id), item));
    }
  });
  const mergedMistakeItems = [];
  for (const [id, item] of mistakeMap.entries()) {
    const itemMs = progressMistakeTimestampMs(item);
    const delItemMs = parseProgressIsoMs(deletedMistakes[id]);
    const effectiveDelMs = Math.max(delItemMs, clearedMs);
    if (effectiveDelMs > itemMs) continue;
    if (itemMs > delItemMs && deletedMistakes[id]) delete deletedMistakes[id];
    mergedMistakeItems.push(item);
  }
  const cloudMistakesObj = cloud.mistakes && !Array.isArray(cloud.mistakes) && typeof cloud.mistakes === "object" ? cloud.mistakes : {};
  const localMistakesObj = local.mistakes && !Array.isArray(local.mistakes) && typeof local.mistakes === "object" ? local.mistakes : {};
  merged.mistakes = Object.assign({}, cloudMistakesObj, localMistakesObj, {
    schemaVersion: 2,
    items: mergedMistakeItems
  });
  merged.deletedMistakes = deletedMistakes;
  if (mistakesClearedAt) merged.mistakesClearedAt = mistakesClearedAt;

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
  return merged;
}

function boundedProgress(progress) {
  const obj = progress && typeof progress === "object" && !Array.isArray(progress) ? progress : {};
  try {
    return JSON.stringify(obj).length <= MAX_PROGRESS_BYTES ? obj : {};
  } catch (_e) {
    return {};
  }
}

async function saveProgress(env, studentId, progress) {
  const json = JSON.stringify(progress);
  if (json.length > MAX_PROGRESS_BYTES) return false;
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET progress_json = ?1, updated_at = datetime('now') WHERE student_id = ?2").bind(json, studentId),
    env.DB.prepare(
      "INSERT INTO student_progress (student_id, bookmarks_json, mistakes_json, completed_lectures_json, updated_at) VALUES (?1, ?2, ?3, ?4, datetime('now')) " +
      "ON CONFLICT(student_id) DO UPDATE SET bookmarks_json = ?2, mistakes_json = ?3, completed_lectures_json = ?4, updated_at = datetime('now')"
    ).bind(studentId, JSON.stringify(progress.bookmarks || []), JSON.stringify(progress.mistakes || {}), JSON.stringify(progress.lectureStats || {}))
  ]);
  return true;
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
  await removeOnlineUser(env, studentId);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM user_sessions WHERE student_id = ?1").bind(studentId),
    env.DB.prepare("DELETE FROM student_progress WHERE student_id = ?1").bind(studentId),
    env.DB.prepare("DELETE FROM best_scores WHERE student_id = ?1").bind(studentId),
    env.DB.prepare("DELETE FROM quiz_attempts WHERE student_id = ?1").bind(studentId),
    env.DB.prepare("DELETE FROM users WHERE student_id = ?1").bind(studentId)
  ]);
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
  if (JSON.stringify(overlay).length > MAX_OVERLAY_BYTES) return { ok: false, error: "Content library is too large." };
  return { ok: true, overlay: overlay };
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
      const userRow = await env.DB.prepare("SELECT progress_json FROM users WHERE student_id = ?1").bind(session.studentId).first();
      progress = JSON.parse((userRow && userRow.progress_json) || "{}");
    } catch (_e) { /* ignore missing or malformed progress */ }
    return jsonResponse({ ok: true, profile: { studentId: session.studentId, username: session.username, isAdmin: session.isAdmin, guest: session.guest, stats: stats, progress: progress } });
  }

  if (pathname === "/api/auth/sync-progress" && method === "POST") {
    const session = await getUserSession(request, env);
    if (!session) return fail(401, "Authentication required.", "AUTH_REQUIRED");
    const parsed = await readJson(request);
    if (parsed.tooLarge) return fail(413, "Request too large.", "TOO_LARGE");
    if (parsed.invalid) return fail(400, "Invalid JSON payload.", "BAD_REQUEST");
    const rawProgress = parsed.body && parsed.body.progress;
    if (rawProgress && typeof rawProgress === "object" && !Array.isArray(rawProgress)) {
      let rawSize = 0;
      try { rawSize = JSON.stringify(rawProgress).length; } catch (_e) { return fail(400, "Invalid progress payload.", "BAD_REQUEST"); }
      if (rawSize > MAX_PROGRESS_BYTES) return fail(413, "Progress data too large.", "TOO_LARGE");
    }
    const row = await env.DB.prepare("SELECT progress_json FROM users WHERE student_id = ?1").bind(session.studentId).first();
    let existing = {};
    try { existing = JSON.parse((row && row.progress_json) || "{}"); } catch (_e) { /* ignore */ }
    const merged = mergeProgress(boundedProgress(rawProgress), existing);
    if (!(await saveProgress(env, session.studentId, merged))) return fail(413, "Progress data too large.", "TOO_LARGE");
    return jsonResponse({ ok: true, progress: merged });
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
    const stats = await listOnlineUsers(env, Date.now());
    return jsonResponse(Object.assign({ ok: true, generatedAt: new Date().toISOString() }, stats));
  }

  if (pathname === "/api/admin/users" && method === "GET") {
    const admin = await requireAdmin(request, env);
    if (!admin) return fail(401, "Admin authentication required.", "AUTH_REQUIRED");
    const showAll = url.searchParams.get("all") === "1";
    const query = String(url.searchParams.get("q") || "").normalize("NFKC").trim();
    if (showAll && !query) {
      const result = await env.DB.prepare(
        "SELECT student_id AS studentId, username, display_name AS displayName, is_admin AS isAdmin, created_at AS createdAt, updated_at AS updatedAt FROM users ORDER BY username COLLATE NOCASE ASC LIMIT 201"
      ).all();
      const rows = (result && result.results) || [];
      return jsonResponse({ ok: true, users: rows.slice(0, 200), hasMore: rows.length > 200 });
    }
    if (query.length < 2) return jsonResponse({ ok: true, users: [], hasMore: false });
    if (query.length > 24) return fail(400, "Search must be 2–24 characters.", "BAD_SEARCH");
    const pattern = "%" + query.replace(/[\\%_]/g, "\\$&") + "%";
    const result = await env.DB.prepare(
      "SELECT student_id AS studentId, username, display_name AS displayName, is_admin AS isAdmin, created_at AS createdAt, updated_at AS updatedAt FROM users WHERE username LIKE ?1 ESCAPE '\\' COLLATE NOCASE ORDER BY username COLLATE NOCASE ASC LIMIT 21"
    ).bind(pattern).all();
    const rows = (result && result.results) || [];
    return jsonResponse({ ok: true, users: rows.slice(0, 20), hasMore: rows.length > 20 });
  }

  if (pathname === "/api/admin/users/role" && method === "POST") {
    if (!(await requireMaster(request, env))) return fail(403, "Master admin session required.", "FORBIDDEN");
    const parsed = await readJson(request);
    const target = await resolveTargetUser(env, parsed.body);
    if (!target) return fail(404, "User not found.", "NOT_FOUND");
    const nextAdmin = parsed.body.isAdmin === true || parsed.body.isAdmin === 1 ? 1 : 0;
    await env.DB.prepare("UPDATE users SET is_admin = ?1, updated_at = datetime('now') WHERE student_id = ?2").bind(nextAdmin, target.student_id).run();
    return jsonResponse({ ok: true, studentId: target.student_id, isAdmin: Boolean(nextAdmin) });
  }

  if (pathname === "/api/admin/users/delete" && method === "POST") {
    const admin = await requireAdmin(request, env);
    if (!admin) return fail(401, "Admin authentication required.", "AUTH_REQUIRED");
    const parsed = await readJson(request);
    const target = await resolveTargetUser(env, parsed.body);
    if (!target) return fail(404, "User not found.", "NOT_FOUND");
    if (Number(target.is_admin) === 1 && admin.kind !== "master") return fail(403, "Only the master admin can delete an admin.", "FORBIDDEN");
    await deleteUserData(env, target.student_id);
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
    if (json.length > MAX_SITE_SETTINGS_BYTES) return fail(413, "Settings too large.", "TOO_LARGE");
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
    return jsonResponse({
      ok: true,
      d1Bound: true,
      r2Bound: Boolean(env.FILES),
      storageMode: env.STORAGE_MODE || "cloudflare-d1-r2",
      adminSecretConfigured: Boolean(env.ADMIN_PASSWORD || env.ADMIN_PASSWORD_HASH),
      schema: { bestScoresValidatedColumn: names.indexOf("validated_by_server") !== -1 }
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

async function listOnlineUsers(env, now) {
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
    return {
      studentId: String(u.studentId || ""),
      username: String(u.username || ""),
      displayName: String(u.displayName || u.username || ""),
      isGuest: Boolean(Number(u.isGuest)),
      isAdmin: Boolean(Number(u.isAdmin)),
      currentArea: sanitizePresenceArea(u.currentArea),
      lastSeen: seen,
      idleSeconds: Math.max(0, Math.round((ts - seen) / 1000)),
    };
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
  if (studentId) return env.DB.prepare("SELECT student_id, username, is_admin FROM users WHERE student_id = ?1").bind(studentId).first();
  if (username) return env.DB.prepare("SELECT student_id, username, is_admin FROM users WHERE username = ?1").bind(username).first();
  return null;
}

function profileResponse(user, token, progress) {
  return {
    ok: true,
    token: token.token,
    expiresAt: token.expiresAt,
    profile: {
      studentId: user.student_id,
      username: user.username,
      displayName: user.display_name || user.username,
      isAdmin: Number(user.is_admin) === 1,
      guest: String(user.student_id).startsWith("gst_") && !user.password_hash,
      progress: progress
    }
  };
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
  const parsed = await readJson(request);
  if (parsed.tooLarge) return fail(413, "Request too large.", "TOO_LARGE");
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
  const progress = mergeProgress(boundedProgress(parsed.body.progress), {});
  try {
    await env.DB.prepare("INSERT INTO users (student_id, username, display_name, username_change_count, password_hash, is_admin, progress_json) VALUES (?1, ?2, ?3, 0, ?4, 0, ?5)")
      .bind(studentId, check.username, check.username, "", JSON.stringify(progress)).run();
  } catch (_) { return fail(409, "That username is already taken.", "USERNAME_TAKEN"); }
  await saveProgress(env, studentId, progress);
  const token = await createUserSession(env, studentId);
  await touchOnlineUser(env, { studentId, username: check.username, displayName: check.username, isGuest: true, isAdmin: false }, now, "");
  return jsonResponse(profileResponse({student_id:studentId,username:check.username,is_admin:0},token,progress));
}
async function handleGuestUpgrade(request, env) {
  const session = await getUserSession(request, env);
  if (!session) return fail(401, "Authentication required.", "AUTH_REQUIRED");
  const parsed = await readJson(request);
  if (parsed.tooLarge) return fail(413, "Request too large.", "TOO_LARGE");
  const password = typeof parsed.body.password === "string" ? parsed.body.password : "";
  if (password.length < MIN_PASSWORD_LENGTH_NEW || password.length > 200) return fail(400, "Choose a password with at least " + MIN_PASSWORD_LENGTH_NEW + " characters.", "BAD_PASSWORD");
  const user = await env.DB.prepare("SELECT student_id, username, display_name, password_hash, is_admin, progress_json FROM users WHERE student_id = ?1").bind(session.studentId).first();
  if (!user || !String(user.student_id).startsWith("gst_") || user.password_hash) return fail(409, "This account already has a password.", "ALREADY_SECURED");
  const throttled = await authThrottle(env, request, "");if (throttled) return throttled;
  const hash = await hashUserPassword(password);
  const updated = await env.DB.prepare("UPDATE users SET password_hash = ?1, updated_at = datetime('now') WHERE student_id = ?2 AND (password_hash IS NULL OR password_hash = '')").bind(hash, session.studentId).run();
  if (!updated.meta || updated.meta.changes !== 1) return fail(409, "The account was already secured.", "ALREADY_SECURED");
  let cloud = {};try {cloud = JSON.parse(user.progress_json || "{}");}catch(_){}
  const progress = mergeProgress(boundedProgress(parsed.body.progress), cloud);await saveProgress(env, session.studentId, progress);
  user.password_hash = hash;
  await touchOnlineUser(env, { studentId: session.studentId, username: user.username, displayName: user.display_name || user.username, isGuest: false, isAdmin: Number(user.is_admin) === 1 }, Date.now(), "");
  return jsonResponse(profileResponse(user, await createUserSession(env, session.studentId), progress));
}

async function handleRegister(request, env) {
  const parsed = await readJson(request);
  if (parsed.tooLarge) return fail(413, "Request too large.", "TOO_LARGE");
  const body = parsed.body;
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
  const progress = mergeProgress(boundedProgress(body.progress), {});
  const hash = await hashUserPassword(password);
  try {
    await env.DB.prepare(
      "INSERT INTO users (student_id, username, display_name, username_change_count, password_hash, is_admin, progress_json) VALUES (?1, ?2, ?3, 0, ?4, 0, ?5)"
    ).bind(studentId, check.username, check.username, hash, JSON.stringify(progress)).run();
  } catch (_e) {
    return fail(409, "That username is already taken.", "USERNAME_TAKEN");
  }
  await saveProgress(env, studentId, progress);
  const token = await createUserSession(env, studentId);
  await touchOnlineUser(env, { studentId, username: check.username, displayName: check.username, isGuest: false, isAdmin: false }, Date.now(), "");
  return jsonResponse(profileResponse({ student_id: studentId, username: check.username, display_name: check.username, is_admin: 0 }, token, progress));
}

async function handleLogin(request, env) {
  const parsed = await readJson(request);
  if (parsed.tooLarge) return fail(413, "Request too large.", "TOO_LARGE");
  const body = parsed.body;
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
    // A password is NEVER created by whoever logs in first. Legacy accounts must be claimed.
    return fail(409, "This account has no password yet. Claim it from the device where you first used this username.", "ACCOUNT_NEEDS_CLAIM");
  }
  const verified = await verifyUserPassword(password, user.password_hash);
  if (!verified.ok) {
    await authFailure(env, request, key);
    return fail(401, "Incorrect username or password.", "BAD_CREDENTIALS");
  }
  await rateClear(env, "auth:user:" + key);
  if (verified.needsRehash) {
    const upgraded = await hashUserPassword(password);
    await env.DB.prepare("UPDATE users SET password_hash = ?1, updated_at = datetime('now') WHERE student_id = ?2").bind(upgraded, user.student_id).run();
  }
  let cloud = {};
  try { cloud = JSON.parse(user.progress_json || "{}"); } catch (_e) { /* ignore */ }
  const merged = mergeProgress(boundedProgress(body.progress), cloud);
  await saveProgress(env, user.student_id, merged);
  const token = await createUserSession(env, user.student_id);
  await touchOnlineUser(env, { studentId: user.student_id, username: user.username, displayName: user.display_name || user.username, isGuest: false, isAdmin: Number(user.is_admin) === 1 }, Date.now(), "");
  return jsonResponse(profileResponse(user, token, merged));
}

/** Legacy password-less accounts: the device that created the account holds the secret studentId. */
async function handleClaim(request, env) {
  const parsed = await readJson(request);
  const body = parsed.body;
  const studentId = safeId(body.studentId, 120);
  if (studentId.startsWith("gst_")) return fail(403, "Use the authenticated account upgrade on your original device.", "FORBIDDEN");
  const check = validateUsernameServer(body.username);
  const password = typeof body.password === "string" ? body.password : "";
  if (!studentId || !check.ok) return fail(400, "studentId and username are required.", "BAD_REQUEST");
  if (password.length < MIN_PASSWORD_LENGTH_NEW || password.length > 200) {
    return fail(400, "Password must be " + MIN_PASSWORD_LENGTH_NEW + "–200 characters.", "BAD_PASSWORD");
  }
  const throttled = await authThrottle(env, request, "claim:" + check.username.toLowerCase());
  if (throttled) return throttled;

  const user = await env.DB.prepare(
    "SELECT student_id, username, display_name, is_admin, progress_json FROM users WHERE student_id = ?1 AND username = ?2 AND password_hash = ''"
  ).bind(studentId, check.username).first();
  if (!user) {
    await authFailure(env, request, "claim:" + check.username.toLowerCase());
    return fail(404, "No claimable account matches.", "NOT_CLAIMABLE");
  }
  const hash = await hashUserPassword(password);
  // Atomic: succeeds only while the password is still empty.
  const result = await env.DB.prepare(
    "UPDATE users SET password_hash = ?1, updated_at = datetime('now') WHERE student_id = ?2 AND password_hash = ''"
  ).bind(hash, studentId).run();
  if (!result || !result.meta || Number(result.meta.changes) !== 1) return fail(409, "Account was already claimed.", "ALREADY_CLAIMED");
  let cloud = {};
  try { cloud = JSON.parse(user.progress_json || "{}"); } catch (_e) { /* ignore */ }
  const merged = mergeProgress(boundedProgress(body.progress), cloud);
  await saveProgress(env, studentId, merged);
  const token = await createUserSession(env, studentId);
  await touchOnlineUser(env, { studentId: studentId, username: user.username, displayName: user.display_name || user.username, isGuest: false, isAdmin: Number(user.is_admin) === 1 }, Date.now(), "");
  return jsonResponse(profileResponse(user, token, merged));
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
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET username = ?1, display_name = ?1, username_change_count = ?2, updated_at = datetime('now') WHERE student_id = ?3").bind(check.username, nextCount, session.studentId),
      env.DB.prepare("UPDATE best_scores SET username = ?1, updated_at = datetime('now') WHERE student_id = ?2").bind(check.username, session.studentId)
    ]);
  } catch (_e) {
    return fail(409, "Username is already taken by another student.", "USERNAME_TAKEN");
  }
  await touchOnlineUser(env, { studentId: session.studentId, username: check.username, displayName: check.username, isGuest: session.guest, isAdmin: session.isAdmin }, Date.now(), "");
  return jsonResponse({ ok: true, profile: { studentId: session.studentId, username: check.username, changeCount: nextCount } });
}

async function handleProfileDelete(request, env, session) {
  const parsed = await readJson(request);
  const password = typeof parsed.body.password === "string" ? parsed.body.password : "";
  const row = await env.DB.prepare("SELECT password_hash FROM users WHERE student_id = ?1").bind(session.studentId).first();
  if (!row) return fail(404, "Account not found.", "NOT_FOUND");
  const verified = row.password_hash ? await verifyUserPassword(password, row.password_hash) : { ok: false };
  if (!verified.ok) return fail(403, "Password confirmation required to delete the account.", "CONFIRM_REQUIRED");
  await deleteUserData(env, session.studentId);
  return jsonResponse({ ok: true, deleted: true });
}

// ---------------------------------------------------------------------------
// Handlers — quiz & leaderboard
// ---------------------------------------------------------------------------
async function handleQuizSubmit(request, env) {
  const session = await getUserSession(request, env);
  if (!session) return fail(401, "Log in to submit a ranked quiz.", "AUTH_REQUIRED");
  const parsed = await readJson(request);
  if (parsed.tooLarge) return fail(413, "Request too large.", "TOO_LARGE");
  const body = parsed.body;

  const attemptId = safeId(body.attemptId, 80);
  if (attemptId.length < 8) return fail(400, "A unique attemptId is required.", "BAD_REQUEST");

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
      "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 1, ?12)"
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
        "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1, 1) " +
        "ON CONFLICT(student_id, subject_id, quiz_id) DO UPDATE SET " +
        "attempts_count = CASE WHEN best_scores.validated_by_server = 0 THEN 1 ELSE best_scores.attempts_count + 1 END, " +
        "updated_at = datetime('now'), username = excluded.username, validated_by_server = 1, " +
        "quiz_title = CASE WHEN " + better + " THEN excluded.quiz_title ELSE best_scores.quiz_title END, " +
        "best_score = CASE WHEN " + better + " THEN excluded.best_score ELSE best_scores.best_score END, " +
        "total = CASE WHEN " + better + " THEN excluded.total ELSE best_scores.total END, " +
        "best_percentage = CASE WHEN " + better + " THEN excluded.best_percentage ELSE best_scores.best_percentage END, " +
        "fastest_duration_ms = CASE WHEN " + better + " THEN excluded.fastest_duration_ms ELSE best_scores.fastest_duration_ms END, " +
        "achieved_at = CASE WHEN " + better + " THEN datetime('now') ELSE best_scores.achieved_at END"
      ).bind(session.studentId, graded.subjectId, graded.quizId, session.username, quizTitle, graded.score, graded.total, graded.percentage, durationMs)
    );
  }
  try {
    await env.DB.batch(statements);
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
  const now = Date.now();
  const retry = await rateLocked(env, key, now);
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
    const state = await rateRecordFailure(env, key, now, ADMIN_LIMIT.max, ADMIN_LIMIT.windowMs, ADMIN_LIMIT.lockMs);
    return fail(401, "Invalid admin password.", "BAD_CREDENTIALS", { remainingAttempts: state.remaining });
  }
  await rateClear(env, key);
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
  if (!(await requireAdmin(request, env))) return fail(401, "Admin authentication required.", "AUTH_REQUIRED");
  const parsed = await readJson(request);
  if (parsed.tooLarge) return fail(413, "Request too large.", "TOO_LARGE");
  const body = parsed.body;
  const result = sanitizeOverlay(body.overrides);
  if (!result.ok) return fail(400, result.error, "BAD_CONTENT");
  const current = await env.DB.prepare("SELECT updated_at FROM admin_config WHERE config_key = 'content_library_overrides'").first();
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
  if (!(await requireAdmin(request, env))) return fail(401, "Admin authentication required.", "AUTH_REQUIRED");
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
    return jsonResponse({ ok: true, reports: (res && res.results) || [] });
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
        if (fullQuiz) subjectQuizzes.push(fullQuiz);
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
  if (!(await requireAdmin(request, env))) return fail(401, "Admin authentication required.", "AUTH_REQUIRED");
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
  if (!(await requireAdmin(request, env))) return fail(401, "Admin authentication required.", "AUTH_REQUIRED");
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
    env.DB.prepare("DELETE FROM pdfs_meta WHERE subject_id = ?1").bind(subjectId),
    env.DB.prepare("DELETE FROM best_scores WHERE subject_id = ?1").bind(subjectId),
    env.DB.prepare("DELETE FROM quiz_attempts WHERE subject_id = ?1").bind(subjectId),
    env.DB.prepare("DELETE FROM question_reports WHERE subject_id = ?1").bind(subjectId)
  ]);

  return jsonResponse({ ok: true, deleted: true, subjectId: subjectId });
}

async function handleAdminQuizSave(request, env) {
  if (!(await requireAdmin(request, env))) return fail(401, "Admin authentication required.", "AUTH_REQUIRED");
  const parsed = await readJson(request);
  if (parsed.tooLarge) return fail(413, "Quiz payload exceeds 1 MB limit.", "TOO_LARGE");
  const clean = sanitizeCustomQuizPayload(parsed.body);
  if (!clean.ok) return fail(400, clean.error, "BAD_QUIZ");

  const compositeKey = clean.subjectId + "::" + clean.quizId;
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
  if (!(await requireAdmin(request, env))) return fail(401, "Admin authentication required.", "AUTH_REQUIRED");
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
    env.DB.prepare("DELETE FROM best_scores WHERE subject_id = ?1 AND quiz_id = ?2").bind(subjectId, quizId),
    env.DB.prepare("DELETE FROM quiz_attempts WHERE subject_id = ?1 AND quiz_id = ?2").bind(subjectId, quizId),
    env.DB.prepare("DELETE FROM question_reports WHERE subject_id = ?1 AND quiz_id = ?2").bind(subjectId, quizId)
  ]);

  return jsonResponse({ ok: true, deleted: true, subjectId, quizId });
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
  if (!(await requireAdmin(request, env))) return fail(401, "Admin authentication required.", "AUTH_REQUIRED");
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
  if (!(await requireAdmin(request, env))) return fail(401, "Admin authentication required.", "AUTH_REQUIRED");
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
  if (!(await requireAdmin(request, env))) return fail(401, "Admin authentication required.", "AUTH_REQUIRED");
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
  if (!(await requireAdmin(request, env))) return fail(401, "Admin authentication required.", "AUTH_REQUIRED");
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
