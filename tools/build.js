#!/usr/bin/env node
/**
 * Unified Production & Local Build (`tools/build.js`)
 *
 * Compiles canonical `content/` + static `src/` frontend into `public/` and
 * regenerates `backend/answer-key.js`.
 *
 * Usage:
 *   node tools/build.js
 */
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { writeAnswerKey } = require("./build-answer-key");
const { buildLecturePages } = require("./lecture-pages");

const ROOT = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const SUBJECTS_DIR = path.join(ROOT, "content", "subjects");
const LIBRARY_DIR = path.join(ROOT, "content", "library");

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

function collectSortedFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectSortedFiles(full));
    else out.push(full);
  }
  return out.sort();
}

function stampServiceWorkerCache(outDir, catalogPayload) {
  const swDest = path.join(outDir, "sw.js");
  if (!fs.existsSync(swDest)) return "";
  const hash = crypto.createHash("sha256");
  const stableCatalog = Object.assign({}, catalogPayload, { generatedAt: "" });
  hash.update(JSON.stringify(stableCatalog));
  for (const rel of ["index.html", "manifest.webmanifest", "_headers"]) {
    const p = path.join(outDir, rel);
    if (fs.existsSync(p)) hash.update(fs.readFileSync(p));
  }
  for (const dirName of ["src", path.join("data", "subjects"), path.join("content", "images"), "learn"]) {
    for (const file of collectSortedFiles(path.join(outDir, dirName))) {
      hash.update(path.relative(outDir, file).replace(/\\/g, "/"));
      hash.update(fs.readFileSync(file));
    }
  }
  const rev = hash.digest("hex").slice(0, 10);
  const swSrc = fs.readFileSync(swDest, "utf8");
  const nextSw = swSrc.replace(/const CACHE_NAME = "([^"]+)";/, `const CACHE_NAME = "$1-${rev}";`);
  fs.writeFileSync(swDest, nextSw, "utf8");
  return rev;
}

function loadCanonicalSubjects() {
  return fs.readdirSync(SUBJECTS_DIR)
    .filter((f) => f.endsWith(".json") && !f.startsWith("."))
    .sort()
    .map((f) => readJson(path.join(SUBJECTS_DIR, f), null))
    .filter(Boolean)
    .sort((a, b) => (Number(a.order) || 99) - (Number(b.order) || 99));
}

