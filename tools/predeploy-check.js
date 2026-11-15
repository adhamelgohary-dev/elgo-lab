#!/usr/bin/env node
/**
 * Pre-Deploy Build & Security Gate (`tools/predeploy-check.js`)
 *
 * Rebuilds `public/` from clean source, then verifies:
 *  1. Required runtime assets & compiled data JSONs exist and parse cleanly.
 *  2. `backend/answer-key.js` matches canonical `content/subjects/*.json`.
 *  3. No backend secrets/files leaked into `public/`.
 *  4. No inline `<script>` tags or legacy `engine/` / `hub/` / `shell/` references remain.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { buildPublicSite } = require("./build");

const ROOT = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function walkFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
}

function runChecks() {
  const stats = buildPublicSite();
  const required = [
    "index.html",
    "manifest.webmanifest",
    "sw.js",
    "_headers",
    "data/catalog.json",
    "data/search-index.json",
    "src/app/theme.js",
    "src/app/main.js",
    "src/app/admin.js",
    "assets/mascot/mascot-clay.webp",
    "icons/icon-192.png",
  ];
  for (const rel of required) {
    if (!fs.existsSync(path.join(PUBLIC_DIR, rel))) {
      fail(`Missing built file: public/${rel}`);
    }
  }

  const catalog = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, "data", "catalog.json"), "utf8"));
  if (!Array.isArray(catalog.subjects) || catalog.subjects.length === 0) {
    fail("catalog.json contains zero subjects.");
  }
  for (const s of catalog.subjects) {
    const subjFile = path.join(PUBLIC_DIR, "data", "subjects", `${s.id}.json`);
    const expFile = path.join(PUBLIC_DIR, "data", "explanations", `${s.id}.json`);
    if (!fs.existsSync(subjFile) || !fs.existsSync(expFile)) {
      fail(`Missing built subject/explanations bundle for ${s.id}`);
    }
  }

  // Verify answer-key covers all canonical questions
  delete require.cache[require.resolve("../backend/answer-key")];
  const answerKey = require("../backend/answer-key");
  if (!answerKey || Number(answerKey.totalQuestions) !== Number(stats.questions)) {
    fail(`Answer key count (${answerKey && answerKey.totalQuestions}) != built questions (${stats.questions}).`);
  }

  const catalogTotal = catalog.sources.reduce((sum, source) => sum + source.questionCount, 0);
  if (catalogTotal !== answerKey.totalQuestions) fail("Catalog and answer-key counts differ.");
  if (Object.keys(answerKey.collections).length !== catalog.sources.length) fail("Catalog collections differ from answer key.");
  for (const subject of catalog.subjects) {
    const data = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, "data", "subjects", subject.id + ".json"), "utf8"));
    const groups = [...data.quizzes, ...data.sheets, ...data.lectures.map(l => ({id: l.id, questions: l.generatedQuiz.questions}))];
    for (const group of groups) for (const q of group.questions) {
      const entry = answerKey.byInternalId[q.internalId];
      if (q.correctOptionId && (!entry || entry.correctOptionId !== q.correctOptionId)) fail("Answer-key mismatch: " + q.internalId);
    }
  }

  // Verify no sensitive files or inline scripts in public/
  const builtFiles = walkFiles(PUBLIC_DIR);
  for (const f of builtFiles) {
    const rel = path.relative(PUBLIC_DIR, f).replace(/\\/g, "/");
    if (/(^|\/)(worker\.js|answer-key\.js|schema\.sql|\.dev\.vars|wrangler\.toml)$/i.test(rel)) {
      fail(`Sensitive file leaked into public/: ${rel}`);
    }
    if (rel.endsWith(".html")) {
      const html = fs.readFileSync(f, "utf8");
      if (/<script\b(?![^>]*\bsrc=)[^>]*>/i.test(html)) {
        fail(`Inline <script> detected in public/${rel} (violates strict CSP)`);
      }
      if (/\/(engine|hub|shell)\//i.test(html)) {
        fail(`Legacy engine/hub/shell reference detected in public/${rel}`);
      }
    }
  }

  console.log(
    `Pre-deploy check PASSED (${stats.subjects} subjects, ${stats.questions} questions, ` +
    `${stats.lectures} lecture pages, strict CSP verified).`
  );
}

if (require.main === module) {
  runChecks();
}

module.exports = { runChecks };
