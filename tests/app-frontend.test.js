"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const { startServer } = require("../tools/dev-server");

const ROOT = path.resolve(__dirname, "..");

function createMemoryStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    keys: () => Array.from(store.keys()),
  };
}

function loadAppScript(relPath, extraGlobals) {
  const docEl = { dataset: {}, style: {}, lang: "en", dir: "ltr" };
  const doc = {
    documentElement: docEl,
    readyState: "complete",
    addEventListener() {},
    dispatchEvent() {},
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const win = {
    location: { search: "", origin: "http://127.0.0.1:4183", pathname: "/", protocol: "http:" },
    CustomEvent: function (t) { this.type = t; },
    addEventListener() {},
  };
  const ctx = vm.createContext(Object.assign({
    window: win,
    globalThis: win,
    document: doc,
    location: win.location,
    URLSearchParams,
    localStorage: createMemoryStorage(),
    sessionStorage: createMemoryStorage(),
    Math,
    Date,
    JSON,
    Set,
    Map,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Promise,
    Error,
    RegExp,
    TextEncoder,
    TextDecoder,
    encodeURIComponent,
    decodeURIComponent,
    btoa: (s) => Buffer.from(s, "binary").toString("base64"),
    atob: (s) => Buffer.from(s, "base64").toString("binary"),
  }, extraGlobals || {}));
  win.window = win;
  const code = fs.readFileSync(path.join(ROOT, relPath), "utf8");
  vm.runInContext(code, ctx, { filename: relPath });
  return { win, docEl, ctx };
}

test("all src/app modules parse cleanly and avoid inline HTML event handlers", () => {
  const files = fs.readdirSync(path.join(ROOT, "src/app")).filter((f) => f.endsWith(".js"));
  assert.ok(files.length >= 11);
  for (const f of files) {
    const code = fs.readFileSync(path.join(ROOT, "src/app", f), "utf8");
    new vm.Script(code, { filename: `src/app/${f}` });
    assert.doesNotMatch(code, /\bon(?:click|change|submit|input)\s*=\s*["'][^"']*\(/i, `Avoid inline DOM handler in ${f}`);
  }
});

test("ElgoTheme manages daylight/evening themes, Arabic RTL direction, and motion pause cleanly", () => {
  const storage = createMemoryStorage();
  const { win, docEl } = loadAppScript("src/app/theme.js", { localStorage: storage });
  const Theme = win.ElgoTheme;

  assert.equal(Theme.getTheme(), "evening");
  assert.equal(Theme.toggleTheme(), "daylight");
  assert.equal(docEl.dataset.theme, "daylight");
  assert.equal(storage.getItem("elgo_theme"), "daylight");

  assert.equal(Theme.toggleLang(), "ar");
  assert.equal(docEl.lang, "ar");
  assert.equal(docEl.dir, "rtl");

  Theme.setMotionPaused(true);
  assert.equal(Theme.isMotionPaused(), true);
});

test("ElgoModel shuffles displayed options while keeping canonical IDs intact for ranked grading", () => {
  const { win } = loadAppScript("src/app/model.js");
  const Model = win.ElgoModel;

  const subject = { id: "logic-number-systems", name: "Digital Logic" };
  const questions = [
    {
      id: "Q1",
      internalId: "logic-number-systems::quiz::logic-fundamentals::Q1",
      question: "Sample",
      options: [
        { id: "A", text: "One" },
        { id: "B", text: "Two" },
        { id: "C", text: "Three" },
        { id: "D", text: "Four" },
      ],
      correctOptionId: "C",
    },
  ];

  const spec = Model.buildSessionSpec({
    subject,
    questions,
    sourceIds: ["logic-number-systems::quiz::logic-fundamentals"],
    mode: "test",
    shuffleOptions: true,
  });

  assert.equal(spec.mode, "test");
  assert.equal(spec.isGradableCollection, true);
  assert.equal(spec.collectionId, "logic-fundamentals");
  const optC = spec.questions[0].options.find((o) => o.text === "Three");
  assert.equal(optC.id, "C", "Original option ID must stay 'C' regardless of shuffled position");

  const token = Model.encodeChallenge({ subjectId: subject.id, sourceIds: spec.sourceIds, score: 1, total: 1 });
  const decoded = Model.decodeChallenge(token);
  assert.equal(decoded.subjectId, "logic-number-systems");
  assert.equal(decoded.score, 1);
});

test("ElgoState uses clean elgo_* keys and loads lazy subjects and explanations cleanly", async () => {
  const storage = createMemoryStorage();
  const mockFetch = async (url) => {
    if (String(url).includes("/data/catalog.json")) {
      return {
        ok: true,
        json: async () => ({ schemaVersion: 1, subjects: [{ id: "dm", name: "Data Mining", nameAr: "تنقيب" }], sources: [], lectures: [], resources: [] }),
      };
    }
    if (String(url).includes("/data/subjects/dm.json")) {
      return {
        ok: true,
        json: async () => ({ id: "dm", name: "Data Mining", quizzes: [{ id: "q1", questions: [{ id: "Q1", question: "Test?", options: [{ id: "A", text: "Yes" }], correctOptionId: "A" }] }] }),
      };
    }
    if (String(url).includes("/data/explanations/dm.json")) {
      return {
        ok: true,
        json: async () => ({ byInternalId: { "dm::quiz::q1::Q1": { academicExplanation: "Because", arabicExplanation: "لأن" } } }),
      };
    }
    return { ok: false, status: 404 };
  };

  const { win } = loadAppScript("src/app/state.js", { localStorage: storage, fetch: mockFetch });
  // Load model helper onto win too so normalizeCatalog executes cleanly
  const modelCode = fs.readFileSync(path.join(ROOT, "src/app/model.js"), "utf8");
  vm.runInNewContext(modelCode, Object.assign(win, { window: win }));

  const cat = await win.ElgoState.loadCatalog();
  assert.equal(cat.subjects[0].id, "dm");
  const qs = await win.ElgoState.loadQuestionsForSources("dm", ["dm::quiz::q1"]);
  assert.equal(qs.length, 1);
  assert.equal(qs[0].internalId, "dm::quiz::q1::Q1");
  const exps = await win.ElgoState.loadSubjectExplanations("dm");
  assert.equal(exps["dm::quiz::q1::Q1"].academicExplanation, "Because");

  win.ElgoState.toggleBookmark(qs[0], { subjectName: "Data Mining" });
  assert.equal(win.ElgoState.isBookmarked("dm::quiz::q1::Q1"), true);
  assert.ok(storage.keys().every((k) => k.startsWith("elgo_")), "All persisted keys must use clean elgo_* naming");
});

test("dev-server serves unified SPA, lazy bundles, lecture pages, PDFs, and end-to-end API flow", async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "elgo-e2e-public-"));
  const { server, port, adminPassword } = await startServer({ port: 0, publicDir: outDir, skipAnswerKey: true, quiet: true });
  const base = `http://127.0.0.1:${port}`;

  try {
    // 1. Unified SPA HTML + Strict CSP + All linked CSS/JS/img/manifest assets resolve cleanly
    const homeRes = await fetch(`${base}/?flow=hub`);
    assert.equal(homeRes.status, 200);
    assert.match(homeRes.headers.get("content-security-policy") || "", /script-src 'self'/);
    const homeHtml = await homeRes.text();
    assert.match(homeHtml, /src="\/src\/app\/main\.js"/);
    assert.doesNotMatch(homeHtml, /\/engine\//);

    for (const m of homeHtml.matchAll(/(?:src|href)="(\/[^"#?]+)"/g)) {
      const assetPath = m[1];
      if (assetPath === "/") continue;
      const assetRes = await fetch(`${base}${assetPath}`);
      assert.equal(assetRes.status, 200, `Linked asset failed: ${assetPath}`);
    }

    // 2. Catalog, Subject JSON, Lazy Explanations, Lecture Page, PDF
    const catRes = await fetch(`${base}/data/catalog.json`);
    assert.equal(catRes.status, 200);
    const catalog = await catRes.json();
    assert.equal(catalog.subjects.length, 1);
    assert.equal(catalog.visualizations, undefined);

    const subjRes = await fetch(`${base}/data/subjects/demo-course.json`);
    assert.equal(subjRes.status, 200);
    const subjData = await subjRes.json();
    const quiz1 = subjData.quizzes.find((q) => q.id === "quiz-1");
    assert.equal(quiz1.questions.length, 6);

    const expRes = await fetch(`${base}/data/explanations/demo-course.json`);
    assert.equal(expRes.status, 200);
    const expData = await expRes.json();
    assert.ok(Object.keys(expData.byInternalId).length >= 10);

    const lecRes = await fetch(`${base}/learn/demo-course/lecture-1/`);
    assert.equal(lecRes.status, 200);
    assert.match(await lecRes.text(), /Bits, logic and algorithms/i);

    const pdfMeta = catalog.resources.find((r) => r.path);
    const pdfRes = await fetch(`${base}/${pdfMeta.path.replace(/^\/+/, "")}`);
    assert.equal(pdfRes.status, 200);
    assert.match(await pdfRes.text(), /^%PDF-/);

    // 3. API Health + Register + Ranked Quiz Submit + Leaderboard + Report + Admin Moderation
    const health = await fetch(`${base}/api/health`).then((r) => r.json());
    assert.equal(health.ok, true);

    const regRes = await fetch(`${base}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: base },
      body: JSON.stringify({ username: "e2e_learner", password: "secure-password-123" }),
    });
    assert.equal(regRes.status, 200);
    const regData = await regRes.json();
    assert.ok(regData.token);

    const answerMap = {};
    quiz1.questions.forEach((q) => { answerMap[q.internalId] = q.correctOptionId; });

    const submitRes = await fetch(`${base}/api/quiz/submit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: base,
        Authorization: `Bearer ${regData.token}`,
      },
      body: JSON.stringify({
        attemptId: "att_e2e_unique_0001",
        subjectId: "demo-course",
        quizId: "quiz-1",
        quizTitle: quiz1.title,
        mode: "test",
        durationMs: 45000,
        answers: answerMap,
      }),
    });
    assert.equal(submitRes.status, 200);
    const submitData = await submitRes.json();
    assert.equal(submitData.attempt.percentage, 100);
    assert.equal(submitData.attempt.countedInRanking, true);

    const lbRes = await fetch(`${base}/api/leaderboard`, { headers: { Authorization: `Bearer ${regData.token}` } });
    const lbData = await lbRes.json();
    assert.equal(lbData.entries[0].username, "e2e_learner");
    assert.equal(lbData.entries[0].isMe, true);

    const repRes = await fetch(`${base}/api/questions/report`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: base,
        Authorization: `Bearer ${regData.token}`,
      },
      body: JSON.stringify({
        subjectId: "demo-course",
        quizId: "quiz-1",
        questionId: quiz1.questions[0].id,
        questionText: quiz1.questions[0].question,
        reason: "typo",
        details: "E2E report verification",
      }),
    });
    assert.equal(repRes.status, 200);
    const repData = await repRes.json();

    const admLoginRes = await fetch(`${base}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: base },
      body: JSON.stringify({ password: adminPassword }),
    });
    assert.equal(admLoginRes.status, 200);
    const cookie = admLoginRes.headers.get("set-cookie").split(";")[0];

    const listRepRes = await fetch(`${base}/api/admin/reports?status=open`, { headers: { Cookie: cookie } });
    const listRepData = await listRepRes.json();
    assert.equal(listRepData.reports.some((r) => r.id === repData.report.id), true);

    const resRepRes = await fetch(`${base}/api/admin/reports/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: base, Cookie: cookie },
      body: JSON.stringify({ id: repData.report.id, status: "resolved", resolutionNote: "Verified cleanly" }),
    });
    assert.equal(resRepRes.status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

test("ElgoState wires ContentLibrary, OnlineClient, MistakesStore, Presence, and ExplanationPresenter with elgo_* storage keys", async () => {
  const storage = createMemoryStorage();
  const attemptsSubmitted = [];
  let failSubmit = true;

  const mockFetch = async (url, init) => {
    const u = String(url);
    if (u.includes("/data/catalog.json")) {
      return {
        ok: true,
        json: async () => ({
          schemaVersion: 2,
          subjects: [{ id: "dm", name: "Data Mining", nameAr: "تنقيب" }],
          sources: [],
          lectures: [],
          resources: [
            { id: "pdf-1", type: "pdf", subjectId: "dm", title: "Note 1", active: true },
            { id: "vid-1", type: "video", subjectId: "dm", title: "Video 1", youtubeId: "dQw4w9WgXcQ", active: true },
          ],
        }),
      };
    }
    if (u.includes("/api/content/overrides")) {
      return { ok: true, json: async () => ({ settings: {}, contentOverrides: null, quizTitles: {} }) };
    }
    if (u.includes("/api/quiz/submit")) {
      if (failSubmit) throw new Error("network down");
      const parsed = JSON.parse((init && init.body) || "{}");
      attemptsSubmitted.push(parsed);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          attempt: {
            id: parsed.attemptId || "att_1",
            subjectId: parsed.subjectId,
            quizId: parsed.quizId,
            score: parsed.score || 1,
            total: parsed.total || 1,
            percentage: parsed.percentage || 100,
            mode: parsed.mode || "practice",
            countedInRanking: false,
            statusMessage: "Synced",
          },
        }),
      };
    }
    if (u.includes("/api/presence")) {
      return { ok: true, status: 200, json: async () => ({ ok: true, online: 7 }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };

  const nav = { onLine: true };
  const { win, ctx } = loadAppScript("src/core/content-library.js", {
    localStorage: storage,
    fetch: mockFetch,
    navigator: nav,
    setTimeout,
    clearTimeout,
  });
  for (const rel of [
    "src/core/mistakes-store.js",
    "src/core/online-client.js",
    "src/core/presence.js",
    "src/core/explanation-presenter.js",
    "src/app/model.js",
    "src/app/state.js",
  ]) {
    const code = fs.readFileSync(path.join(ROOT, rel), "utf8");
    vm.runInContext(code, ctx, { filename: rel });
  }

  await win.ElgoState.loadCatalog();
  const lib = win.ElgoState.getContentLibrary();
  assert.ok(lib && typeof lib.getVideos === "function" && typeof lib.getPdfs === "function");
  assert.equal(lib.getVideos("", { includeInactive: true, includeArchived: true }).length, 1);
  assert.equal(lib.getPdfs("", true, true).length, 1);

  win.ElgoState.recordMistake(
    { id: "Q1", internalId: "dm::quiz::q1::Q1", question: "Sample?", correctOptionId: "A" },
    "B",
    { subjectId: "dm", subjectName: "Data Mining", collectionId: "q1" }
  );
  assert.equal(win.ElgoState.getMistakes("dm").length, 1);
  const deck = win.ElgoState.getSmartReviewDeck("dm", { shuffleQuestions: false });
  assert.equal(deck.length, 1);
  win.ElgoState.resolveMistake("dm::quiz::q1::Q1");
  assert.equal(win.ElgoState.getMistakes("dm", { status: "unresolved" }).length, 0);
  win.ElgoState.reopenMistake("dm::quiz::q1::Q1");
  assert.equal(win.ElgoState.getMistakes("dm", { status: "unresolved" }).length, 1);

  win.ElgoState.setAuth({ token: "test-token", profile: { username: "tester" } });
  const client = win.ElgoState.getOnlineClient();
  assert.ok(client && typeof client.syncPendingAttempts === "function");
  const queued = await client.submitQuizAttempt({
    attemptId: "att_offline_1",
    subjectId: "dm",
    quizId: "q1",
    mode: "practice",
    score: 1,
    total: 1,
    percentage: 100,
    answers: { "dm::quiz::q1::Q1": "A" },
  });
  assert.equal(queued.pending, true);
  failSubmit = false;
  const syncRes = await win.ElgoState.syncPendingAttempts();
  assert.ok(syncRes.synced >= 1);
  assert.equal(attemptsSubmitted.length, 1);
  assert.equal(attemptsSubmitted[0].attemptId, "att_offline_1");

  let sawCount = null;
  let resolveCount;
  const countPromise = new Promise((r) => { resolveCount = r; });
  const pcOnline = win.BankQuestionCore.Presence.createPresenceClient({
    fetchImpl: mockFetch,
    onCount: (n) => { sawCount = n; resolveCount(); },
  });
  pcOnline.start();
  await countPromise;
  pcOnline.stop();
  assert.equal(sawCount, 7);

  let sawOffline = null;
  let resolveOffline;
  const offlinePromise = new Promise((r) => { resolveOffline = r; });
  nav.onLine = false;
  const pcOffline = win.BankQuestionCore.Presence.createPresenceClient({
    fetchImpl: mockFetch,
    onUnavailable: (off) => { sawOffline = off; resolveOffline(); },
  });
  pcOffline.start();
  await offlinePromise;
  pcOffline.stop();
  assert.equal(sawOffline, true);

  assert.equal(win.BankQuestionCore.ExplanationPresenter, win.ElgoExplanations);
  assert.ok(storage.keys().every((k) => k.startsWith("elgo_")), `Unexpected storage key: ${storage.keys().join(", ")}`);
});

test("ElgoShell banner sanitization, frontend/backend route parity, SW core assets, and Wrangler resolution", () => {
  const hostEl = { innerHTML: "" };
  const mockState = {
    _settings: { bannerText: "Midterm Update", bannerUrl: "https://example.com/guide", bannerVisible: true },
    getSiteSettings: () => mockState._settings,
    t: (k) => k,
    getState: () => ({}),
    getAuth: () => null,
    getCatalog: () => ({ subjects: [] }),
    getMistakes: () => [],
  };
  const ctxGlobals = {
    ElgoState: mockState,
    ElgoTheme: { getLang: () => "en", getTheme: () => "evening" },
  };
  const { win, ctx } = loadAppScript("src/app/theme.js");
  ctx.document.getElementById = (id) => (id === "siteBannerHost" ? hostEl : null);
  Object.assign(win, ctxGlobals);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "src/app/shell.js"), "utf8"), ctx, { filename: "src/app/shell.js" });

  win.ElgoShell.renderSiteBanner();
  assert.match(hostEl.innerHTML, /Midterm Update/);
  assert.match(hostEl.innerHTML, /href="https:\/\/example\.com\/guide"/);

  mockState._settings = { bannerText: "XSS Test", bannerUrl: "javascript:alert(1)", bannerVisible: true };
  win.ElgoShell.renderSiteBanner();
  assert.match(hostEl.innerHTML, /XSS Test/);
  assert.doesNotMatch(hostEl.innerHTML, /javascript:/);

  mockState._settings = { bannerText: "Hidden", bannerVisible: false };
  win.ElgoShell.renderSiteBanner();
  assert.equal(hostEl.innerHTML, "");

  const panelsCode = fs.readFileSync(path.join(ROOT, "src/app/panels.js"), "utf8");
  assert.doesNotMatch(panelsCode, /\/api\/auth\/(?:rename|delete)/);
  assert.match(panelsCode, /\/api\/user\/profile/);

  const playerCode = fs.readFileSync(path.join(ROOT, "src/app/player.js"), "utf8");
  assert.match(playerCode, /isGradableCollection:\s*session\.isGradableCollection/);
  assert.match(playerCode, /value="incorrect_answer"/);
  assert.match(playerCode, /value="missing_image"/);

  const swCode = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  const { buildPublicSite } = require("../tools/build");
  const tmpOut = fs.mkdtempSync(path.join(os.tmpdir(), "elgo-sw-"));
  try {
    buildPublicSite({ outDir: tmpOut, skipAnswerKey: true });
    for (const rel of [
      "/src/core/content-library.js",
      "/src/core/online-client.js",
      "/src/core/presence.js",
      "/src/app/admin.js",
      "/data/search-index.json",
    ]) {
      assert.ok(swCode.includes(`"${rel}"`), `sw.js CORE_ASSETS must include ${rel}`);
      assert.ok(fs.existsSync(path.join(tmpOut, rel.slice(1))), `Built public/ must contain ${rel}`);
    }
  } finally {
    fs.rmSync(tmpOut, { recursive: true, force: true });
  }

  const { resolveWranglerTarget } = require("../tools/admin-password");
  const tmpCfg = fs.mkdtempSync(path.join(os.tmpdir(), "elgo-wrangler-"));
  try {
    fs.writeFileSync(path.join(tmpCfg, "wrangler.example.toml"), 'name = "example-site"\ndatabase_name = "example_db"\n', "utf8");
    const ex = resolveWranglerTarget(tmpCfg);
    assert.deepEqual(ex, { project: "example-site", db: "example_db" });

    fs.writeFileSync(path.join(tmpCfg, "wrangler.toml"), 'name = "custom-prod"\ndatabase_name = "custom_prod_db"\n', "utf8");
    const live = resolveWranglerTarget(tmpCfg);
    assert.deepEqual(live, { project: "custom-prod", db: "custom_prod_db" });
  } finally {
    fs.rmSync(tmpCfg, { recursive: true, force: true });
  }
});

