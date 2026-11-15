"use strict";
/**
 * Backend security & integrity tests (implementation phase 2026-11-10).
 *
 * Runs the REAL backend/worker.js against a REAL SQLite engine (node:sqlite) built from
 * backend/schema.sql — and, for the migration test, from migrations 0001 + legacy ALTERs + 0002.
 * Side effects: none (in-memory database, in-memory R2 stand-in, no project files written).
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const worker = require("../backend/worker");
const answerKey = require("../backend/answer-key");
const { createEnv, legacyThenMigratedDb, ROOT } = require("./helpers/d1-sqlite");

const ORIGIN = "https://elgo.example.com";
const ADMIN_PW = "correct horse battery staple";
const QUIZ = { subjectId: "demo-course", quizId: "quiz-1" };
const OTHER_QUIZ = { subjectId: "demo-course", quizId: "quiz-2" };

async function call(env, method, route, opts) {
  const o = opts || {};
  const headers = Object.assign({}, o.headers || {});
  if (o.token) headers.Authorization = "Bearer " + o.token;
  if (o.cookie) headers.Cookie = o.cookie;
  let body;
  if (o.rawBody !== undefined) {
    body = o.rawBody;
  } else if (o.body !== undefined) {
    body = JSON.stringify(o.body);
    headers["Content-Type"] = "application/json";
  }
  const res = await worker.handleApiRequest(new Request(ORIGIN + route, { method, headers, body }), env);
  let json = null;
  const type = res.headers.get("content-type") || "";
  if (type.includes("json")) json = await res.json();
  return { status: res.status, json, res };
}

async function register(env, username, password) {
  const r = await call(env, "POST", "/api/auth/register", { body: { username, password: password || "password-123" } });
  assert.equal(r.status, 200, "register " + username + ": " + JSON.stringify(r.json));
  return r.json;
}

function answersFor(coll, mutate) {
  const c = answerKey.collections[coll.subjectId + "::" + coll.quizId];
  const out = {};
  Object.keys(c.answers).forEach((k) => {
    if (k.indexOf("::") !== -1) out[k] = c.answers[k]; // composite internal ids, one per question
  });
  if (mutate) mutate(out);
  return out;
}

function wrongLetter(letter) { return letter === "A" ? "B" : "A"; }

async function adminCookie(env) {
  const r = await call(env, "POST", "/api/admin/login", { body: { password: ADMIN_PW } });
  assert.equal(r.status, 200);
  const setCookie = r.res.headers.get("set-cookie");
  return { cookie: setCookie.split(";")[0], setCookie, json: r.json };
}

function submitBody(extra) {
  return Object.assign({ attemptId: "attempt-" + Math.random().toString(36).slice(2, 12), durationMs: 600000, mode: "original" }, QUIZ, extra || {});
}

// ---------------------------------------------------------------------------
// Phase 1 — authentication & authorization
// ---------------------------------------------------------------------------
test("student token never grants admin access (privilege escalation closed)", async () => {
  const env = createEnv();
  const student = await register(env, "student_one");
  const t = student.token;

  const probes = [
    ["GET", "/api/admin/users", undefined],
    ["POST", "/api/admin/users/role", { username: "student_one", isAdmin: true }],
    ["POST", "/api/admin/users/delete", { username: "student_one" }],
    ["POST", "/api/admin/site-settings", { settings: { a: 1 } }],
    ["POST", "/api/admin/content", { overrides: {} }],
    ["GET", "/api/admin/session", undefined],
    ["GET", "/api/admin/diagnostics", undefined]
  ];
  for (const [method, route, body] of probes) {
    const r = await call(env, method, route, { token: t, body });
    assert.ok([401, 403].includes(r.status), `${method} ${route} must reject a student token, got ${r.status}`);
  }
  const upload = await call(env, "POST", "/api/admin/r2/upload?subjectId=x", {
    token: t, rawBody: Buffer.from("%PDF-1.4 test"), headers: { "Content-Length": "13" }
  });
  assert.equal(upload.status, 401);

  // The old worker copied student tokens into admin_sessions with is_master_admin = 0. Even if such a row exists, it must be ignored.
  const crypto = require("node:crypto");
  const hash = crypto.createHash("sha256").update(t).digest("hex");
  env.sqlite.prepare("INSERT INTO admin_sessions (token_hash, ip_address, user_agent, created_at, expires_at, is_master_admin, student_id) VALUES (?,?,?,?,?,0,?)")
    .run(hash, "x", "x", Date.now(), Date.now() + 1e9, student.profile.studentId);
  const legacy = await call(env, "GET", "/api/admin/users", { token: t });
  assert.equal(legacy.status, 401, "legacy admin_sessions rows created from student tokens must be ignored");
  // Even a row wrongly flagged master but carrying a student id is refused.
  env.sqlite.prepare("UPDATE admin_sessions SET is_master_admin = 1 WHERE token_hash = ?").run(hash);
  assert.equal((await call(env, "GET", "/api/admin/users", { token: t })).status, 401);
});

test("unauthenticated callers cannot use any protected endpoint", async () => {
  const env = createEnv();
  await register(env, "victim_user");
  const checks = [
    ["GET", "/api/user/profile?studentId=anything"],
    ["POST", "/api/user/profile", { studentId: "stu_x", username: "hacked_name" }],
    ["DELETE", "/api/user/profile", { studentId: "stu_x" }],
    ["POST", "/api/quiz/submit", submitBody({ answers: answersFor(QUIZ) })],
    ["POST", "/api/auth/sync-progress", { progress: {} }],
    ["GET", "/api/admin/users"],
    ["POST", "/api/admin/users/delete", { username: "victim_user" }],
    ["POST", "/api/admin/content", { overrides: {} }]
  ];
  for (const [method, route, body] of checks) {
    const r = await call(env, method, route, { body });
    assert.equal(r.status, 401, `${method} ${route} must be 401 without credentials, got ${r.status}`);
  }
  const still = env.sqlite.prepare("SELECT username FROM users WHERE username = 'victim_user'").get();
  assert.ok(still, "victim must still exist");
});

test("admin login: lockout, HttpOnly cookie, no token in body, logout invalidates", async () => {
  const env = createEnv();
  for (let i = 0; i < 4; i += 1) {
    const bad = await call(env, "POST", "/api/admin/login", { body: { password: "nope" } });
    assert.equal(bad.status, 401);
  }
  const fifth = await call(env, "POST", "/api/admin/login", { body: { password: "nope" } });
  assert.equal(fifth.status, 401);
  const locked = await call(env, "POST", "/api/admin/login", { body: { password: ADMIN_PW } });
  assert.equal(locked.status, 429, "correct password is still refused while locked");

  const env2 = createEnv();
  const { cookie, setCookie, json } = await adminCookie(env2);
  assert.ok(/HttpOnly/i.test(setCookie) && /Secure/i.test(setCookie) && /SameSite=Strict/i.test(setCookie));
  assert.equal(json.token, undefined, "token is not exposed to page script");
  const users = await call(env2, "GET", "/api/admin/users", { cookie });
  assert.equal(users.status, 200);
  assert.equal((await call(env2, "GET", "/api/admin/session", { cookie })).json.role, "master");
  await call(env2, "POST", "/api/admin/logout", { cookie });
  assert.equal((await call(env2, "GET", "/api/admin/users", { cookie })).status, 401, "revoked session rejected");
});

test("expired admin and student sessions are rejected", async () => {
  const env = createEnv();
  const { cookie } = await adminCookie(env);
  env.sqlite.prepare("UPDATE admin_sessions SET expires_at = ?").run(Date.now() - 1000);
  assert.equal((await call(env, "GET", "/api/admin/users", { cookie })).status, 401);

  const s = await register(env, "expiring_student");
  assert.equal((await call(env, "GET", "/api/user/profile", { token: s.token })).status, 200);
  env.sqlite.prepare("UPDATE user_sessions SET expires_at = ?").run(Date.now() - 1000);
  assert.equal((await call(env, "GET", "/api/user/profile", { token: s.token })).status, 401);
});

test("student logout revokes the token server-side", async () => {
  const env = createEnv();
  const s = await register(env, "logout_student");
  assert.equal((await call(env, "POST", "/api/auth/logout", { token: s.token })).status, 200);
  assert.equal((await call(env, "GET", "/api/user/profile", { token: s.token })).status, 401);
});

test("cross-origin writes are blocked", async () => {
  const env = createEnv();
  const r = await call(env, "POST", "/api/auth/register", {
    body: { username: "csrf_user", password: "password-123" }, headers: { Origin: "https://evil.example.net" }
  });
  assert.equal(r.status, 403);
  const ok = await call(env, "POST", "/api/auth/register", {
    body: { username: "same_origin_user", password: "password-123" }, headers: { Origin: ORIGIN }
  });
  assert.equal(ok.status, 200);
});

test("co-admin role: granted by master only, re-checked on every request, limited powers", async () => {
  const env = createEnv();
  const { cookie } = await adminCookie(env);
  const coadmin = await register(env, "co_admin_one");
  const victim = await register(env, "plain_student");
  assert.equal((await call(env, "GET", "/api/admin/users", { token: coadmin.token })).status, 401);

  const grant = await call(env, "POST", "/api/admin/users/role", { cookie, body: { username: "co_admin_one", isAdmin: true } });
  assert.equal(grant.status, 200);

  const list = await call(env, "GET", "/api/admin/users?q=plain", { token: coadmin.token });
  assert.equal(list.status, 200, "co-admin reaches /api/admin/users (route works)");
  assert.ok(list.json.users.some((u) => u.username === "plain_student"));

  const selfPromote = await call(env, "POST", "/api/admin/users/role", { token: coadmin.token, body: { username: "plain_student", isAdmin: true } });
  assert.equal(selfPromote.status, 403, "co-admin cannot change roles");

  const delAdmin = await call(env, "POST", "/api/admin/users/delete", { token: coadmin.token, body: { username: "co_admin_one" } });
  assert.equal(delAdmin.status, 403, "co-admin cannot delete an admin");
  const delStudent = await call(env, "POST", "/api/admin/users/delete", { token: coadmin.token, body: { studentId: victim.profile.studentId } });
  assert.equal(delStudent.status, 200);

  await call(env, "POST", "/api/admin/users/role", { cookie, body: { username: "co_admin_one", isAdmin: false } });
  assert.equal((await call(env, "GET", "/api/admin/users", { token: coadmin.token })).status, 401, "revocation is immediate");
});

// ---------------------------------------------------------------------------
// Phase 2 — accounts
// ---------------------------------------------------------------------------
test("registration rules: server-generated ids, password length, duplicates", async () => {
  const env = createEnv();
  const weak = await call(env, "POST", "/api/auth/register", { body: { username: "weak_pw", password: "short" } });
  assert.equal(weak.status, 400);
  const a = await call(env, "POST", "/api/auth/register", { body: { username: "Alice_AI", password: "password-123", studentId: "stu_attacker_chosen" } });
  assert.equal(a.status, 200);
  assert.notEqual(a.json.profile.studentId, "stu_attacker_chosen", "client cannot choose the student id");
  const dup = await call(env, "POST", "/api/auth/register", { body: { username: "alice_ai", password: "password-123" } });
  assert.equal(dup.status, 409, "usernames are case-insensitive unique");
  const bad = await call(env, "POST", "/api/auth/register", { body: { username: "admin", password: "password-123" } });
  assert.equal(bad.status, 400, "reserved name refused");
});

test("login: generic failures, throttling, hash stored as PBKDF2", async () => {
  const env = createEnv();
  await register(env, "login_user", "right-password");
  const stored = env.sqlite.prepare("SELECT password_hash FROM users WHERE username = 'login_user'").get().password_hash;
  assert.ok(stored.startsWith("pbkdf2$100000$"), "PBKDF2 with 100k iterations");
  const wrong = await call(env, "POST", "/api/auth/login", { body: { username: "login_user", password: "wrong-password" } });
  const ghost = await call(env, "POST", "/api/auth/login", { body: { username: "nobody_here", password: "wrong-password" } });
  assert.equal(wrong.status, 401);
  assert.equal(ghost.status, 401);
  assert.equal(wrong.json.error, ghost.json.error, "no user enumeration through messages");
  const ok = await call(env, "POST", "/api/auth/login", { body: { username: "login_user", password: "right-password" } });
  assert.equal(ok.status, 200);
  assert.ok(ok.json.token && ok.json.profile.username === "login_user");

  let last;
  for (let i = 0; i < 9; i += 1) last = await call(env, "POST", "/api/auth/login", { body: { username: "login_user", password: "guess-" + i } });
  assert.equal(last.status, 429, "brute force is throttled per username");
  const stillLocked = await call(env, "POST", "/api/auth/login", { body: { username: "login_user", password: "right-password" } });
  assert.equal(stillLocked.status, 429);
});

test("legacy SHA-256 passwords still work and are upgraded to PBKDF2 on login", async () => {
  const env = createEnv();
  const crypto = require("node:crypto");
  const salt = "abc123salt";
  const digest = crypto.createHash("sha256").update(salt + ":" + "old-password").digest("hex");
  env.sqlite.prepare("INSERT INTO users (student_id, username, display_name, password_hash) VALUES ('stu_legacy1','legacy_user','legacy_user',?)")
    .run("sha256$" + salt + "$" + digest);
  const r = await call(env, "POST", "/api/auth/login", { body: { username: "legacy_user", password: "old-password" } });
  assert.equal(r.status, 200);
  const stored = env.sqlite.prepare("SELECT password_hash FROM users WHERE username = 'legacy_user'").get().password_hash;
  assert.ok(stored.startsWith("pbkdf2$"), "hash upgraded");
  assert.equal((await call(env, "POST", "/api/auth/login", { body: { username: "legacy_user", password: "old-password" } })).status, 200);
});

test("password-less accounts cannot be taken over by logging in; claim needs the account secret", async () => {
  const env = createEnv();
  env.sqlite.prepare("INSERT INTO users (student_id, username, display_name, password_hash, progress_json) VALUES ('stu_legacyOWNER_01','old_player','old_player','','{}')").run();

  const attack = await call(env, "POST", "/api/auth/login", { body: { username: "old_player", password: "attacker-password" } });
  assert.equal(attack.status, 409);
  assert.equal(attack.json.code, "ACCOUNT_NEEDS_CLAIM");
  assert.equal(env.sqlite.prepare("SELECT password_hash FROM users WHERE username='old_player'").get().password_hash, "", "password still empty");

  const guess = await call(env, "POST", "/api/auth/claim", { body: { username: "old_player", studentId: "stu_wrong_guess", password: "attacker-password" } });
  assert.equal(guess.status, 404);
  assert.equal(env.sqlite.prepare("SELECT password_hash FROM users WHERE username='old_player'").get().password_hash, "");

  const owner = await call(env, "POST", "/api/auth/claim", { body: { username: "old_player", studentId: "stu_legacyOWNER_01", password: "owners-new-password" } });
  assert.equal(owner.status, 200);
  assert.ok(owner.json.token);
  const again = await call(env, "POST", "/api/auth/claim", { body: { username: "old_player", studentId: "stu_legacyOWNER_01", password: "attacker-password" } });
  assert.equal(again.status, 404, "an already-claimed account cannot be claimed twice");
  assert.equal((await call(env, "POST", "/api/auth/login", { body: { username: "old_player", password: "owners-new-password" } })).status, 200);
});

test("profile endpoints only act on the caller's own account", async () => {
  const env = createEnv();
  const a = await register(env, "alice_owner");
  const b = await register(env, "bob_target");

  const readOther = await call(env, "GET", "/api/user/profile?studentId=" + b.profile.studentId, { token: a.token });
  assert.equal(readOther.status, 403);
  const renameOther = await call(env, "POST", "/api/user/profile", { token: a.token, body: { studentId: b.profile.studentId, username: "stolen_name" } });
  assert.equal(renameOther.status, 403);
  const deleteOther = await call(env, "DELETE", "/api/user/profile", { token: a.token, body: { studentId: b.profile.studentId, password: "password-123" } });
  assert.equal(deleteOther.status, 200, "DELETE targets the caller (Alice), never the body studentId");
  assert.ok(env.sqlite.prepare("SELECT 1 FROM users WHERE student_id = ?").get(b.profile.studentId), "Bob untouched");
  assert.equal(env.sqlite.prepare("SELECT 1 FROM users WHERE student_id = ?").get(a.profile.studentId), undefined, "Alice removed herself");
});

test("rename: own account, limit enforced, duplicates refused; delete needs password", async () => {
  const env = createEnv();
  const a = await register(env, "rename_me");
  await register(env, "taken_name");
  assert.equal((await call(env, "POST", "/api/user/profile", { token: a.token, body: { username: "taken_name" } })).status, 409);
  for (const n of ["new_one", "new_two", "new_three"]) {
    assert.equal((await call(env, "POST", "/api/user/profile", { token: a.token, body: { username: n } })).status, 200);
  }
  assert.equal((await call(env, "POST", "/api/user/profile", { token: a.token, body: { username: "new_four" } })).status, 429);
  assert.equal((await call(env, "DELETE", "/api/user/profile", { token: a.token, body: {} })).status, 403, "password confirmation required");
  assert.equal((await call(env, "DELETE", "/api/user/profile", { token: a.token, body: { password: "password-123" } })).status, 200);
});

test("admin can delete a user and all of their data", async () => {
  const env = createEnv();
  const { cookie } = await adminCookie(env);
  const s = await register(env, "to_be_removed");
  await call(env, "POST", "/api/quiz/submit", { token: s.token, body: submitBody({ answers: answersFor(QUIZ) }) });
  assert.equal(env.sqlite.prepare("SELECT COUNT(*) n FROM best_scores").get().n, 1);
  const del = await call(env, "POST", "/api/admin/users/delete", { cookie, body: { studentId: s.profile.studentId } });
  assert.equal(del.status, 200);
  for (const t of ["users", "best_scores", "quiz_attempts", "user_sessions", "student_progress"]) {
    assert.equal(env.sqlite.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n, 0, t + " emptied");
  }
  assert.equal((await call(env, "POST", "/api/admin/users/delete", { cookie, body: { studentId: "missing" } })).status, 404);
});

// ---------------------------------------------------------------------------
// Phase 3 — quiz submission & score integrity
// ---------------------------------------------------------------------------
test("normal full submission is graded by the server", async () => {
  const env = createEnv();
  const s = await register(env, "honest_student");
  const col = answerKey.collections[QUIZ.subjectId + "::" + QUIZ.quizId];
  const answers = answersFor(QUIZ, (a) => { const first = Object.keys(a)[0]; a[first] = wrongLetter(a[first]); });
  const r = await call(env, "POST", "/api/quiz/submit", { token: s.token, body: submitBody({ answers }) });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.attempt.total, col.gradableQuestions);
  assert.equal(r.json.attempt.score, col.gradableQuestions - 1);
  assert.equal(r.json.attempt.countedInRanking, true);
  assert.equal(r.json.attempt.validatedByServer, true);
});

test("forged scores are ignored: client score/total/percentage never trusted", async () => {
  const env = createEnv();
  const s = await register(env, "forger");
  const allWrong = answersFor(QUIZ, (a) => Object.keys(a).forEach((k) => { a[k] = wrongLetter(a[k]); }));
  const r = await call(env, "POST", "/api/quiz/submit", {
    token: s.token, body: submitBody({ answers: allWrong, score: 30, total: 30, totalQuestions: 30, percentage: 100 })
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.attempt.score, 0, "score recomputed from answers");
  assert.equal(r.json.attempt.percentage, 0);

  const noAnswers = await call(env, "POST", "/api/quiz/submit", { token: s.token, body: submitBody({ score: 30, total: 30, percentage: 100 }) });
  assert.equal(noAnswers.status, 400, "missing answers are no longer a reason to trust the score");
  const emptyAnswers = await call(env, "POST", "/api/quiz/submit", { token: s.token, body: submitBody({ answers: {}, score: 30, total: 30 }) });
  assert.equal(emptyAnswers.status, 400);
  assert.equal(env.sqlite.prepare("SELECT COUNT(*) n FROM best_scores WHERE best_percentage = 100").get().n, 0);
});

test("invalid quizzes, question ids and answer formats are rejected", async () => {
  const env = createEnv();
  const s = await register(env, "prober");
  const good = answersFor(QUIZ);
  const firstKey = Object.keys(good)[0];

  const unknownQuiz = await call(env, "POST", "/api/quiz/submit", { token: s.token, body: submitBody({ quizId: "made-up-" + Date.now(), answers: good }) });
  assert.equal(unknownQuiz.status, 400);
  assert.equal(unknownQuiz.json.code, "UNKNOWN_QUIZ");

  const unknownQuestion = await call(env, "POST", "/api/quiz/submit", { token: s.token, body: submitBody({ answers: Object.assign({}, good, { "totally::fake::question": "A" }) }) });
  assert.equal(unknownQuestion.status, 400);
  assert.equal(unknownQuestion.json.code, "UNKNOWN_QUESTION");

  const otherQuizAnswers = answersFor(OTHER_QUIZ);
  const crossQuiz = await call(env, "POST", "/api/quiz/submit", { token: s.token, body: submitBody({ answers: otherQuizAnswers }) });
  assert.equal(crossQuiz.status, 400, "questions that belong to a different quiz are refused");

  for (const bad of [{ [firstKey]: { evil: 1 } }, { [firstKey]: "ZZZZZZ" }, { [firstKey]: 5 }, { [firstKey]: "" }]) {
    const r = await call(env, "POST", "/api/quiz/submit", { token: s.token, body: submitBody({ answers: bad }) });
    assert.equal(r.status, 400);
    assert.equal(r.json.code, "BAD_ANSWER_FORMAT");
  }
  const missingAttempt = await call(env, "POST", "/api/quiz/submit", { token: s.token, body: Object.assign(submitBody({ answers: good }), { attemptId: "" }) });
  assert.equal(missingAttempt.status, 400);
  assert.equal(env.sqlite.prepare("SELECT COUNT(*) n FROM quiz_attempts").get().n, 0, "nothing was stored for rejected input");
});

test("partial or implausibly fast attempts are stored but never reach the leaderboard", async () => {
  const env = createEnv();
  const s = await register(env, "partial_player");
  const full = answersFor(QUIZ);
  const half = {};
  const fullKeys = Object.keys(full);
  const halfCount = Math.max(1, Math.floor(fullKeys.length / 2));
  fullKeys.slice(0, halfCount).forEach((k) => { half[k] = full[k]; });
  const partial = await call(env, "POST", "/api/quiz/submit", { token: s.token, body: submitBody({ answers: half }) });
  assert.equal(partial.status, 200);
  assert.equal(partial.json.attempt.countedInRanking, false);
  assert.equal(partial.json.attempt.score, halfCount);
  assert.equal(partial.json.attempt.total, answerKey.collections[QUIZ.subjectId + "::" + QUIZ.quizId].gradableQuestions, "total comes from the key, not the client");

  const fast = await call(env, "POST", "/api/quiz/submit", { token: s.token, body: submitBody({ answers: full, durationMs: 1000 }) });
  assert.equal(fast.status, 200);
  assert.equal(fast.json.attempt.rankStatus, "implausible_time");
  assert.equal(env.sqlite.prepare("SELECT COUNT(*) n FROM best_scores").get().n, 0);
  assert.equal(env.sqlite.prepare("SELECT COUNT(*) n FROM quiz_attempts").get().n, 2);
});

test("replays are idempotent and best score only improves", async () => {
  const env = createEnv();
  const s = await register(env, "replayer");
  const lowAnswers = answersFor(QUIZ, (a) => { const k = Object.keys(a)[0]; a[k] = wrongLetter(a[k]); });
  const highAnswers = answersFor(QUIZ);

  const first = submitBody({ answers: lowAnswers });
  const r1 = await call(env, "POST", "/api/quiz/submit", { token: s.token, body: first });
  const replay = await call(env, "POST", "/api/quiz/submit", { token: s.token, body: Object.assign({}, first, { answers: highAnswers }) });
  assert.equal(replay.json.duplicate, true);
  assert.equal(replay.json.attempt.score, r1.json.attempt.score, "same attemptId cannot be re-graded with different answers");
  assert.equal(env.sqlite.prepare("SELECT attempts_count c FROM best_scores").get().c, 1);

  const better = await call(env, "POST", "/api/quiz/submit", { token: s.token, body: submitBody({ answers: highAnswers }) });
  assert.equal(better.json.attempt.percentage, 100);
  const worse = await call(env, "POST", "/api/quiz/submit", { token: s.token, body: submitBody({ answers: lowAnswers }) });
  assert.ok(worse.json.attempt.percentage < 100);
  const row = env.sqlite.prepare("SELECT best_percentage p, attempts_count c, validated_by_server v FROM best_scores").get();
  assert.equal(row.p, 100, "a worse attempt never lowers the best score");
  assert.equal(row.c, 3);
  assert.equal(row.v, 1);
});

test("submission rate limit", async () => {
  const env = createEnv();
  const s = await register(env, "spammer");
  const answers = answersFor(QUIZ);
  let limited = 0;
  for (let i = 0; i < 34; i += 1) {
    const r = await call(env, "POST", "/api/quiz/submit", { token: s.token, body: submitBody({ answers }) });
    if (r.status === 429) limited += 1;
  }
  assert.ok(limited >= 4, "submissions beyond 30 per window are refused (limited=" + limited + ")");
});

// ---------------------------------------------------------------------------
// Phase 4 — leaderboard
// ---------------------------------------------------------------------------
test("leaderboard exposes no student ids, flags only the caller, ranks validated results", async () => {
  const env = createEnv();
  const a = await register(env, "board_alice");
  const b = await register(env, "board_bob");
  await call(env, "POST", "/api/quiz/submit", { token: a.token, body: submitBody({ answers: answersFor(QUIZ) }) });
  const bobAnswers = answersFor(QUIZ, (x) => { Object.keys(x).slice(0, 5).forEach((k) => { x[k] = wrongLetter(x[k]); }); });
  await call(env, "POST", "/api/quiz/submit", { token: b.token, body: submitBody({ answers: bobAnswers }) });

  const pub = await call(env, "GET", "/api/leaderboard");
  assert.equal(pub.status, 200);
  const text = JSON.stringify(pub.json);
  assert.ok(!text.includes(a.profile.studentId) && !text.includes(b.profile.studentId), "no student ids in the public payload");
  assert.ok(!/studentId|student_id|stu_/.test(text), "no id-like fields at all");
  assert.deepEqual(pub.json.entries.map((e) => e.username), ["board_alice", "board_bob"]);
  assert.equal(pub.json.entries[0].rank, 1);
  assert.ok(pub.json.entries.every((e) => e.isMe === false));

  const asBob = await call(env, "GET", "/api/leaderboard", { token: b.token });
  assert.deepEqual(asBob.json.entries.map((e) => e.isMe), [false, true]);
});

test("unvalidated rows are excluded from the leaderboard", async () => {
  const env = createEnv();
  const a = await register(env, "legit_one");
  await call(env, "POST", "/api/quiz/submit", { token: a.token, body: submitBody({ answers: answersFor(QUIZ) }) });
  env.sqlite.prepare("INSERT INTO users (student_id, username, display_name) VALUES ('stu_forged_row','forged_hero','forged_hero')").run();
  env.sqlite.prepare("INSERT INTO best_scores (student_id, subject_id, quiz_id, username, best_score, total, best_percentage, fastest_duration_ms) VALUES ('stu_forged_row','x','y','forged_hero',500,500,100,1000)").run();
  const lb = await call(env, "GET", "/api/leaderboard");
  assert.deepEqual(lb.json.entries.map((e) => e.username), ["legit_one"]);
});

test("leaderboard XP is aggregated in SQL (no truncation bug) and respects subject filter", async () => {
  const env = createEnv();
  const ins = env.sqlite.prepare("INSERT INTO users (student_id, username, display_name) VALUES (?,?,?)");
  const bs = env.sqlite.prepare("INSERT INTO best_scores (student_id, subject_id, quiz_id, username, best_score, total, best_percentage, fastest_duration_ms, validated_by_server) VALUES (?,?,?,?,?,?,?,?,1)");
  ins.run("stu_grinder", "grinder", "grinder");
  ins.run("stu_sprinter", "sprinter", "sprinter");
  // 700 low-percentage quizzes for the grinder; one perfect quiz for the sprinter.
  for (let i = 0; i < 700; i += 1) bs.run("stu_grinder", "subj-a", "q" + i, "grinder", 5, 20, 25, 60000);
  bs.run("stu_sprinter", "subj-a", "qq", "sprinter", 20, 20, 100, 60000);
  const lb = await call(env, "GET", "/api/leaderboard?limit=10");
  assert.equal(lb.json.entries[0].username, "grinder", "700 quizzes x (50+25 XP) outranks one perfect quiz");
  assert.equal(lb.json.entries[0].quizzesCount, 700);
  assert.equal(lb.json.entries[0].xp, 700 * 75);
  const filtered = await call(env, "GET", "/api/leaderboard?subjectId=subj-b");
  assert.equal(filtered.json.entries.length, 0);
});

// ---------------------------------------------------------------------------
// Phase 5 — content management, R2, site data
// ---------------------------------------------------------------------------
function pdfBytes(extra) { return Buffer.from("%PDF-1.4\n" + (extra || "hello") + "\n%%EOF"); }

test("PDF upload: admin only, validated, key generated server-side, safe serving", async () => {
  const env = createEnv();
  const student = await register(env, "uploader_student");
  const bytes = pdfBytes();

  assert.equal((await call(env, "POST", "/api/admin/r2/upload?subjectId=ml", { rawBody: bytes, headers: { "Content-Length": String(bytes.length) } })).status, 401);
  assert.equal((await call(env, "POST", "/api/admin/r2/upload?subjectId=ml", { token: student.token, rawBody: bytes, headers: { "Content-Length": String(bytes.length) } })).status, 401);

  const { cookie } = await adminCookie(env);
  const html = Buffer.from("<html><script>alert(1)</script></html>");
  const notPdf = await call(env, "POST", "/api/admin/r2/upload?subjectId=ml", { cookie, rawBody: html, headers: { "Content-Length": String(html.length), "Content-Type": "text/html" } });
  assert.equal(notPdf.status, 415, "HTML/SVG/other types are refused");
  const noLen = await call(env, "POST", "/api/admin/r2/upload?subjectId=ml", { cookie, rawBody: bytes });
  assert.ok([411, 200].includes(noLen.status));
  const tooBig = await call(env, "POST", "/api/admin/r2/upload?subjectId=ml", { cookie, rawBody: bytes, headers: { "Content-Length": String(26 * 1024 * 1024) } });
  assert.equal(tooBig.status, 413);

  const up = await call(env, "POST", "/api/admin/r2/upload?subjectId=ML%20Subject&key=../../evil.html&title=Lecture%2010", {
    cookie, rawBody: bytes, headers: { "Content-Length": String(bytes.length), "Content-Type": "text/html" }
  });
  assert.equal(up.status, 200, JSON.stringify(up.json));
  assert.match(up.json.pdf.r2Key, /^pdfs\/ml-subject\/[a-f0-9]{32}\.pdf$/, "client-supplied key is ignored");
  assert.ok(env.FILES.store.has(up.json.pdf.r2Key));
  assert.equal(env.FILES.store.get(up.json.pdf.r2Key).httpMetadata.contentType, "application/pdf", "content type forced");

  const served = await call(env, "GET", up.json.pdf.url);
  assert.equal(served.status, 200);
  assert.equal(served.res.headers.get("content-type"), "application/pdf");
  assert.equal(served.res.headers.get("x-content-type-options"), "nosniff");
});

test("only registered PDFs are served; arbitrary or legacy R2 objects are not", async () => {
  const env = createEnv();
  await env.FILES.put("evil.html", Buffer.from("<script>alert(1)</script>"), { httpMetadata: { contentType: "text/html" } });
  await env.FILES.put("pdfs/ml/" + "a".repeat(32) + ".pdf", pdfBytes(), { httpMetadata: { contentType: "application/pdf" } });
  assert.equal((await call(env, "GET", "/api/r2/evil.html")).status, 404);
  assert.equal((await call(env, "GET", "/api/r2/..%2Fsecret")).status, 404);
  assert.equal((await call(env, "GET", "/api/r2/pdfs/ml/" + "a".repeat(32) + ".pdf")).status, 404, "unregistered object not served");
  env.sqlite.prepare("INSERT INTO pdfs_meta (id, subject_id, title, r2_key, url, is_deleted) VALUES ('p1','ml','T',?,'/x',0)").run("pdfs/ml/" + "a".repeat(32) + ".pdf");
  assert.equal((await call(env, "GET", "/api/r2/pdfs/ml/" + "a".repeat(32) + ".pdf")).status, 200);
  env.sqlite.prepare("UPDATE pdfs_meta SET is_deleted = 1").run();
  assert.equal((await call(env, "GET", "/api/r2/pdfs/ml/" + "a".repeat(32) + ".pdf")).status, 404, "soft-deleted PDFs disappear");
});

test("content library overrides persist centrally, are validated, and guard against stale writes", async () => {
  const env = createEnv();
  const { cookie } = await adminCookie(env);
  const student = await register(env, "reader_student");

  const empty = await call(env, "GET", "/api/content/overrides");
  assert.equal(empty.json.overrides, null);

  const overlay = {
    videos: [{ id: "vid-1", subjectId: "ml", title: "Intro", url: "https://youtu.be/dQw4w9WgXcQ", active: true }],
    pdfs: [{ id: "pdf-1", subjectId: "ml", title: "Notes", path: "/api/r2/pdfs/ml/" + "b".repeat(32) + ".pdf" }],
    removed: { videos: ["old-vid"] }
  };
  assert.equal((await call(env, "POST", "/api/admin/content", { token: student.token, body: { overrides: overlay } })).status, 401);
  const saved = await call(env, "POST", "/api/admin/content", { cookie, body: { overrides: overlay } });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));

  const asStudent = await call(env, "GET", "/api/content/overrides", { token: student.token });
  assert.equal(asStudent.json.overrides.videos[0].id, "vid-1");
  assert.deepEqual(asStudent.json.overrides.removed.videos, ["old-vid"]);

  for (const bad of ["javascript:alert(1)", "data:text/html,<b>x</b>", "//evil.example/x", "../../etc/passwd"]) {
    const r = await call(env, "POST", "/api/admin/content", {
      cookie, body: { overrides: { videos: [{ id: "v2", subjectId: "ml", url: bad }] }, baseUpdatedAt: saved.json.updatedAt }
    });
    assert.equal(r.status, 400, "unsafe url refused: " + bad);
  }
  const stale = await call(env, "POST", "/api/admin/content", { cookie, body: { overrides: overlay, baseUpdatedAt: "1999-01-01 00:00:00" } });
  assert.equal(stale.status, 409);
  const forced = await call(env, "POST", "/api/admin/content", { cookie, body: { overrides: overlay, baseUpdatedAt: "1999-01-01 00:00:00", force: true } });
  assert.equal(forced.status, 200);
});

test("site settings: public read, admin-only write, size capped", async () => {
  const env = createEnv();
  const { cookie } = await adminCookie(env);
  const s = await register(env, "settings_student");
  assert.equal((await call(env, "POST", "/api/admin/site-settings", { token: s.token, body: { settings: { nextEvent: "x" } } })).status, 401);
  assert.equal((await call(env, "POST", "/api/admin/site-settings", { cookie, body: { settings: { nextEvent: "Final exam" } } })).status, 200);
  assert.equal((await call(env, "GET", "/api/site-settings")).json.settings.nextEvent, "Final exam");
  const big = { settings: { blob: "x".repeat(70 * 1024) } };
  assert.equal((await call(env, "POST", "/api/admin/site-settings", { cookie, body: big })).status, 413);
});

// ---------------------------------------------------------------------------
// Phase 6 — reliability
// ---------------------------------------------------------------------------
test("health reveals nothing about configuration; unknown routes are JSON 404s", async () => {
  const env = createEnv();
  const h = await call(env, "GET", "/api/health");
  assert.equal(h.status, 200);
  assert.deepEqual(Object.keys(h.json).sort(), ["ok", "service"]);
  const nf = await call(env, "GET", "/api/does-not-exist");
  assert.equal(nf.status, 404);
  assert.ok(!JSON.stringify(nf.json).includes("does-not-exist"), "path is not echoed");
});

test("malformed or oversized JSON never crashes the API (no stack traces)", async () => {
  const env = createEnv();
  const bad = await call(env, "POST", "/api/auth/login", { rawBody: "{not json", headers: { "Content-Type": "application/json" } });
  assert.equal(bad.status, 401);
  const s = await register(env, "big_payload");
  const huge = await call(env, "POST", "/api/auth/sync-progress", { token: s.token, body: { progress: { blob: "x".repeat(450 * 1024) } } });
  assert.ok([200, 413].includes(huge.status));
  const row = env.sqlite.prepare("SELECT length(progress_json) n FROM users WHERE username='big_payload'").get();
  assert.ok(row.n < 400 * 1024, "oversized progress is not persisted");
});

test("the worker never alters the schema while serving requests", async () => {
  const env = createEnv();
  const seen = [];
  const original = env.DB.prepare.bind(env.DB);
  env.DB.prepare = (sql) => { seen.push(sql); return original(sql); };
  const s = await register(env, "schema_watch");
  await call(env, "POST", "/api/quiz/submit", { token: s.token, body: submitBody({ answers: answersFor(QUIZ) }) });
  await call(env, "GET", "/api/leaderboard");
  await call(env, "GET", "/api/health");
  const ddl = seen.filter((sql) => /^\s*(ALTER|CREATE|DROP)\b/i.test(sql));
  assert.deepEqual(ddl, [], "no DDL at request time");
});

test("migration path: legacy production shape + 0002 supports the full flow", async () => {
  const db = legacyThenMigratedDb();
  // A legacy ranked row on a real quiz, plus the three forgery shapes the OLD worker accepted:
  //  - stu_fake:    summary-only score, never validated
  //  - stu_invent:  real answers submitted under an invented quiz id (old worker marked it validated)
  //  - stu_inflate: real quiz id, but more correct answers than the quiz has (answers borrowed from other quizzes)
  const S = QUIZ.subjectId;
  db.exec("INSERT INTO users (student_id, username, display_name) VALUES ('stu_old','old_champion','old_champion'),('stu_fake','fake_champion','fake_champion'),('stu_invent','invent_champion','invent_champion'),('stu_inflate','inflate_champion','inflate_champion')");
  db.exec("INSERT INTO quiz_attempts (attempt_hash, student_id, username, subject_id, quiz_id, score, total, percentage, duration_ms, validated_by_server) VALUES " +
    `('h1','stu_old','old_champion','${S}','${QUIZ.quizId}',5,6,83.333333,600000,1),` +
    `('h2','stu_invent','invent_champion','${S}','made-up-quiz-7',276,276,100,210000,1),` +
    `('h3','stu_inflate','inflate_champion','${S}','${QUIZ.quizId}',200,200,100,300000,1)`);
  db.exec("INSERT INTO best_scores (student_id, subject_id, quiz_id, username, best_score, total, best_percentage, fastest_duration_ms) VALUES " +
    `('stu_old','${S}','${QUIZ.quizId}','old_champion',5,6,83.333333,600000),` +
    `('stu_fake','${S}','forged','fake_champion',500,500,100,1000),` +
    `('stu_invent','${S}','made-up-quiz-7','invent_champion',276,276,100,210000),` +
    `('stu_inflate','${S}','${QUIZ.quizId}','inflate_champion',200,200,100,300000)`);
  db.exec("INSERT INTO admin_sessions (token_hash, ip_address, user_agent, created_at, expires_at, is_master_admin, student_id) VALUES ('t1','','',1,9999999999999,0,'stu_old')");

  db.exec(fs.readFileSync(path.join(ROOT, "backend/migrations/0002_score_integrity.sql"), "utf8"));

  const rows = db.prepare("SELECT student_id, validated_by_server v FROM best_scores ORDER BY student_id").all();
  assert.deepEqual(
    rows.map((r) => [r.student_id, r.v]),
    [["stu_fake", 0], ["stu_inflate", 0], ["stu_invent", 0], ["stu_old", 1]],
    "only legacy rows on a real quiz, within its size and backed by a validated attempt stay ranked"
  );
  assert.equal(db.prepare("SELECT COUNT(*) n FROM best_scores").get().n, 4, "the migration never deletes score rows");

  // cleanup removes legacy student tokens stored in admin_sessions
  db.exec("DELETE FROM admin_sessions;");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM admin_sessions").get().n, 0);

  const env = createEnv({ db });
  const s = await register(env, "post_migration");
  const r = await call(env, "POST", "/api/quiz/submit", { token: s.token, body: submitBody({ answers: answersFor(QUIZ) }) });
  assert.equal(r.status, 200);
  const lb = await call(env, "GET", "/api/leaderboard");
  assert.deepEqual(lb.json.entries.map((e) => e.username).sort(), ["old_champion", "post_migration"], "forged legacy rows excluded");
});

test("new season (0002 + 0003): legacy rows kept but unranked; a new attempt replaces the old-season row", async () => {
  const db = legacyThenMigratedDb();
  const S = QUIZ.subjectId;
  db.exec("INSERT INTO users (student_id, username, display_name) VALUES ('stu_old','old_champion','old_champion')");
  db.exec("INSERT INTO quiz_attempts (attempt_hash, student_id, username, subject_id, quiz_id, score, total, percentage, duration_ms, validated_by_server) VALUES " +
    `('h1','stu_old','old_champion','${S}','${QUIZ.quizId}',5,6,83.333333,600000,1)`);
  db.exec("INSERT INTO best_scores (student_id, subject_id, quiz_id, username, best_score, total, best_percentage, fastest_duration_ms, attempts_count) VALUES " +
    `('stu_old','${S}','${QUIZ.quizId}','old_champion',5,6,83.333333,600000,7)`);
  db.exec(fs.readFileSync(path.join(ROOT, "backend/migrations/0002_score_integrity.sql"), "utf8"));
  db.exec(fs.readFileSync(path.join(ROOT, "backend/migrations/0003_leaderboard_new_season.sql"), "utf8"));

  assert.equal(db.prepare("SELECT COUNT(*) n FROM best_scores WHERE validated_by_server = 1").get().n, 0, "no legacy row stays ranked");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM best_scores").get().n, 1, "legacy rows are kept");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM quiz_attempts WHERE rank_status = 'legacy'").get().n, 1, "old attempts are labelled, not deleted");
  assert.match(db.prepare("SELECT config_json FROM admin_config WHERE config_key = 'leaderboard_season'").get().config_json, /"season":2/);

  const env = createEnv({ db });
  assert.deepEqual((await call(env, "GET", "/api/leaderboard")).json.entries, [], "the new season starts empty");

  // A student with a strong old-season row submits a weaker new attempt: the new score must win.
  const s = await register(env, "season_two_student");
  const sid = db.prepare("SELECT student_id FROM users WHERE username = 'season_two_student'").get().student_id;
  db.prepare("INSERT INTO best_scores (student_id, subject_id, quiz_id, username, best_score, total, best_percentage, fastest_duration_ms, attempts_count, validated_by_server) VALUES (?, ?, ?, ?, 30, 30, 100, 300000, 9, 0)")
    .run(sid, S, QUIZ.quizId, "season_two_student");
  const keys = Object.keys(answersFor(QUIZ));
  const half = answersFor(QUIZ, (out) => { keys.slice(0, Math.floor(keys.length / 2)).forEach((k) => { out[k] = wrongLetter(out[k]); }); });
  const r = await call(env, "POST", "/api/quiz/submit", { token: s.token, body: submitBody({ answers: half }) });
  assert.equal(r.status, 200);
  const row = db.prepare("SELECT best_score, total, validated_by_server v, attempts_count FROM best_scores WHERE student_id = ?").get(sid);
  assert.equal(row.v, 1);
  assert.equal(row.best_score, r.json.attempt.score, "the old-season 30/30 is replaced, not promoted into the ranking");
  assert.ok(row.best_score < 30);
  assert.equal(row.attempts_count, 1, "attempt count restarts in the new season");

  const lb = await call(env, "GET", "/api/leaderboard");
  assert.deepEqual(lb.json.entries.map((e) => [e.username, e.score]), [["season_two_student", row.best_score]]);

  // Re-running 0003 changes nothing destructive (flags only; season record kept).
  db.exec(fs.readFileSync(path.join(ROOT, "backend/migrations/0003_leaderboard_new_season.sql"), "utf8"));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM best_scores").get().n, 2);
});

test("migration 0002 declares a valid historical collection size baseline", () => {
  const sql = fs.readFileSync(path.join(ROOT, "backend/migrations/0002_score_integrity.sql"), "utf8");
  const listed = {};
  for (const m of sql.matchAll(/\('([^']+::[^']+)',\s*(\d+)\)/g)) listed[m[1]] = Number(m[2]);
  assert.ok(Object.keys(listed).length > 0, "migration 0002 should list collection baselines");
  assert.ok(listed[QUIZ.subjectId + "::" + QUIZ.quizId] >= 1);
  assert.ok(listed[OTHER_QUIZ.subjectId + "::" + OTHER_QUIZ.quizId] >= 1);
});

test("master password set by manage-admin-password (salted PBKDF2 secret) works and wins over the old plaintext secret", async () => {
  const { hashAdminPassword, checkStrength } = require("../tools/admin-password");
  const newPw = "Ne3w-owner-passphrase!";
  const hash = hashAdminPassword(newPw, 1000); // low iteration count keeps the test fast; format is identical
  assert.match(hash, /^pbkdf2\$1000\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  assert.ok(!hash.includes(newPw), "the hash never contains the password");

  const env = createEnv(); // ADMIN_PASSWORD (old plaintext) is also set
  env.ADMIN_PASSWORD_HASH = hash;
  const oldPw = await call(env, "POST", "/api/admin/login", { body: { password: ADMIN_PW } });
  assert.equal(oldPw.status, 401, "once the hash secret exists the old plaintext password stops working");
  const ok = await call(env, "POST", "/api/admin/login", { body: { password: newPw } });
  assert.equal(ok.status, 200);
  const wrong = await call(env, "POST", "/api/admin/login", { body: { password: newPw + "x" } });
  assert.equal(wrong.status, 401);

  // hash-only configuration (plaintext secret removed by the tool)
  const env2 = createEnv({ adminPassword: "" });
  env2.ADMIN_PASSWORD_HASH = hash;
  assert.equal((await call(env2, "POST", "/api/admin/login", { body: { password: newPw } })).status, 200);

  // student passwords are unaffected: registration and login still work
  const s1 = await register(env2, "student_after_pw_change");
  assert.ok(s1.token);

  assert.ok(checkStrength("short"), "short passwords are refused");
  assert.ok(checkStrength("adminadmin12"), "common words are refused");
  assert.equal(checkStrength("Ne3w-owner-passphrase!"), "");
});

test("master cookie still works when a student Bearer token is sent alongside it", async () => {
  const env = createEnv();
  const { cookie } = await adminCookie(env);
  const s = await register(env, "dual_session_user");
  const r = await call(env, "GET", "/api/admin/users", { cookie, token: s.token });
  assert.equal(r.status, 200, "browser sends both; the cookie must still authenticate the master admin");
  const rl = await call(env, "POST", "/api/admin/users/role", { cookie, token: s.token, body: { username: "dual_session_user", isAdmin: true } });
  assert.equal(rl.status, 200);
});
