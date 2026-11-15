#!/usr/bin/env node
/**
 * Generate standalone CSP-clean lecture study pages under `public/learn/<subjectId>/<lectureId>/index.html`
 * from `content/subjects/*.json` + `content/lecture-pages/<subjectId>/<lectureId>.html`.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const LECTURE_PAGES_DIR = path.join(ROOT, "content", "lecture-pages");

function escHtml(str) {
  return String(str == null ? "" : str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function extractBody(rawHtml) {
  const match = rawHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return (match ? match[1] : rawHtml).trim();
}

const UNSAFE_HTML_RE = /<\s*\/?\s*(script|iframe|object|embed|base|link|meta|style|form)\b|\bon[a-z]+\s*=|\b(?:href|src)\s*=\s*["']?\s*(?:javascript|data|https?|\/\/):?/i;

function renderLectureHtml({ subject, lecture, bodyHtml }) {
  const subjTitle = subject.name || subject.id;
  const lecTitle = lecture.title || lecture.id;
  const backCourseHref = `/?flow=hub&subject=${encodeURIComponent(subject.id)}&view=learn`;
  const practiceHref = `/?flow=hub&subject=${encodeURIComponent(subject.id)}&view=sources`;

  return `<!doctype html>
<html lang="en" data-theme="evening">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="theme-color" content="#191A1C">
  <title>${escHtml(lecTitle)} · ${escHtml(subjTitle)} — Elgo Lab</title>
  <link rel="icon" type="image/png" href="/icons/icon-192.png">
  <script src="/src/app/theme.js"></script>
  <link rel="stylesheet" href="/src/styles/tokens.css">
  <link rel="stylesheet" href="/src/styles/app.css">
  <link rel="stylesheet" href="/src/styles/lecture.css">
  <script defer src="/src/app/offline-export.js"></script>
  <script defer src="/src/app/lecture-page.js"></script>
</head>
<body class="lecture-route">
  <div class="garden" aria-hidden="true">
    <svg class="botanical botanical-left" viewBox="0 0 320 700" fill="none"><path class="botanical-stem" d="M48 720C180 540 100 327 268 45M125 564 37 431M141 435 253 300M181 287 103 174"/><g class="botanical-leaf"><path d="M114 558C20 548-2 471 26 412c72 18 104 73 88 146Z"/><path d="M143 440c-11-99 45-158 125-159 11 80-36 143-125 159Z"/><path d="M183 295C96 286 65 219 92 155c77 23 104 67 91 140Z"/><path d="M221 183c-2-81 46-125 98-117 3 63-31 106-98 117Z"/></g><path class="botanical-vein" d="m36 431 78 127m29-118 110-140m-70-5-80-121m118 9 79-99"/></svg>
    <svg class="botanical botanical-right" viewBox="0 0 320 700" fill="none"><path class="botanical-stem" d="M48 720C180 540 100 327 268 45M125 564 37 431M141 435 253 300M181 287 103 174"/><g class="botanical-leaf"><path d="M114 558C20 548-2 471 26 412c72 18 104 73 88 146Z"/><path d="M143 440c-11-99 45-158 125-159 11 80-36 143-125 159Z"/><path d="M183 295C96 286 65 219 92 155c77 23 104 67 91 140Z"/><path d="M221 183c-2-81 46-125 98-117 3 63-31 106-98 117Z"/></g><path class="botanical-vein" d="m36 431 78 127m29-118 110-140m-70-5-80-121m118 9 79-99"/></svg>
  </div>
  <div class="lecture-shell product">
    <header class="lecture-topbar product-header">
      <a class="wordmark lecture-brand" href="/">
        <img src="/assets/mascot/mascot-clay.webp" alt="" width="36" height="36">
        <span>elgo lab<span class="brand-dot">.</span></span>
      </a>
      <div class="lecture-top-actions">
        <button type="button" class="theme-toggle lec-btn" id="lecThemeToggle" aria-label="Switch color theme"><span class="theme-symbol" aria-hidden="true">☀</span><span id="lecThemeLabel">Daylight</span></button>
        <a class="lec-btn secondary" href="${backCourseHref}">← Back to lectures</a>
        <a class="lec-btn primary lec-btn-primary" href="${practiceHref}">Practice Questions →</a>
      </div>
    </header>

    <main id="appWorkspace" tabindex="-1" data-subject-id="${escHtml(subject.id)}" data-lecture-id="${escHtml(lecture.id)}">
      <section class="lecture-hero lecture-page-heading">
        <a class="page-back" href="${backCourseHref}">← ${escHtml(subjTitle)}</a>
        <p class="eyebrow lecture-eyebrow">LECTURE EXPLANATION · ${escHtml(subjTitle)}</p>
        <h1>${escHtml(lecTitle)}</h1>
        ${lecture.guide && lecture.guide.en ? `<p class="lecture-lead">${escHtml(lecture.guide.en)}</p>` : ""}
        ${lecture.guide && lecture.guide.ar ? `<p class="lecture-lead-ar" lang="ar" dir="rtl">${escHtml(lecture.guide.ar)}</p>` : ""}
      </section>

      <article class="lecture-article">
        ${bodyHtml}
      </article>
    </main>

    <footer class="product-footer creator-footer">
      <div class="creator-signature"><small>crafted with care</small><strong>by Adham<span aria-hidden="true">.</span></strong></div>
      <nav class="creator-contact" aria-label="Contact">
        <p class="contact-label">For contact</p>
        <a href="https://adhamelgohary.com" target="_blank" rel="noopener noreferrer">adhamelgohary.com ↗</a>
        <a href="https://www.linkedin.com/in/adham-elgohary-02a315387/" target="_blank" rel="noopener noreferrer">LinkedIn ↗</a>
        <a href="https://t.me/elgoo_0" target="_blank" rel="noopener noreferrer">Telegram · @elgoo_0 ↗</a>
      </nav>
    </footer>
  </div>
</body>
</html>
`;
}

function buildLecturePages(subjects, outPublicDir) {
  const routes = [];
  const learnRoot = path.join(outPublicDir, "learn");
  fs.mkdirSync(learnRoot, { recursive: true });

  for (const subject of subjects) {
    if (!subject || !subject.id) continue;
    const lectures = Array.isArray(subject.lectures) ? subject.lectures : [];
    for (const lec of lectures) {
      if (!lec || !lec.id) continue;
      if (!/^[\w-]+$/.test(subject.id) || !/^[\w-]+$/.test(lec.id)) {
        throw new Error(`Unsafe lecture identifier: ${subject.id}/${lec.id}`);
      }
      const srcPath = path.join(LECTURE_PAGES_DIR, subject.id, `${lec.id}.html`);
      if (!fs.existsSync(srcPath)) continue;
      const raw = fs.readFileSync(srcPath, "utf8");
      const bodyHtml = extractBody(raw);
      if (UNSAFE_HTML_RE.test(bodyHtml)) {
        throw new Error(`Unsupported active content in lecture page: ${subject.id}/${lec.id}.html`);
      }
      const html = renderLectureHtml({ subject, lecture: lec, bodyHtml });
      const targetDir = path.join(learnRoot, subject.id, lec.id);
      fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(path.join(targetDir, "index.html"), html, "utf8");
      routes.push(`/learn/${subject.id}/${lec.id}/`);
    }
  }

  return { count: routes.length, routes };
}

if (require.main === module) {
  const subjectsDir = path.join(ROOT, "content", "subjects");
  const subjects = fs.readdirSync(subjectsDir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(subjectsDir, f), "utf8")));
  const res = buildLecturePages(subjects, path.join(ROOT, "public"));
  console.log(`Built ${res.count} lecture pages in public/learn/.`);
}

module.exports = { buildLecturePages, renderLectureHtml };
