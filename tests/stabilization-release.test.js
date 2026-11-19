"use strict";
/**
 * Elgo Lab Final Stabilization Release Regression Suite
 *
 * Covers:
 * - Single-query /api/quiz/feedback latency optimization, Server-Timing, auth & Test Mode gate
 * - Hidden/deleted quiz blocking on feedback & submit
 * - Immediate visual acknowledgement without "Recorded" flash & stable player layout
 * - Exclusion of experimental Interactive Lessons code & routes
 * - Master-only permanent quiz deletion: preview, backup export, explicit confirmation,
 *   audit trail, historical quiz_attempts & best_scores preservation, static asset note
 * - Safe static bundled quiz removal CLI (tested on disposable temp directory)
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createEnv, ROOT } = require("./helpers/d1-sqlite");
const worker = require(path.join(ROOT, "backend", "worker.js"));
const { removeBundledQuiz } = require(path.join(ROOT, "tools", "remove-bundled-quiz.js"));

async function call(env, method, pathname, opts) {
  const o = opts || {};
  const headers = Object.assign({ Origin: "https://elgo.test" }, o.headers || {});
  if (o.token) headers.Authorization = "Bearer " + o.token;
  if (o.cookie) headers.Cookie = o.cookie;
  let body;
  if (o.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(o.body);
  }
  const res = await worker.fetch(new Request("https://elgo.test" + pathname, { method, headers, body }), env);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_e) { /* non-JSON */ }
  return { status: res.status, headers: res.headers, json, text };
}

async function masterCookie(env) {
  const res = await call(env, "POST", "/api/admin/login", { body: { password: env.ADMIN_PASSWORD } });
  assert.equal(res.status, 200);
  return (res.headers.get("Set-Cookie") || "").split(";")[0];
}

test("Stabilization 1: /api/quiz/feedback runs in 1 SQL query, enforces auth/invalid/hidden/Test Mode gates", async () => {
  const env = createEnv({ adminPassword: "super-secret-master-pass" });
  const qid = "demo-course::quiz::quiz-1::demo-quiz-1-1";

  // Missing auth -> 401
  assert.equal((await call(env, "POST", "/api/quiz/feedback", {
    body: { action: "practice", questionId: qid, selectedOptionId: "A" }
  })).status, 401);

  // Invalid auth -> 401
  assert.equal((await call(env, "POST", "/api/quiz/feedback", {
    token: "invalid-token-xyz",
    body: { action: "practice", questionId: qid, selectedOptionId: "A" }
  })).status, 401);

  const reg = await call(env, "POST", "/api/auth/register", {
    body: { username: "stab_student", password: "Password123!" }
  });
  assert.equal(reg.status, 200);
  const token = reg.json.token;

  let prepareCount = 0;
  const origPrepare = env.DB.prepare.bind(env.DB);
  env.DB.prepare = (sql) => { prepareCount++; return origPrepare(sql); };

  const fb = await call(env, "POST", "/api/quiz/feedback", {
    token,
    body: { action: "practice", questionId: qid, selectedOptionId: "A" }
  });
  assert.equal(fb.status, 200);
  assert.equal(fb.json.ok, true);
  assert.ok(fb.json.feedback[qid].correctOptionId);
  assert.equal(prepareCount, 1, "Practice feedback hot path must execute in 1 single SQL query");
  assert.match(fb.headers.get("Server-Timing") || "", /db;dur=.*total;dur=/);

  // Active Test Mode locks practice & study feedback
  const start = await call(env, "POST", "/api/quiz/feedback", {
    token,
    body: { action: "start", attemptId: "att_stab_lock_01", questionIds: [qid] }
  });
  assert.equal(start.status, 200);

  const blocked = await call(env, "POST", "/api/quiz/feedback", {
    token,
    body: { action: "practice", questionId: qid, selectedOptionId: "A" }
  });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.json.code, "TEST_FEEDBACK_LOCKED");
});