test("demo content has unique prompts, valid answers and an original PDF", () => {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, "content/subjects/demo-course.json"), "utf8"));
  const qs = [...data.quizzes.flatMap(q => q.questions), ...data.lectures.flatMap(l => l.generatedQuiz.questions), ...data.sheets.flatMap(s => s.questions)];
  assert.equal(qs.length, 12);
  assert.equal(new Set(qs.map(q => q.question.toLowerCase())).size, 12);
  for (const q of qs) assert.ok(q.options.some(o => o.id === q.correctOptionId));
  const raw = fs.readFileSync(path.join(ROOT, "content/pdfs/demo-notes.pdf"), "latin1");
  assert.match(raw, /^%PDF-/);
  assert.match(raw, /Elgo Lab/);
});

test("self-hosted node-server persists SQLite + Disk files across restarts, supports live quizzes & hard deletes", async () => {
  const { startNodeServer } = require("../tools/node-server");
  const { hashAdminPassword } = require("../tools/admin-password");
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "elgo-selfhost-"));
  const adminPassword = "SelfHost!StrongPassword99";
  const adminPasswordHash = hashAdminPassword(adminPassword, 100000);

  let srv = await startNodeServer({
    port: 0,
    host: "127.0.0.1",
    dataDir,
    adminPasswordHash,
    skipBuild: false,
    skipDotEnv: true,
    quiet: true,
  });

  try {
    let base = `http://127.0.0.1:${srv.port}`;

    // 1. Admin login with hashed secret + diagnostics check
    const loginRes = await fetch(`${base}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: adminPassword }),
    });
    assert.equal(loginRes.status, 200);
    const cookie = loginRes.headers.get("set-cookie").split(";")[0];

    const diagRes = await fetch(`${base}/api/admin/diagnostics`, { headers: { Cookie: cookie } });
    const diag = await diagRes.json();
    assert.equal(diag.ok, true);
    assert.equal(diag.storageMode, "self-hosted-sqlite");
    assert.equal(diag.d1Bound, true);
    assert.equal(diag.r2Bound, true);

    // 2. Create custom course
    const subRes = await fetch(`${base}/api/admin/subjects`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        id: "operating-systems",
        name: "Operating Systems",
        nameAr: "نظم التشغيل",
        description: "Processes, threads, scheduling, virtual memory",
      }),
    });
    assert.equal(subRes.status, 200);

    // 3. Publish live quiz with EN/AR explanations & rule
    const quizRes = await fetch(`${base}/api/admin/quizzes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        subjectId: "operating-systems",
        quizId: "os-midterm-live",
        kind: "quiz",
        title: "OS Midterm Practice",
        questions: [
          {
            id: "Q1",
            question: "Which state holds processes waiting for CPU?",
            options: [{ id: "A", text: "Blocked" }, { id: "B", text: "Ready" }],
            correctOptionId: "B",
            explanation: "Ready queue holds runnable processes waiting for dispatch.",
            explanationArabic: "طابور الاستعداد يحتفظ بالعمليات الجاهزة للتنفيذ.",
            rule: "Runnable != Waiting on I/O.",
          },
          {
            id: "Q2",
            question: "TLB is a cache for what?",
            options: [{ id: "A", text: "Page table entries" }, { id: "B", text: "Disk blocks" }],
            correctOptionId: "A",
            explanation: "Translation Lookaside Buffer caches virtual-to-physical mappings.",
          },
        ],
      }),
    });
    assert.equal(quizRes.status, 200);

    // 4. Upload real %PDF- file
    const pdfPayload = Buffer.from("%PDF-1.4\n1 0 obj <<>> endobj\ntrailer <<>>\n%%EOF\n");
    const upRes = await fetch(`${base}/api/admin/r2/upload?subjectId=operating-systems&title=OS%20Notes&category=summaries`, {
      method: "POST",
      headers: { "Content-Type": "application/pdf", "Content-Length": String(pdfPayload.length), Cookie: cookie },
      body: pdfPayload,
    });
    assert.equal(upRes.status, 200);
    const upJson = await upRes.json();
    assert.ok(upJson.pdf && upJson.pdf.url.startsWith("/api/r2/pdfs/operating-systems/"));

    // 5. Register student & submit ranked attempt on custom live quiz
    const regRes = await fetch(`${base}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "tarik_os", password: "StrongPassword123!" }),
    });
    assert.equal(regRes.status, 200);
    const regJson = await regRes.json();

    const subQuizRes = await fetch(`${base}/api/quiz/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${regJson.token}` },
      body: JSON.stringify({
        attemptId: "att_live_custom_0001",
        subjectId: "operating-systems",
        quizId: "os-midterm-live",
        quizTitle: "OS Midterm Practice",
        mode: "test",
        durationMs: 12000,
        answers: {
          "operating-systems::quiz::os-midterm-live::Q1": "B",
          "operating-systems::quiz::os-midterm-live::Q2": "A",
        },
      }),
    });
    assert.equal(subQuizRes.status, 200);
    const subQuizJson = await subQuizRes.json();
    assert.equal(subQuizJson.attempt.score, 2);
    assert.equal(subQuizJson.attempt.total, 2);
    assert.equal(subQuizJson.attempt.countedInRanking, true);

    // Submit a question report so we can verify hard delete of report too
    const repRes = await fetch(`${base}/api/questions/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${regJson.token}` },
      body: JSON.stringify({
        subjectId: "operating-systems",
        quizId: "os-midterm-live",
        questionId: "Q1",
        reason: "typo",
        details: "Test report",
      }),
    });
    assert.equal(repRes.status, 200);
    const repJson = await repRes.json();

    // 6. Restart server against SAME dataDir and confirm SQLite + disk PDF persistence
    await srv.close();
    srv = await startNodeServer({
      port: 0,
      host: "127.0.0.1",
      dataDir,
      adminPasswordHash,
      skipBuild: true,
      skipDotEnv: true,
      quiet: true,
    });
    base = `http://127.0.0.1:${srv.port}`;

    const dynRes = await fetch(`${base}/api/catalog/dynamic?subjectId=operating-systems`);
    const dyn = await dynRes.json();
    assert.ok(dyn.customSubjects["operating-systems"]);
    assert.equal(dyn.subjectQuizzes.length, 1);
    assert.equal(dyn.subjectQuizzes[0].questions[0].explanationArabic, "طابور الاستعداد يحتفظ بالعمليات الجاهزة للتنفيذ.");

    const pdfFetchRes = await fetch(`${base}${upJson.pdf.url}`);
    assert.equal(pdfFetchRes.status, 200);
    assert.equal((await pdfFetchRes.text()).startsWith("%PDF-1.4"), true);

    const lbRes = await fetch(`${base}/api/leaderboard?subjectId=operating-systems`);
    const lb = await lbRes.json();
    assert.equal(lb.entries.length, 1);
    assert.equal(lb.entries[0].username, "tarik_os");

    // Re-authenticate admin & test true hard deletes across R2 PDF, report, quiz, and course
    const reLogin = await fetch(`${base}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: adminPassword }),
    });
    const cookie2 = reLogin.headers.get("set-cookie").split(";")[0];

    const delPdfRes = await fetch(`${base}/api/admin/r2/file`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Cookie: cookie2 },
      body: JSON.stringify({ id: upJson.pdf.id, path: upJson.pdf.url }),
    });
    assert.equal(delPdfRes.status, 200);
    assert.equal((await fetch(`${base}${upJson.pdf.url}`)).status, 404);

    const delRepRes = await fetch(`${base}/api/admin/reports?id=${encodeURIComponent(repJson.report.id)}`, {
      method: "DELETE",
      headers: { Cookie: cookie2 },
    });
    assert.equal(delRepRes.status, 200);

    const delQuizRes = await fetch(`${base}/api/admin/quizzes`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Cookie: cookie2 },
      body: JSON.stringify({ subjectId: "operating-systems", quizId: "os-midterm-live" }),
    });
    assert.equal(delQuizRes.status, 200);

    const delSubRes = await fetch(`${base}/api/admin/subjects`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Cookie: cookie2 },
      body: JSON.stringify({ subjectId: "operating-systems" }),
    });
    assert.equal(delSubRes.status, 200);

    const dynAfter = await (await fetch(`${base}/api/catalog/dynamic`)).json();
    assert.equal(Boolean(dynAfter.customSubjects["operating-systems"]), false);
    assert.equal(dynAfter.customQuizzes.length, 0);
  } finally {
    await srv.close().catch(() => {});
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("admin UX uses modal dialogs, separated PDFs/Videos tabs, AI prompt cards, and ships self-hosting docs", () => {
  const adminJs = fs.readFileSync(path.join(ROOT, "src/app/admin.js"), "utf8");
  assert.doesNotMatch(adminJs, /\bwindow\.(prompt|confirm|alert)\b/);
  assert.match(adminJs, /PROMPT_TEMPLATES/);
  assert.match(adminJs, /data-lib-tab="pdfs"/);
  assert.match(adminJs, /data-lib-tab="videos"/);
  assert.match(adminJs, /\/api\/admin\/subjects/);
  assert.match(adminJs, /\/api\/admin\/quizzes/);
  assert.match(adminJs, /\/api\/admin\/r2\/file/);
  assert.match(adminJs, /\/api\/admin\/reports/);

  assert.ok(fs.existsSync(path.join(ROOT, "docs/PROMPTS.md")));
  assert.ok(fs.existsSync(path.join(ROOT, "Dockerfile")));
  assert.ok(fs.existsSync(path.join(ROOT, "docker-compose.yml")));
  assert.ok(fs.existsSync(path.join(ROOT, ".env.example")));
});

test("ElgoState merges custom courses/quizzes, filters deleted items, and loads custom subjects cleanly", async () => {
  const storage = createMemoryStorage();
  const mockFetch = async (url) => {
    const u = String(url);
    if (u.includes("/data/catalog.json")) {
      return {
        ok: true,
        json: async () => ({
          schemaVersion: 1,
          subjects: [
            { id: "dm", name: "Data Mining", counts: { quizzes: 1, sheets: 0, lectures: 0, totalQuestions: 10 } },
            { id: "removed-subj", name: "Old Subject", counts: { quizzes: 1, sheets: 0, lectures: 0, totalQuestions: 5 } },
          ],
          sources: [
            { id: "dm::quiz::q1", collectionId: "q1", subjectId: "dm", kind: "quiz", title: "Q1", questionCount: 10 },
            { id: "dm::quiz::q-del", collectionId: "q-del", subjectId: "dm", kind: "quiz", title: "Deleted", questionCount: 5 },
          ],
          lectures: [],
          resources: [],
        }),
      };
    }
    if (u.includes("/api/catalog/dynamic?subjectId=os-custom")) {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          deletedQuizKeys: [],
          subjectQuizzes: [
            {
              id: "os-1",
              subjectId: "os-custom",
              kind: "quiz",
              title: "OS Live Quiz",
              questions: [
                {
                  id: "Q1",
                  internalId: "os-custom::quiz::os-1::Q1",
                  question: "What is a PCB?",
                  options: [{ id: "A", text: "Process Control Block" }, { id: "B", text: "Printed Circuit Board" }],
                  correctOptionId: "A",
                  explanation: "Kernel struct for a process.",
                  explanationArabic: "سجل بيانات العملية.",
                  rule: "One PCB per process.",
                },
              ],
            },
          ],
        }),
      };
    }
    if (u.includes("/api/catalog/dynamic")) {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          customSubjects: {
            "os-custom": { id: "os-custom", name: "Operating Systems", nameAr: "نظم التشغيل" },
          },
          deletedSubjectIds: ["removed-subj"],
          customQuizzes: [
            { subjectId: "os-custom", quizId: "os-1", kind: "quiz", title: "OS Live Quiz", questionCount: 1, gradableCount: 1 },
          ],
          deletedQuizKeys: ["dm::q-del"],
        }),
      };
    }
    if (u.includes("/api/subject-names") || u.includes("/api/quiz-names")) {
      return { ok: true, json: async () => ({ ok: true, names: {} }) };
    }
    if (u.includes("/api/site-settings")) {
      return { ok: true, json: async () => ({ ok: true, settings: {} }) };
    }
    if (u.includes("/api/content/overrides")) {
      return { ok: true, json: async () => ({ ok: true, overrides: null }) };
    }
    return { ok: false, status: 404, json: async () => ({ ok: false }) };
  };

  const { win } = loadAppScript("src/app/state.js", { localStorage: storage, fetch: mockFetch });
  const modelCode = fs.readFileSync(path.join(ROOT, "src/app/model.js"), "utf8");
  vm.runInNewContext(modelCode, Object.assign(win, { window: win }));

  const cat = await win.ElgoState.loadCatalog(true);
  assert.equal(cat.subjects.some((s) => s.id === "removed-subj"), false);
  const dm = cat.subjects.find((s) => s.id === "dm");
  const os = cat.subjects.find((s) => s.id === "os-custom");
  assert.ok(dm && os);
  assert.equal(dm.counts.totalQuestions, 10);
  assert.equal(os.counts.quizzes, 1);
  assert.equal(os.counts.totalQuestions, 1);
  assert.equal(cat.sources.some((s) => s.collectionId === "q-del"), false);

  const osQs = await win.ElgoState.loadQuestionsForSources("os-custom", ["os-custom::quiz::os-1"]);
  assert.equal(osQs.length, 1);
  assert.equal(osQs[0].correctOptionId, "A");
  const exps = await win.ElgoState.loadSubjectExplanations("os-custom");
  assert.equal(exps["os-custom::quiz::os-1::Q1"].explanationArabic, "سجل بيانات العملية.");
});

test("ElgoOfflineExport enforces admin offline HTML permissions and sanitizes generated HTML", () => {
  const exporter = require("../src/app/offline-export.js");

  assert.equal(exporter.isQuizDownloadAllowed(null, "dm", "dm::quiz::q1"), false);
  assert.equal(exporter.isLectureDownloadAllowed({}, "dm", "lec1"), false);

  const selectedSettings = {
    offlineDownloads: {
      quizzesMode: "selected",
      lecturesMode: "selected",
      allowedQuizIds: ["os::quiz::q1", "dm::*"],
      allowedLectureIds: ["os::lec-1"],
    },
  };
  assert.equal(exporter.isQuizDownloadAllowed(selectedSettings, "os", "os::quiz::q1"), true);
  assert.equal(exporter.isQuizDownloadAllowed(selectedSettings, "os", "os::quiz::q2"), false);
  assert.equal(exporter.isQuizDownloadAllowed(selectedSettings, "dm", "dm::quiz::anything"), true);
  assert.equal(exporter.isLectureDownloadAllowed(selectedSettings, "os", "lec-1"), true);
  assert.equal(exporter.isLectureDownloadAllowed(selectedSettings, "os", "lec-2"), false);

  const quizHtml = exporter.buildOfflineQuizHtml({
    courseTitle: "Operating Systems",
    quizTitle: "Midterm <script>alert(1)</script>",
    questions: [
      {
        prompt: "What does </script><img onerror=alert(1)> do?",
        options: [{ id: "A", text: "Safe JSON escape" }],
        correctOptionId: "A",
        explanationEnglish: "Escapes closing tags cleanly.",
        explanationArabic: "شرح عربي آمن.",
        rule: "Always escape < and > inside JSON script blocks.",
      },
    ],
  });
  assert.match(quizHtml, /<script type="application\/json" id="quiz-data">/);
  assert.doesNotMatch(quizHtml, /What does <\/script>/i);
  assert.match(quizHtml, /\\u003c\/script\\u003e/);
  assert.match(quizHtml, /شرح عربي آمن\./);

  const lecHtml = exporter.buildOfflineLectureHtml({
    courseTitle: "Operating Systems",
    lectureTitle: "Lecture 1",
    guideEn: "Intro",
    guideAr: "مقدمة",
    bodyHtml: '<p>Notes</p><script>evil()</script><a href="javascript:alert(1)" onclick="bad()">Link</a>',
  });
  assert.doesNotMatch(lecHtml, /<script>evil/i);
  assert.doesNotMatch(lecHtml, /onclick=/i);
  assert.doesNotMatch(lecHtml, /javascript:/i);
  assert.match(lecHtml, /<p>Notes<\/p>/);
});

test("backend validates offlineDownloads settings, renews active guest sessions, and ranks passwordless guests", async () => {
  const worker = require("../backend/worker.js");
  const { createEnv } = require("./helpers/d1-sqlite.js");
  const env = createEnv();

  const loginRes = await worker.handleApiRequest(
    new Request("https://elgo.test/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "correct horse battery staple" }),
    }),
    env
  );
  assert.equal(loginRes.status, 200);
  const adminCookie = loginRes.headers.get("set-cookie").split(";")[0];

  const badSettings = await worker.handleApiRequest(
    new Request("https://elgo.test/api/admin/site-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ settings: { offlineDownloads: ["invalid"] } }),
    }),
    env
  );
  assert.equal(badSettings.status, 400);

  const saveSettings = await worker.handleApiRequest(
    new Request("https://elgo.test/api/admin/site-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        settings: {
          bannerText: "Offline enabled",
          offlineDownloads: {
            quizzesMode: "selected",
            lecturesMode: "all",
            allowedQuizIds: ["os::quiz::q1", "bad id with spaces!"],
            allowedLectureIds: ["os::*"],
          },
        },
      }),
    }),
    env
  );
  assert.equal(saveSettings.status, 200);
  const getSettings = await worker.handleApiRequest(new Request("https://elgo.test/api/site-settings"), env);
  assert.equal(getSettings.status, 200);
  const savedJson = await getSettings.json();
  assert.equal(savedJson.settings.offlineDownloads.quizzesMode, "selected");
  assert.equal(savedJson.settings.offlineDownloads.lecturesMode, "all");
  assert.deepEqual(savedJson.settings.offlineDownloads.allowedQuizIds, ["os::quiz::q1"]);

  // Passwordless guest creation + sliding renewal when < 15 days remain
  const guestRes = await worker.handleApiRequest(
    new Request("https://elgo.test/api/auth/guest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "NoPass_Leader" }),
    }),
    env
  );
  assert.equal(guestRes.status, 200);
  const guestData = await guestRes.json();
  assert.equal(guestData.profile.guest, true);

  const nearExpiry = Date.now() + 2 * 24 * 60 * 60 * 1000;
  env.sqlite.prepare("UPDATE user_sessions SET expires_at = ? WHERE student_id = ?").run(nearExpiry, guestData.profile.studentId);

  const meRes = await worker.handleApiRequest(
    new Request("https://elgo.test/api/auth/me", {
      headers: { Authorization: `Bearer ${guestData.token}` },
    }),
    env
  );
  assert.equal(meRes.status, 200);
  const refreshedRow = env.sqlite.prepare("SELECT expires_at FROM user_sessions WHERE student_id = ?").get(guestData.profile.studentId);
  assert.ok(Number(refreshedRow.expires_at) > nearExpiry + 20 * 24 * 60 * 60 * 1000, "active session should renew toward 30 days");

  // Guest can join leaderboard without setting any password
  const quizId = "quiz-2";
  const subjId = "demo-course";
  const subj = JSON.parse(fs.readFileSync(path.join(ROOT, "public/data/subjects", `${subjId}.json`), "utf8"));
  const qItem = subj.quizzes.find((q) => q.id === quizId);
  assert.ok(qItem && qItem.questions.length > 0);
  const answers = {};
  qItem.questions.forEach((q) => {
    answers[q.id] = q.correctOptionId;
  });

  const subRes = await worker.handleApiRequest(
    new Request("https://elgo.test/api/quiz/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${guestData.token}` },
      body: JSON.stringify({
        attemptId: "att-nopass-guest-1",
        subjectId: subjId,
        quizId,
        mode: "test",
        durationMs: qItem.questions.length * 2500,
        answers,
      }),
    }),
    env
  );
  assert.equal(subRes.status, 200);
  const lbRes = await worker.handleApiRequest(new Request(`https://elgo.test/api/leaderboard?subjectId=${subjId}`), env);
  const lbJson = await lbRes.json();
  assert.equal(lbJson.entries.some((e) => e.username === "NoPass_Leader" && e.guest === true), true);
});

