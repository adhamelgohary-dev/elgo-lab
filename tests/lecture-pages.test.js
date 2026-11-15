"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildPublicSite } = require("../tools/build");

test("each lecture builds into a standalone CSP-clean /learn/<subject>/<lecture>/index.html page", () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "elgo-learn-test-"));
  try {
    const stats = buildPublicSite({ outDir, skipAnswerKey: true });
    assert.equal(stats.lectures, 1);

    const catalog = JSON.parse(fs.readFileSync(path.join(outDir, "data/catalog.json"), "utf8"));
    for (const lec of catalog.lectures) {
      assert.equal(lec.hasPage, true, `${lec.subjectId}/${lec.id} should have an HTML study page`);
      const pagePath = path.join(outDir, "learn", lec.subjectId, lec.id, "index.html");
      assert.ok(fs.existsSync(pagePath), `Missing built page: ${pagePath}`);
      const html = fs.readFileSync(pagePath, "utf8");
      assert.match(html, /<article class="lecture-article">[\s\S]{30,}<\/article>/);
      assert.match(html, /src="\/src\/app\/theme\.js"/);
      assert.match(html, /src="\/src\/app\/lecture-page\.js"/);
      assert.doesNotMatch(html, /<script\b(?![^>]*\bsrc=)[^>]*>/i, "No inline scripts (CSP)");
    }
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});