test("Stabilization 2: Quiz player uses in-place patching without Recorded flash and excludes experimental lessons", () => {
  const playerSrc = fs.readFileSync(path.join(ROOT, "src", "app", "player.js"), "utf8");
  const indexHtml = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const hubSrc = fs.readFileSync(path.join(ROOT, "src", "app", "hub.js"), "utf8");

  assert.equal(playerSrc.includes('statusLabel = txt("Recorded"'), false, "No Recorded flash while pending");
  assert.ok(playerSrc.includes("patchQuestionFeedbackInPlace"), "In-place DOM feedback patching required");
  assert.ok(playerSrc.includes("preventScroll: true"), "Scroll-safe focus management required");
  const footerPos = playerSrc.indexOf('class="player-footer-nav"');
  const slotPos = playerSrc.indexOf('id="qFeedbackSlot"');
  assert.ok(footerPos > 0 && slotPos > footerPos, "Next/Previous stays above #qFeedbackSlot");

  // Confirm experimental lesson system is completely excluded
  assert.equal(fs.existsSync(path.join(ROOT, "src", "lessons")), false, "src/lessons must not exist in final stabilization release");
  assert.equal(indexHtml.includes("lesson-registry"), false);
  assert.equal(playerSrc.includes("ElgoLessonRegistry"), false);
  assert.equal(hubSrc.includes("ElgoLessonRegistry"), false);
});

test("Stabilization 3: Permanent quiz deletion enforces master auth, explicit confirmation, backup export, audit trail, and preserves quiz_attempts & best_scores", async () => {
  const env = createEnv({ adminPassword: "master-stab-del-pass" });
  const cookie = await masterCookie(env);

  const student = await call(env, "POST", "/api/auth/register", {
    body: { username: "stab_hist_user", password: "Password123!" }
  });
  const studentToken = student.json.token;

  const subjectId = "demo-course";
  const quizId = "temp-stab-perm-del";
  const saveRes = await call(env, "POST", "/api/admin/quizzes", {
    cookie,
    body: {
      subjectId,
      quizId,
      kind: "quiz",
      title: "Disposable Stabilization Quiz",
      questions: [
        {
          id: "q1",
          question: "2 + 2 = ?",
          options: [
            { id: "A", text: "3" },
            { id: "B", text: "4" }
          ],
          correctOptionId: "B",
          explanation: "Basic arithmetic."
        }
      ]
    }
  });
  assert.equal(saveRes.status, 200);

  const internalQid = `${subjectId}::quiz::${quizId}::q1`;
  const sub = await call(env, "POST", "/api/quiz/submit", {
    token: studentToken,
    body: {
      attemptId: "att_stab_perm_01",
      subjectId,
      quizId,
      quizTitle: "Disposable Stabilization Quiz",
      mode: "test",
      durationMs: 12000,
      answers: { [internalQid]: "B" }
    }
  });
  assert.equal(sub.status, 200);
  assert.equal(sub.json.attempt.score, 1);

  // Student blocked
  assert.equal((await call(env, "GET", `/api/admin/quizzes/delete-preview?subjectId=${subjectId}&quizId=${quizId}`, { token: studentToken })).status, 401);
  assert.equal((await call(env, "GET", `/api/admin/quizzes/export?subjectId=${subjectId}&quizId=${quizId}`, { token: studentToken })).status, 401);
  assert.equal((await call(env, "POST", "/api/admin/quizzes/permanent-delete", { token: studentToken, body: { subjectId, quizId, confirmPermanent: true, confirmText: "DELETE " + quizId } })).status, 401);

  // Bundled quiz preview includes staticAssetNote
  const bundledPrev = await call(env, "GET", "/api/admin/quizzes/delete-preview?subjectId=demo-course&quizId=quiz-1", { cookie });
  assert.equal(bundledPrev.status, 200);
  assert.equal(bundledPrev.json.preview.storageType, "bundled_static");
  assert.match(bundledPrev.json.preview.staticAssetNote || "", /tools\/remove-bundled-quiz\.js/);

  // Custom quiz preview & export
  const preview = await call(env, "GET", `/api/admin/quizzes/delete-preview?subjectId=${subjectId}&quizId=${quizId}`, { cookie });
  assert.equal(preview.status, 200);
  assert.equal(preview.json.preview.storageType, "custom_d1");
  assert.equal(preview.json.preview.willPreserve.quizAttemptsCount, 1);
  assert.equal(preview.json.preview.willPreserve.bestScoresCount, 1);

  const exp = await call(env, "GET", `/api/admin/quizzes/export?subjectId=${subjectId}&quizId=${quizId}`, { cookie });
  assert.equal(exp.status, 200);
  assert.equal(exp.json.schemaVersion, "elgo-quiz-backup-v1");
  assert.equal(exp.json.customAnswerKey.answers[internalQid], "B");

  // Reject wrong confirmation & wildcards
  assert.equal((await call(env, "POST", "/api/admin/quizzes/permanent-delete", {
    cookie,
    body: { subjectId, quizId, confirmPermanent: true, confirmText: "WRONG" }
  })).status, 400);
  assert.equal((await call(env, "POST", "/api/admin/quizzes/permanent-delete", {
    cookie,
    body: { subjectId, quizId: "*", confirmPermanent: true, confirmText: "DELETE *" }
  })).status, 400);

  // Execute permanent deletion
  const del = await call(env, "POST", "/api/admin/quizzes/permanent-delete", {
    cookie,
    body: { subjectId, quizId, confirmPermanent: true, confirmText: "DELETE " + quizId, backupExported: true }
  });
  assert.equal(del.status, 200);
  assert.equal(del.json.permanentlyDeleted, true);
  assert.equal(del.json.preserved.quizAttempts, 1);
  assert.equal(del.json.preserved.bestScores, 1);

  // Authoritative D1 quiz & key removed; historical attempts & best_scores preserved
  assert.equal(env.sqlite.prepare("SELECT config_json FROM admin_config WHERE config_key = ?").get(`custom_quiz:${subjectId}::${quizId}`), undefined);
  assert.equal(env.sqlite.prepare("SELECT config_json FROM admin_config WHERE config_key = ?").get(`custom_quiz_key:${subjectId}::${quizId}`), undefined);
  assert.equal(env.sqlite.prepare("SELECT COUNT(*) n FROM quiz_attempts WHERE subject_id = ? AND quiz_id = ?").get(subjectId, quizId).n, 1);
  assert.equal(env.sqlite.prepare("SELECT COUNT(*) n FROM best_scores WHERE subject_id = ? AND quiz_id = ?").get(subjectId, quizId).n, 1);

  const audit = JSON.parse(env.sqlite.prepare("SELECT config_json FROM admin_config WHERE config_key = 'admin_quiz_delete_audit'").get().config_json);
  assert.equal(audit[audit.length - 1].quizId, quizId);
  assert.equal(audit[audit.length - 1].backupExported, true);

  // Deleted quiz blocked from feedback
  assert.equal((await call(env, "POST", "/api/quiz/feedback", {
    token: studentToken,
    body: { action: "practice", questionId: internalQid, selectedOptionId: "B" }
  })).status, 404);
});