test("admin portal, leaderboard UI, and built lecture pages wire category filters, user toggles, no-password rank, and offline HTML cleanly", () => {
  const adminJs = fs.readFileSync(path.join(ROOT, "src/app/admin.js"), "utf8");
  assert.match(adminJs, /data-pdf-cat/);
  assert.match(adminJs, /#toggleAllUsersBtn/);
  assert.match(adminJs, /Make Admin/);
  assert.match(adminJs, /Revoke Admin/);
  assert.match(adminJs, /#setOfflineQuizMode/);
  assert.match(adminJs, /#setOfflineLectureMode/);

  const panelsJs = fs.readFileSync(path.join(ROOT, "src/app/panels.js"), "utf8");
  const playerJs = fs.readFileSync(path.join(ROOT, "src/app/player.js"), "utf8");
  const shellJs = fs.readFileSync(path.join(ROOT, "src/app/shell.js"), "utf8");
  assert.match(panelsJs, /#lbQuickJoinForm/);
  assert.match(playerJs, /#resQuickRankForm/);
  assert.match(shellJs, /Name Only \(No Password\)/);

  const hubJs = fs.readFileSync(path.join(ROOT, "src/app/hub.js"), "utf8");
  assert.match(hubJs, /#downloadOfflineQuizBtn/);
  assert.match(hubJs, /data-lec-offline/);

  const mlLearnDir = path.join(ROOT, "public/learn/demo-course");
  const firstLecId = fs.readdirSync(mlLearnDir).find((name) => fs.existsSync(path.join(mlLearnDir, name, "index.html")));
  assert.ok(firstLecId, "expected a built lecture page under public/learn/demo-course");
  const sampleLearnPage = fs.readFileSync(path.join(mlLearnDir, firstLecId, "index.html"), "utf8");
  assert.match(sampleLearnPage, /\/src\/app\/offline-export\.js/);
  assert.match(sampleLearnPage, /data-subject-id="demo-course"/);
  assert.match(sampleLearnPage, new RegExp(`data-lecture-id="${firstLecId}"`));

  // Saved Questions retake controls (course pills + subset selection + results bookmark toggle)
  assert.match(panelsJs, /data-saved-course-pill/);
  assert.match(panelsJs, /#practiceSavedBtn/);
  assert.match(panelsJs, /#practiceSelectedSavedBtn/);
  assert.match(panelsJs, /data-select-saved-id/);
  assert.match(panelsJs, /#savedSelectAllBtn/);
  assert.match(panelsJs, /#savedClearSelBtn/);
  assert.match(panelsJs, /#savedModeSelect/);
  assert.match(panelsJs, /#savedShuffleCheck/);
  assert.match(playerJs, /#backToSavedBtn/);
  assert.match(playerJs, /data-res-bookmark/);
});

test("student sessions persist long-term (10 years TTL) and do not expire early", async () => {
  const worker = require("../backend/worker.js");
  const { createEnv } = require("./helpers/d1-sqlite.js");
  const env = createEnv();

  const res = await worker.handleApiRequest(
    new Request("https://elgo.test/api/auth/guest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "Forever_Student" }),
    }),
    env
  );
  assert.equal(res.status, 200);
  const data = await res.json();
  const sessRow = env.sqlite.prepare("SELECT expires_at FROM user_sessions WHERE student_id = ?").get(data.profile.studentId);
  const nineYearsMs = 9 * 365 * 24 * 60 * 60 * 1000;
  assert.ok(Number(sessRow.expires_at) > Date.now() + nineYearsMs, "student session expires_at should be >= 9 years ahead");
});

test("POST /api/admin/quizzes/visibility toggles hidden quizzes reversibly without deleting scores and blocks hidden submissions", async () => {
  const worker = require("../backend/worker.js");
  const { createEnv } = require("./helpers/d1-sqlite.js");
  const env = createEnv();

  const unauthRes = await worker.handleApiRequest(
    new Request("https://elgo.test/api/admin/quizzes/visibility", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subjectId: "demo-course", quizId: "quiz-2", hidden: true }),
    }),
    env
  );
  assert.equal(unauthRes.status, 401);

  const loginRes = await worker.handleApiRequest(
    new Request("https://elgo.test/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "correct horse battery staple" }),
    }),
    env
  );
  assert.equal(loginRes.status, 200);
  const adminCookie = loginRes.headers.get("set-cookie").split(";")[0];

  const guestRes = await worker.handleApiRequest(
    new Request("https://elgo.test/api/auth/guest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "HideCheckUser" }),
    }),
    env
  );
  assert.equal(guestRes.status, 200);
  const guestData = await guestRes.json();

  const subjId = "demo-course";
  const quizId = "quiz-2";
  const compositeKey = `${subjId}::${quizId}`;
  const subj = JSON.parse(fs.readFileSync(path.join(ROOT, "public/data/subjects", `${subjId}.json`), "utf8"));
  const qItem = subj.quizzes.find((q) => q.id === quizId);
  const answers = {};
  qItem.questions.forEach((q) => { answers[q.id] = q.correctOptionId; });

  // Hide the quiz
  const hideRes = await worker.handleApiRequest(
    new Request("https://elgo.test/api/admin/quizzes/visibility", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ subjectId: subjId, quizId, hidden: true }),
    }),
    env
  );
  assert.equal(hideRes.status, 200);
  const hideJson = await hideRes.json();
  assert.equal(hideJson.ok, true);
  assert.equal(hideJson.hidden, true);
  assert.equal(hideJson.hiddenQuizKeys.includes(compositeKey), true);

  const dynHidden = await (await worker.handleApiRequest(new Request("https://elgo.test/api/catalog/dynamic"), env)).json();
  assert.equal(dynHidden.hiddenQuizKeys.includes(compositeKey), true);

  // Student submission fails while hidden
  const blockedSub = await worker.handleApiRequest(
    new Request("https://elgo.test/api/quiz/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${guestData.token}` },
      body: JSON.stringify({
        attemptId: "att-hidden-check-1",
        subjectId: subjId,
        quizId,
        mode: "test",
        durationMs: qItem.questions.length * 2000,
        answers,
      }),
    }),
    env
  );
  assert.equal(blockedSub.status, 400);

  // Show the quiz again -> submission succeeds cleanly
  const showRes = await worker.handleApiRequest(
    new Request("https://elgo.test/api/admin/quizzes/visibility", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ subjectId: subjId, quizId, hidden: false }),
    }),
    env
  );
  assert.equal(showRes.status, 200);
  const showJson = await showRes.json();
  assert.equal(showJson.hidden, false);
  assert.equal(showJson.hiddenQuizKeys.includes(compositeKey), false);

  const okSub = await worker.handleApiRequest(
    new Request("https://elgo.test/api/quiz/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${guestData.token}` },
      body: JSON.stringify({
        attemptId: "att-hidden-check-2",
        subjectId: subjId,
        quizId,
        mode: "test",
        durationMs: qItem.questions.length * 2000,
        answers,
      }),
    }),
    env
  );
  assert.equal(okSub.status, 200);

  // Deleting a hidden quiz cleans up hidden_quizzes entry as well
  await worker.handleApiRequest(
    new Request("https://elgo.test/api/admin/quizzes/visibility", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ subjectId: subjId, quizId, hidden: true }),
    }),
    env
  );
  const delRes = await worker.handleApiRequest(
    new Request(`https://elgo.test/api/admin/quizzes?subjectId=${subjId}&quizId=${quizId}&isBundled=1`, {
      method: "DELETE",
      headers: { Cookie: adminCookie },
    }),
    env
  );
  assert.equal(delRes.status, 200);
  const dynAfterDel = await (await worker.handleApiRequest(new Request("https://elgo.test/api/catalog/dynamic"), env)).json();
  assert.equal(dynAfterDel.hiddenQuizKeys.includes(compositeKey), false);
});

