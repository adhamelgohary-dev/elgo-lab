"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const worker = require("../backend/worker");
const { createEnv } = require("./helpers/d1-sqlite");

async function call(env, url, body, cookie) {
  const response = await worker.handleApiRequest(
    new Request("https://elgo.test" + url, {
      method: body ? "POST" : "GET",
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    }),
    env
  );
  return { status: response.status, data: await response.json(), response };
}

test("subject names persist centrally, preserve other overrides, and require admin authorization", async () => {
  const env = createEnv();
  assert.equal((await call(env, "/api/admin/subjects/name", { subjectId: "data-mining", name: "Changed" })).status, 401);
  const login = await call(env, "/api/admin/login", { password: "correct horse battery staple" });
  const cookie = login.response.headers.get("set-cookie").split(";")[0];
  assert.equal((await call(env, "/api/admin/subjects/name", { subjectId: "data-mining", name: "Data Science" }, cookie)).status, 200);
  assert.equal((await call(env, "/api/admin/subjects/name", { subjectId: "logic-number-systems", name: "Logic Studio" }, cookie)).status, 200);
  const result = await call(env, "/api/subject-names");
  assert.deepEqual(result.data.names, { "data-mining": "Data Science", "logic-number-systems": "Logic Studio" });
  assert.equal((await call(env, "/api/admin/subjects/name", { subjectId: "data-mining", name: "<script>bad</script>" }, cookie)).status, 400);
});

test("admin UI is lazy-loaded only on ?panel=admin and uses unified session & override routes", () => {
  const indexHtml = fs.readFileSync("index.html", "utf8");
  const mainJs = fs.readFileSync("src/app/main.js", "utf8");
  const adminJs = fs.readFileSync("src/app/admin.js", "utf8");
  const stateJs = fs.readFileSync("src/app/state.js", "utf8");

  assert.doesNotMatch(indexHtml, /src\/app\/admin\.js/);
  assert.match(mainJs, /ensureAdminLoaded/);
  assert.match(mainJs, /panel === "admin"/);
  assert.match(adminJs, /\/api\/admin\/session/);
  assert.match(adminJs, /\/api\/admin\/subjects\/name/);
  assert.match(stateJs, /\/api\/subject-names/);
  assert.match(stateJs, /\/api\/quiz-names/);
});

test("quiz names persist centrally, preserve other overrides, and require admin authorization", async () => {
  const env = createEnv();
  assert.equal((await call(env, "/api/admin/quizzes/name", { subjectId: "data-mining", quizId: "dm-midterm", name: "Changed" })).status, 401);
  const login = await call(env, "/api/admin/login", { password: "correct horse battery staple" });
  const cookie = login.response.headers.get("set-cookie").split(";")[0];
  assert.equal((await call(env, "/api/admin/quizzes/name", { subjectId: "data-mining", quizId: "dm-midterm", name: "Data Mining Midterm (2026)" }, cookie)).status, 200);
  assert.equal((await call(env, "/api/admin/quizzes/name", { subjectId: "logic-number-systems", quizId: "dl-midterm", name: "Logic Midterm" }, cookie)).status, 200);
  const result = await call(env, "/api/quiz-names");
  assert.deepEqual(result.data.names, {
    "data-mining::dm-midterm": "Data Mining Midterm (2026)",
    "logic-number-systems::dl-midterm": "Logic Midterm",
  });
  assert.equal((await call(env, "/api/admin/quizzes/name", { subjectId: "data-mining", quizId: "dm-midterm", name: "<script>bad</script>" }, cookie)).status, 400);
});