function buildPublicSite(options) {
  const opts = options || {};
  const outDir = opts.outDir ? path.resolve(opts.outDir) : PUBLIC_DIR;
  const subjects = loadCanonicalSubjects();
  const pdfs = readJson(path.join(LIBRARY_DIR, "pdfs.json"), []);
  const videos = readJson(path.join(LIBRARY_DIR, "videos.json"), []);

  // Validate active bundled PDF files exist
  for (const p of Array.isArray(pdfs) ? pdfs : []) {
    if (p && p.active !== false && p.path && !/^https?:/i.test(p.path)) {
      const rel = p.path.replace(/^\/+/, "");
      if (!fs.existsSync(path.join(ROOT, rel))) {
        throw new Error(`Missing PDF asset referenced in content/library/pdfs.json: ${rel}`);
      }
    }
  }

  // Clean output directory cleanly before writing
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, "data", "subjects"), { recursive: true });
  fs.mkdirSync(path.join(outDir, "data", "explanations"), { recursive: true });

  const catalogSubjects = [];
  const catalogSources = [];
  const catalogLectures = [];
  const searchQuestions = [];

  for (const subj of subjects) {
    const expMap = {};
    let subjectQuestionCount = 0;

    function processCollection(col, type, questionsList) {
      const qs = Array.isArray(questionsList) ? questionsList : [];
      subjectQuestionCount += qs.length;
      const sourceId = `${subj.id}::${type}::${col.id}`;
      const colTitle = col.title || col.id;

      catalogSources.push({
        id: sourceId,
        subjectId: subj.id,
        collectionId: col.id,
        type,
        title: colTitle,
        questionCount: qs.length,
      });

      const strippedQuestions = qs.map((q) => {
        const internalId = q.internalId || `${subj.id}::${type}::${col.id}::${q.id}`;
        if (
          q.explanation ||
          q.explanationArabic ||
          q.arabicTranslation ||
          q.academicExplanation ||
          q.correctReasoning ||
          q.wrongAnswerClarification ||
          q.memoryTrick ||
          q.rule ||
          q.whyYouMightErr
        ) {
          expMap[internalId] = {
            arabicTranslation: q.arabicTranslation || "",
            academicExplanation: q.academicExplanation || q.explanation || "",
            arabicExplanation: q.explanationArabic || "",
            correctReasoning: q.correctReasoning || "",
            wrongAnswerClarification: q.wrongAnswerClarification || "",
            memoryTrick: q.memoryTrick || "",
            rule: q.rule || "",
            whyYouMightErr: q.whyYouMightErr || "",
            teachingReview: q.teachingReview || "",
          };
        }

        searchQuestions.push({
          internalId,
          subjectId: subj.id,
          collectionId: col.id,
          sourceTitle: `${subj.name || subj.id} · ${colTitle}`,
          text: q.question || q.text || "",
        });

        const cleanQ = Object.assign({}, q, { internalId });
        delete cleanQ.explanation;
        delete cleanQ.explanationArabic;
        delete cleanQ.arabicTranslation;
        delete cleanQ.academicExplanation;
        delete cleanQ.correctReasoning;
        delete cleanQ.wrongAnswerClarification;
        delete cleanQ.memoryTrick;
        delete cleanQ.rule;
        delete cleanQ.whyYouMightErr;
        delete cleanQ.teachingReview;
        return cleanQ;
      });

      return strippedQuestions;
    }

    const outSubj = Object.assign({}, subj, {
      quizzes: (subj.quizzes || []).map((qz) => Object.assign({}, qz, {
        questions: processCollection(qz, "quiz", qz.questions),
      })),
      lectures: (subj.lectures || []).map((lec) => {
        const qs = processCollection(lec, "lecture", lec.generatedQuiz && lec.generatedQuiz.questions);
        const pageRel = `content/lecture-pages/${subj.id}/${lec.id}.html`;
        const hasPage = fs.existsSync(path.join(ROOT, pageRel));
        catalogLectures.push({
          id: lec.id,
          subjectId: subj.id,
          sourceId: `${subj.id}::lecture::${lec.id}`,
          title: lec.title || lec.id,
          guide: lec.guide || null,
          questionCount: qs.length,
          hasPage,
        });
        return Object.assign({}, lec, {
          generatedQuiz: Object.assign({}, lec.generatedQuiz || {}, { questions: qs }),
        });
      }),
      sheets: (subj.sheets || []).map((sh) => Object.assign({}, sh, {
        questions: processCollection(sh, "sheet", sh.questions),
      })),
    });

    fs.writeFileSync(
      path.join(outDir, "data", "subjects", `${subj.id}.json`),
      JSON.stringify(outSubj),
      "utf8"
    );
    fs.writeFileSync(
      path.join(outDir, "data", "explanations", `${subj.id}.json`),
      JSON.stringify({ schemaVersion: 1, subjectId: subj.id, byInternalId: expMap }),
      "utf8"
    );

    const subjPdfCount = (Array.isArray(pdfs) ? pdfs : []).filter((p) => p && p.subjectId === subj.id && p.active !== false).length;
    const subjVideoCount = (Array.isArray(videos) ? videos : []).filter((v) => v && v.subjectId === subj.id && v.active !== false).length;
    const quizQCount = (subj.quizzes || []).reduce((acc, qz) => acc + ((qz.questions && qz.questions.length) || 0), 0);
    const lecQCount = (subj.lectures || []).reduce((acc, l) => acc + ((l.generatedQuiz && l.generatedQuiz.questions && l.generatedQuiz.questions.length) || 0), 0);
    const sheetQCount = (subj.sheets || []).reduce((acc, sh) => acc + ((sh.questions && sh.questions.length) || 0), 0);

    catalogSubjects.push({
      id: subj.id,
      order: subj.order || catalogSubjects.length + 1,
      name: subj.name,
      nameAr: subj.nameAr || "",
      description: subj.description || "",
      facultyId: subj.facultyId || "faculty-ai",
      levelId: subj.levelId || "level-2",
      termId: subj.termId || "term-1",
      accent: subj.accent || "#F59B59",
      quizCount: (subj.quizzes || []).length,
      lectureCount: (subj.lectures || []).length,
      sheetCount: (subj.sheets || []).length,
      pdfCount: subjPdfCount,
      videoCount: subjVideoCount,
      questionCount: subjectQuestionCount,
      counts: {
        quizzes: (subj.quizzes || []).length,
        quizQuestions: quizQCount,
        lectures: (subj.lectures || []).length,
        lectureQuestions: lecQCount,
        sheets: (subj.sheets || []).length,
        sheetQuestions: sheetQCount,
        pdfs: subjPdfCount,
        videos: subjVideoCount,
        totalQuestions: subjectQuestionCount,
      },
    });
  }

  const catalogResources = [
    ...(Array.isArray(pdfs) ? pdfs : []).filter((p) => p && p.active !== false).map((p) => Object.assign({}, p, { type: p.type || "pdf" })),
    ...(Array.isArray(videos) ? videos : []).filter((v) => v && v.active !== false).map((v) => Object.assign({}, v, { type: "video" })),
  ];

  const generatedAt = new Date().toISOString();
  const catalog = {
    schemaVersion: 2,
    generatedAt,
    hierarchy: {
      activeFacultyId: "faculty-ai",
      activeLevelId: "level-2",
      activeTermId: "term-1",
      faculties: [
        {
          id: "faculty-ai",
          name: "Faculty of AI",
          terms: [
            { id: "term-1", name: "Term 1", status: "active" },
          ],
        },
      ],
      subjects: catalogSubjects,
    },
    subjects: catalogSubjects,
    sources: catalogSources,
    lectures: catalogLectures,
    resources: catalogResources,
  };

  fs.writeFileSync(
    path.join(outDir, "data", "catalog.json"),
    JSON.stringify(catalog, null, 2),
    "utf8"
  );

  fs.writeFileSync(
    path.join(outDir, "data", "search-index.json"),
    JSON.stringify({
      generatedAt,
      subjects: catalogSubjects.map((s) => ({ id: s.id, name: s.name, nameAr: s.nameAr })),
      lectures: catalogLectures.map((l) => ({ id: l.id, subjectId: l.subjectId, title: l.title })),
      resources: catalogResources.map((r) => ({ id: r.id, subjectId: r.subjectId, title: r.title, topic: r.topic || r.category || "", path: r.path || r.url || "" })),
      questions: searchQuestions,
    }),
    "utf8"
  );

  // Copy static assets and modular source files
  ["index.html", "sw.js", "manifest.webmanifest", "_headers"].forEach((file) => {
    const src = path.join(ROOT, file);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(outDir, file));
  });
  copyRecursive(path.join(ROOT, "src"), path.join(outDir, "src"));
  copyRecursive(path.join(ROOT, "assets"), path.join(outDir, "assets"));
  copyRecursive(path.join(ROOT, "icons"), path.join(outDir, "icons"));
  copyRecursive(path.join(ROOT, "content", "pdfs"), path.join(outDir, "content", "pdfs"));
  copyRecursive(path.join(ROOT, "content", "images"), path.join(outDir, "content", "images"));

  fs.writeFileSync(
    path.join(outDir, "_routes.json"),
    JSON.stringify({ version: 1, include: ["/api/*"], exclude: [] }, null, 2) + "\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(outDir, "404.html"),
    '<!doctype html><html lang="en" data-theme="evening"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not found · Elgo Lab</title>' +
      '<script src="/src/app/theme.js"></script><link rel="stylesheet" href="/src/styles/tokens.css"><link rel="stylesheet" href="/src/styles/app.css"></head>' +
      '<body><main class="product" style="display:grid;place-items:center;min-height:100vh;text-align:center"><div><p class="eyebrow">404</p><h1>Page not found.</h1><p class="muted" style="margin:12px 0 20px">This study route does not exist.</p><a class="primary" href="/">Back to Elgo Lab</a></div></main></body></html>\n',
    "utf8"
  );

  const lectureStats = buildLecturePages(subjects, outDir);
  const swRevision = stampServiceWorkerCache(outDir, catalog);
  const answerKey = opts.skipAnswerKey ? require("../backend/answer-key") : writeAnswerKey();

  return {
    subjects: catalogSubjects.length,
    questions: searchQuestions.length,
    lectures: lectureStats.count,
    collections: Object.keys(answerKey.collections).length,
    resources: catalogResources.length,
    swRevision,
  };
}

if (require.main === module) {
  const stats = buildPublicSite();
  console.log(
    `Built public/ cleanly: ${stats.subjects} subjects, ${stats.collections} graded collections, ` +
    `${stats.questions} questions, ${stats.lectures} lecture pages, ${stats.resources} resources.`
  );
}

module.exports = { buildPublicSite };