test("ElgoState filters hidden quizzes from student catalog and subjects while exposing hiddenSources for Admin UI", async () => {
  const storage = createMemoryStorage();
  const mockFetch = async (url) => {
    const u = String(url);
    if (u.includes("/data/catalog.json")) {
      return {
        ok: true,
        json: async () => ({
          schemaVersion: 1,
          subjects: [
            { id: "dm", name: "Data Mining", counts: { quizzes: 2, sheets: 0, lectures: 0, totalQuestions: 14 } },
          ],
          sources: [
            { id: "dm::quiz::q1", collectionId: "q1", subjectId: "dm", kind: "quiz", title: "Visible Quiz", questionCount: 10 },
            { id: "dm::quiz::q-hidden", collectionId: "q-hidden", subjectId: "dm", kind: "quiz", title: "Hidden Quiz", questionCount: 4 },
          ],
          lectures: [],
          resources: [],
        }),
      };
    }
    if (u.includes("/data/subjects/dm.json")) {
      return {
        ok: true,
        json: async () => ({
          id: "dm",
          name: "Data Mining",
          quizzes: [
            { id: "q1", title: "Visible Quiz", questions: [{ id: "Q1", question: "Visible?", options: [{ id: "A", text: "Yes" }], correctOptionId: "A" }] },
            { id: "q-hidden", title: "Hidden Quiz", questions: [{ id: "Q1", question: "Secret?", options: [{ id: "A", text: "Yes" }], correctOptionId: "A" }] },
          ],
          sheets: [],
          lectures: [],
        }),
      };
    }
    if (u.includes("/api/catalog/dynamic")) {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          customSubjects: {},
          deletedSubjectIds: [],
          customQuizzes: [],
          deletedQuizKeys: [],
          hiddenQuizKeys: ["dm::q-hidden"],
        }),
      };
    }
    if (u.includes("/api/subject-names") || u.includes("/api/quiz-names")) {
      return { ok: true, json: async () => ({ ok: true, names: {} }) };
    }
    if (u.includes("/api/site-settings")) {
      return { ok: true, json: async () => ({ ok: true, settings: {} }) };
    }
    if (u.includes("/api/content/overrides")) {
      return { ok: true, json: async () => ({ ok: true, overrides: null }) };
    }
    return { ok: false, status: 404, json: async () => ({ ok: false }) };
  };

  const { win } = loadAppScript("src/app/state.js", { localStorage: storage, fetch: mockFetch });
  const modelCode = fs.readFileSync(path.join(ROOT, "src/app/model.js"), "utf8");
  vm.runInNewContext(modelCode, Object.assign(win, { window: win }));

  const cat = await win.ElgoState.loadCatalog(true);
  assert.equal(cat.sources.length, 1);
  assert.equal(cat.sources[0].collectionId, "q1");
  assert.equal(cat.subjects[0].counts.quizzes, 1);
  assert.equal(cat.subjects[0].counts.totalQuestions, 10);
  assert.equal(cat.hiddenSources.length, 1);
  assert.equal(cat.hiddenSources[0].collectionId, "q-hidden");
  assert.equal(cat.hiddenSources[0].isHidden, true);
  assert.deepEqual(win.ElgoState.getHiddenQuizKeys(), ["dm::q-hidden"]);

  // Student view excludes hidden quiz and questions
  const studentSubj = await win.ElgoState.loadSubject("dm");
  assert.equal(studentSubj.quizzes.length, 1);
  assert.equal(studentSubj.quizzes[0].id, "q1");
  const studentBlockedQs = await win.ElgoState.loadQuestionsForSources("dm", ["dm::quiz::q-hidden"]);
  assert.equal(studentBlockedQs.length, 0);

  // Admin preview passes { includeHidden: true } and sees both
  const adminSubj = await win.ElgoState.loadSubject("dm", { includeHidden: true });
  assert.equal(adminSubj.quizzes.length, 2);
  const adminPreviewQs = await win.ElgoState.loadQuestionsForSources("dm", ["dm::quiz::q-hidden"], { includeHidden: true });
  assert.equal(adminPreviewQs.length, 1);
  assert.equal(adminPreviewQs[0].question, "Secret?");

  const adminJs = fs.readFileSync(path.join(ROOT, "src/app/admin.js"), "utf8");
  assert.match(adminJs, /data-quiz-toggle-hide/);
  assert.match(adminJs, /\/api\/admin\/quizzes\/visibility/);
  assert.match(adminJs, /includeHidden:\s*true/);
  assert.match(adminJs, /hiddenSources/);
  assert.match(adminJs, /is-warn">Hidden/);
});

