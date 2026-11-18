"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createEnv } = require("./helpers/d1-sqlite");
const { buildPublicSite } = require("../tools/build");
const worker = require("../backend/worker");
const grading = require("../backend/answer-key");

test("generated question data contains prompts and options without grading or explanation payloads", (t) => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "elgo-release-assets-"));
  t.after(() => fs.rmSync(outDir, { recursive: true, force: true }));
  buildPublicSite({ outDir, skipAnswerKey: true });
  const assetDir = path.join(outDir, "data");
  for (const dir of ["subjects", "explanations"]) {
    for (const file of fs.readdirSync(path.join(assetDir, dir))) {
      const json = fs.readFileSync(path.join(assetDir, dir, file), "utf8");
      assert.doesNotMatch(json, /"(?:correctOptionId|correctAnswerText|correctAnswer|explanation|explanationArabic|academicExplanation|correctReasoning|wrongAnswerClarification|memoryTrick|teachingReview)"\s*:/);
    }
  }
  assert.equal(fs.existsSync(path.join(outDir, "backend")), false);
  assert.match(fs.readFileSync(path.join(outDir, "sw.js"), "utf8"), /pathname\.startsWith\("\/api\/"\)\) return/);
});

test("authorized feedback respects Study, Practice and the active Test gate", async () => {
  const env = createEnv();
  const call = (route, body, token) => worker.handleApiRequest(new Request("https://elgo.test" + route, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: JSON.stringify(body),
  }), env);
  const register = async (username) => (await (await call("/api/auth/register", { username, password: "StrongLocal355!" })).json()).token;
  const a = await register("Ahmed Salem");
  const b = await register("Mona Adel");
  assert.ok(a && b);
  const [questionId, key] = Object.entries(grading.byInternalId)[0];
  const submit = { attemptId: "release_test_01", subjectId: key.subjectId, quizId: key.collectionId, mode: "test", durationMs: 5000, answers: { [questionId]: key.correctOptionId } };
  const feedback = (action, token, extra = {}) => call("/api/quiz/feedback", { action, questionId, attemptId: submit.attemptId, ...extra }, token);
  assert.equal((await feedback("study")).status, 401);
  assert.equal((await feedback("practice", a)).status, 400);
  const study = await feedback("study", a);
  assert.equal(study.headers.get("cache-control"), "no-store");
  assert.ok((await study.json()).feedback[questionId].correctOptionId);
  assert.equal((await feedback("practice", a, { selectedOptionId: "A" })).status, 200);
  assert.equal((await feedback("start", a, { questionIds: [questionId] })).status, 200);
  for (const action of ["study", "practice", "review"]) {
    const response = await feedback(action, a, { selectedOptionId: "A" });
    assert.equal(response.status, 403);
    assert.equal(Object.hasOwn(await response.json(), "feedback"), false);
  }
  assert.equal((await feedback("review", b)).status, 403);
  assert.equal((await call("/api/quiz/submit", submit, a)).status, 200);
  const review = await feedback("review", a);
  assert.ok((await review.json()).feedback[questionId].correctOptionId);
  assert.equal((await feedback("review", b)).status, 403);
});