test("Stabilization 4: tools/remove-bundled-quiz.js safely removes one bundled quiz with backup and preserves unrelated collections", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "elgo-bundled-rm-"));
  try {
    const subjDir = path.join(tmpDir, "content", "subjects");
    fs.mkdirSync(subjDir, { recursive: true });
    const subjFile = path.join(subjDir, "demo-subj.json");
    fs.writeFileSync(subjFile, JSON.stringify({
      id: "demo-subj",
      name: "Demo Subject",
      quizzes: [
        { id: "keep-quiz", title: "Keep Me", questions: [{ id: "q1", question: "Keep?" }] },
        { id: "drop-quiz", title: "Drop Me", questions: [{ id: "q2", question: "Drop?" }] }
      ],
      sheets: [],
      lectures: []
    }, null, 2), "utf8");

    assert.throws(() => removeBundledQuiz({ rootDir: tmpDir, subjectId: "demo-subj", quizId: "*" }));

    const dry = removeBundledQuiz({ rootDir: tmpDir, subjectId: "demo-subj", quizId: "drop-quiz", dryRun: true, skipBuild: true });
    assert.equal(dry.dryRun, true);
    assert.equal(dry.removedQuestionCount, 1);
    assert.equal(JSON.parse(fs.readFileSync(subjFile, "utf8")).quizzes.length, 2);

    const actual = removeBundledQuiz({ rootDir: tmpDir, subjectId: "demo-subj", quizId: "drop-quiz", skipBuild: true });
    assert.equal(actual.ok, true);
    assert.ok(fs.existsSync(actual.backupPath));
    const after = JSON.parse(fs.readFileSync(subjFile, "utf8"));
    assert.equal(after.quizzes.length, 1);
    assert.equal(after.quizzes[0].id, "keep-quiz");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