test("backend supports secure PNG/JPG/WebP/GIF quiz image upload/serving, quiz image sanitization, and per-quiz image overlays", async () => {
  const worker = require("../backend/worker.js");
  const { createEnv } = require("./helpers/d1-sqlite.js");
  const env = createEnv();

  // Unauthenticated upload blocked
  const pngBytes = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52]);
  const unauthUp = await worker.handleApiRequest(
    new Request("https://elgo.test/api/admin/r2/upload-image?subjectId=dm", {
      method: "POST",
      headers: { "Content-Type": "image/png", "Content-Length": String(pngBytes.length) },
      body: pngBytes,
    }),
    env
  );
  assert.equal(unauthUp.status, 401);

  const loginRes = await worker.handleApiRequest(
    new Request("https://elgo.test/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "correct horse battery staple" }),
    }),
    env
  );
  const adminCookie = loginRes.headers.get("set-cookie").split(";")[0];

  // SVG / HTML disguise rejected (415)
  const svgFake = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>");
  const badType = await worker.handleApiRequest(
    new Request("https://elgo.test/api/admin/r2/upload-image?subjectId=dm", {
      method: "POST",
      headers: { "Content-Type": "image/png", "Content-Length": String(svgFake.length), Cookie: adminCookie },
      body: svgFake,
    }),
    env
  );
  assert.equal(badType.status, 415);

  // Valid PNG accepted & served
  const upRes = await worker.handleApiRequest(
    new Request("https://elgo.test/api/admin/r2/upload-image?subjectId=dm", {
      method: "POST",
      headers: { "Content-Type": "image/png", "Content-Length": String(pngBytes.length), Cookie: adminCookie },
      body: pngBytes,
    }),
    env
  );
  assert.equal(upRes.status, 200);
  const upJson = await upRes.json();
  assert.equal(upJson.ok, true);
  assert.match(upJson.image.url, /^\/api\/r2\/quiz-images\/dm\/[a-f0-9]{32}\.png$/);

  const getImg = await worker.handleApiRequest(new Request(`https://elgo.test${upJson.image.url}`), env);
  assert.equal(getImg.status, 200);
  assert.equal(getImg.headers.get("content-type"), "image/png");
  assert.equal(getImg.headers.get("x-content-type-options"), "nosniff");

  // Arbitrary unregistered R2 key in quiz-images/ is blocked
  const strayKey = "quiz-images/dm/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png";
  await env.FILES.put(strayKey, pngBytes, { httpMetadata: { contentType: "image/png" } });
  const strayRes = await worker.handleApiRequest(new Request(`https://elgo.test/api/r2/${strayKey}`), env);
  assert.equal(strayRes.status, 404);

  // Quiz import rejects javascript: URL and persists valid image + images
  const unsafeQuiz = await worker.handleApiRequest(
    new Request("https://elgo.test/api/admin/quizzes", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        subjectId: "dm",
        quizId: "img-quiz-1",
        title: "Diagram Quiz",
        questions: [
          { id: "Q1", question: "See diagram", image: "javascript:alert(1)", options: ["A", "B"], correctOptionId: "A" },
        ],
      }),
    }),
    env
  );
  assert.equal(unsafeQuiz.status, 400);

  const okQuiz = await worker.handleApiRequest(
    new Request("https://elgo.test/api/admin/quizzes", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        subjectId: "dm",
        quizId: "img-quiz-1",
        title: "Diagram Quiz",
        questions: [
          {
            id: "Q1",
            question: "Which layer is highlighted?",
            image: upJson.image.url,
            imageAlt: "OSI Figure",
            imageCaption: "Figure 1: Layer stack",
            options: [{ id: "A", text: "Transport" }, { id: "B", text: "Network" }],
            correctOptionId: "B",
          },
        ],
      }),
    }),
    env
  );
  assert.equal(okQuiz.status, 200);

  const dynQuizRes = await (await worker.handleApiRequest(new Request("https://elgo.test/api/catalog/dynamic?subjectId=dm"), env)).json();
  assert.equal(dynQuizRes.subjectQuizzes[0].questions[0].image, upJson.image.url);
  assert.equal(dynQuizRes.subjectQuizzes[0].questions[0].images[0].caption, "Figure 1: Layer stack");

  // Save per-question image overlay for an existing quiz
  const ovRes = await worker.handleApiRequest(
    new Request("https://elgo.test/api/admin/quizzes/images", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        subjectId: "demo-course",
        quizId: "quiz-2",
        imagesByQuestionId: {
          Q1: [{ url: upJson.image.url, alt: "Topology", caption: "Star graph" }],
        },
      }),
    }),
    env
  );
  assert.equal(ovRes.status, 200);

  const dynCsc = await (await worker.handleApiRequest(new Request("https://elgo.test/api/catalog/dynamic?subjectId=demo-course"), env)).json();
  assert.equal(dynCsc.questionImageCounts["demo-course::quiz-2"], 1);
  assert.equal(dynCsc.subjectQuestionImages["quiz-2"].Q1[0].url, upJson.image.url);

  // Deleting uploaded image removes it from R2 and quiz_images_index
  const delImgRes = await worker.handleApiRequest(
    new Request(`https://elgo.test/api/admin/r2/image?url=${encodeURIComponent(upJson.image.url)}`, {
      method: "DELETE",
      headers: { Cookie: adminCookie },
    }),
    env
  );
  assert.equal(delImgRes.status, 200);
  const afterDelImg = await worker.handleApiRequest(new Request(`https://elgo.test${upJson.image.url}`), env);
  assert.equal(afterDelImg.status, 404);
});

test("ImportPipeline, ElgoModel, ElgoState, OfflineExport, Player, and Admin UI support quiz images cleanly", async () => {
  const ImportPipeline = require("../src/core/import-pipeline.js");
  const pipeline = ImportPipeline.createPipeline({ storage: null });

  const textDraft = pipeline.parse({
    kind: "text",
    subjectId: "dm",
    collectionId: "img-txt",
    title: "Text Images",
    text: [
      "1. Identify the gate in this schematic.",
      "Image: /content/images/logic-xor.png",
      "Caption: Two-input gate symbol",
      "![Backup trace](https://example.com/trace.png)",
      "Image: javascript:alert(1)",
      "A) AND",
      "B) XOR",
      "Answer: B",
    ].join("\n"),
  });
  assert.equal(textDraft.questions.length, 1);
  assert.equal(textDraft.questions[0].image, "/content/images/logic-xor.png");
  assert.equal(textDraft.questions[0].imageCaption, "Two-input gate symbol");
  assert.equal(textDraft.questions[0].images.length, 2);
  assert.equal(textDraft.questions[0].images[1].url, "https://example.com/trace.png");

  const jsonDraft = pipeline.parse({
    kind: "json",
    subjectId: "dm",
    collectionId: "img-json",
    title: "JSON Images",
    text: JSON.stringify([
      {
        id: "Q1",
        question: "Diagram question",
        image: "/api/r2/quiz-images/dm/0123456789abcdef0123456789abcdef.png",
        images: ["data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="],
        options: ["A", "B"],
        correctAnswer: 0,
      },
    ]),
  });
  assert.equal(jsonDraft.questions[0].images.length, 1);
  assert.equal(jsonDraft.questions[0].image, "/api/r2/quiz-images/dm/0123456789abcdef0123456789abcdef.png");

  // Frontend state image overlay merge + bookmarks/mistakes preservation + offline HTML export
  const storage = createMemoryStorage();
  const mockFetch = async (url) => {
    const u = String(url);
    if (u.includes("/data/catalog.json")) {
      return {
        ok: true,
        json: async () => ({
          schemaVersion: 1,
          subjects: [{ id: "dm", name: "Data Mining", counts: { quizzes: 1, sheets: 0, lectures: 0, totalQuestions: 2 } }],
          sources: [{ id: "dm::quiz::q1", collectionId: "q1", subjectId: "dm", kind: "quiz", title: "Quiz 1", questionCount: 2 }],
          lectures: [],
          resources: [],
        }),
      };
    }
    if (u.includes("/data/subjects/dm.json")) {
      return {
        ok: true,
        json: async () => ({
          id: "dm",
          name: "Data Mining",
          quizzes: [
            {
              id: "q1",
              title: "Quiz 1",
              questions: [
                { id: "Q1", question: "No bundled img yet", options: [{ id: "A", text: "1" }, { id: "B", text: "2" }], correctOptionId: "A" },
                { id: "Q2", question: "Bundled img cleared", image: "/content/images/old.png", options: [{ id: "A", text: "1" }, { id: "B", text: "2" }], correctOptionId: "B" },
              ],
            },
          ],
          sheets: [],
          lectures: [],
        }),
      };
    }
    if (u.includes("/api/catalog/dynamic?subjectId=dm")) {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          deletedQuizKeys: [],
          hiddenQuizKeys: [],
          subjectQuizzes: [],
          subjectQuestionImages: {
            q1: {
              Q1: [{ url: "/api/r2/quiz-images/dm/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp", alt: "Plot", caption: "ROC curve" }],
              Q2: [],
            },
          },
        }),
      };
    }
    if (u.includes("/api/catalog/dynamic")) {
      return { ok: true, json: async () => ({ ok: true, customSubjects: {}, deletedSubjectIds: [], customQuizzes: [], deletedQuizKeys: [], hiddenQuizKeys: [], questionImageCounts: { "dm::q1": 1 } }) };
    }
    if (u.includes("/api/subject-names") || u.includes("/api/quiz-names")) return { ok: true, json: async () => ({ ok: true, names: {} }) };
    if (u.includes("/api/site-settings")) return { ok: true, json: async () => ({ ok: true, settings: {} }) };
    if (u.includes("/api/content/overrides")) return { ok: true, json: async () => ({ ok: true, overrides: null }) };
    return { ok: false, status: 404, json: async () => ({ ok: false }) };
  };

  const { win, ctx } = loadAppScript("src/app/model.js", { localStorage: storage, fetch: mockFetch });
  ctx.ElgoModel = win.ElgoModel;
  vm.runInContext(fs.readFileSync(path.join(ROOT, "src/app/state.js"), "utf8"), ctx, { filename: "src/app/state.js" });

  await win.ElgoState.loadCatalog(true);
  const qs = await win.ElgoState.loadQuestionsForSources("dm", ["dm::quiz::q1"]);
  assert.equal(qs[0].image, "/api/r2/quiz-images/dm/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp");
  assert.equal(qs[0].imageCaption, "ROC curve");
  assert.equal(qs[1].image, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(qs[1].images)), []);

  // Bookmark & mistake store question image cleanly
  win.ElgoState.toggleBookmark(qs[0], { subjectId: "dm", subjectName: "Data Mining", collectionId: "q1" });
  win.ElgoState.recordMistake(qs[0], "B", { subjectId: "dm", subjectName: "Data Mining", collectionId: "q1" });
  const st = win.ElgoState.getState();
  assert.equal(st.bookmarks[0].image, "/api/r2/quiz-images/dm/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp");
  assert.equal(st.mistakes[0].image, "/api/r2/quiz-images/dm/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp");

  // Offline HTML export preserves normalized question images safely
  const Exporter = require("../src/app/offline-export.js");
  const offHtml = Exporter.buildOfflineQuizHtml({
    courseTitle: "Data Mining",
    quizTitle: "Quiz 1",
    questions: qs,
  });
  assert.match(offHtml, /\/api\/r2\/quiz-images\/dm\/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\.webp/);
  assert.match(offHtml, /ROC curve/);

  // UI & CSP parity checks
  const playerJs = fs.readFileSync(path.join(ROOT, "src/app/player.js"), "utf8");
  const panelsJs = fs.readFileSync(path.join(ROOT, "src/app/panels.js"), "utf8");
  const adminJs = fs.readFileSync(path.join(ROOT, "src/app/admin.js"), "utf8");
  const headers = fs.readFileSync(path.join(ROOT, "_headers"), "utf8");
  assert.match(playerJs, /openImageLightbox/);
  assert.match(playerJs, /renderQuestionImagesHtml/);
  assert.match(panelsJs, /renderPanelQuestionImages/);
  assert.match(adminJs, /data-quiz-images/);
  assert.match(adminJs, /\/api\/admin\/r2\/upload-image/);
  assert.match(adminJs, /\/api\/admin\/quizzes\/images/);
  assert.match(adminJs, /data-imp-img-idx/);
  assert.match(headers, /img-src 'self' data: blob: https:/);
});

test("build stamps hashed SW cache revision for instant deploy invalidation and dev-server uses 0000 loopback default with remote guard", async () => {
  const { buildPublicSite } = require("../tools/build");
  const tmp1 = fs.mkdtempSync(path.join(os.tmpdir(), "elgo-sw-rev1-"));
  const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), "elgo-sw-rev2-"));
  try {
    const s1 = buildPublicSite({ outDir: tmp1, skipAnswerKey: true });
    const s2 = buildPublicSite({ outDir: tmp2, skipAnswerKey: true });
    assert.match(s1.swRevision, /^[a-f0-9]{10}$/);
    assert.equal(s1.swRevision, s2.swRevision, "Deterministic build hash when inputs are identical");
    const builtSw = fs.readFileSync(path.join(tmp1, "sw.js"), "utf8");
    assert.match(builtSw, new RegExp(`const CACHE_NAME = "elgo-lab-v11-${s1.swRevision}";`));
    assert.match(builtSw, /cache:\s*"reload"/);
  } finally {
    fs.rmSync(tmp1, { recursive: true, force: true });
    fs.rmSync(tmp2, { recursive: true, force: true });
  }

  const headers = fs.readFileSync(path.join(ROOT, "_headers"), "utf8");
  assert.match(headers, /\/src\/\*\.js\r?\n\s+Cache-Control:\s*public,\s*max-age=0,\s*must-revalidate/);
  assert.match(headers, /\/data\/\*\r?\n\s+Cache-Control:\s*public,\s*max-age=0,\s*must-revalidate/);
  assert.match(headers, /\/sw\.js\r?\n\s+Cache-Control:\s*no-cache,\s*no-store,\s*must-revalidate/);

  const mainJs = fs.readFileSync(path.join(ROOT, "src/app/main.js"), "utf8");
  assert.match(mainJs, /updateViaCache:\s*"none"/);

  // dev-server defaults local loopback to 0000 and blocks non-loopback without strong secret
  const tmpSrv = fs.mkdtempSync(path.join(os.tmpdir(), "elgo-dev-srv-"));
  try {
    const inst = await startServer({ port: 0, publicDir: tmpSrv, skipAnswerKey: true, quiet: true });
    assert.equal(inst.adminPassword, "0000");
    await new Promise((r) => inst.server.close(r));
    await assert.rejects(
      () => startServer({ host: "0.0.0.0", port: 0, publicDir: tmpSrv, skipBuild: true, quiet: true }),
      /non-loopback host/
    );
  } finally {
    fs.rmSync(tmpSrv, { recursive: true, force: true });
  }

  const adminJs = fs.readFileSync(path.join(ROOT, "src/app/admin.js"), "utf8");
  const shellJs = fs.readFileSync(path.join(ROOT, "src/app/shell.js"), "utf8");
  const presenceJs = fs.readFileSync(path.join(ROOT, "src/core/presence.js"), "utf8");
  assert.match(adminJs, /\/api\/admin\/online-users/);
  assert.match(adminJs, /Online Users Right Now/);
  assert.match(shellJs, /getPresenceArea/);
  assert.match(presenceJs, /getHeaders/);
});
