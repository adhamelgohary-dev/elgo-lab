#!/usr/bin/env node
/**
 * Safe Static Bundled Quiz Removal CLI (`tools/remove-bundled-quiz.js`)
 *
 * Physically removes a single exact bundled quiz/sheet/lecture collection from
 * `content/subjects/<subjectId>.json`, writes a recoverable JSON backup first,
 * preserves all unrelated collections/questions, and optionally rebuilds `public/`
 * and `backend/answer-key.js`.
 *
 * Usage:
 *   node tools/remove-bundled-quiz.js <subjectId> <quizId> [--dry-run] [--no-build] [--backup-dir <dir>]
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function removeBundledQuiz(options) {
  const opts = options || {};
  const rootDir = opts.rootDir ? path.resolve(opts.rootDir) : ROOT;
  const subjectId = String(opts.subjectId || "").trim();
  const quizId = String(opts.quizId || "").trim();
  const dryRun = Boolean(opts.dryRun);
  const skipBuild = Boolean(opts.skipBuild);
  const backupDir = opts.backupDir
    ? path.resolve(opts.backupDir)
    : path.join(rootDir, "tmp", "deleted-quiz-backups");

  if (!subjectId || !quizId || subjectId.includes("*") || quizId.includes("*") || subjectId.includes("..") || quizId.includes("..")) {
    throw new Error("Exact, non-wildcard subjectId and quizId are required.");
  }

  const subjectFile = path.join(rootDir, "content", "subjects", `${subjectId}.json`);
  if (!fs.existsSync(subjectFile)) {
    throw new Error(`Subject file not found: ${subjectFile}`);
  }

  const subjectData = JSON.parse(fs.readFileSync(subjectFile, "utf8"));
  const buckets = ["quizzes", "sheets", "lectures"];
  let foundBucket = null;
  let foundIndex = -1;
  let removedCollection = null;

  for (const bucket of buckets) {
    const arr = Array.isArray(subjectData[bucket]) ? subjectData[bucket] : [];
    const idx = arr.findIndex((item) => item && item.id === quizId);
    if (idx !== -1) {
      foundBucket = bucket;
      foundIndex = idx;
      removedCollection = arr[idx];
      break;
    }
  }

  if (!foundBucket || !removedCollection) {
    throw new Error(`Quiz "${quizId}" not found in subject "${subjectId}".`);
  }

  const questionCount = Array.isArray(removedCollection.questions) ? removedCollection.questions.length : 0;
  const remainingCollections = buckets.reduce((sum, b) => {
    const len = Array.isArray(subjectData[b]) ? subjectData[b].length : 0;
    return sum + (b === foundBucket ? len - 1 : len);
  }, 0);

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      subjectId,
      quizId,
      bucket: foundBucket,
      removedTitle: removedCollection.title || quizId,
      removedQuestionCount: questionCount,
      remainingCollections,
      backupPath: null
    };
  }

  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeName = `bundled-backup-${subjectId}-${quizId}-${stamp}.json`.replace(/[^A-Za-z0-9._-]+/g, "_");
  const backupPath = path.join(backupDir, safeName);
  fs.writeFileSync(backupPath, JSON.stringify({
    schemaVersion: "elgo-bundled-quiz-backup-v1",
    exportedAt: new Date().toISOString(),
    subjectId,
    quizId,
    bucket: foundBucket,
    collection: removedCollection
  }, null, 2) + "\n", "utf8");

  subjectData[foundBucket] = subjectData[foundBucket].filter((_, idx) => idx !== foundIndex);
  fs.writeFileSync(subjectFile, JSON.stringify(subjectData, null, 2) + "\n", "utf8");

  if (!skipBuild && rootDir === ROOT) {
    const { buildPublicSite } = require("./build");
    buildPublicSite();
  }

  return {
    ok: true,
    dryRun: false,
    subjectId,
    quizId,
    bucket: foundBucket,
    removedTitle: removedCollection.title || quizId,
    removedQuestionCount: questionCount,
    remainingCollections,
    backupPath
  };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const positional = args.filter((a) => !a.startsWith("--"));
  const dryRun = args.includes("--dry-run");
  const skipBuild = args.includes("--no-build");
  const backupIdx = args.indexOf("--backup-dir");
  const backupDir = backupIdx !== -1 ? args[backupIdx + 1] : undefined;

  if (positional.length < 2) {
    console.error("Usage: node tools/remove-bundled-quiz.js <subjectId> <quizId> [--dry-run] [--no-build] [--backup-dir <dir>]");
    process.exit(1);
  }
  try {
    const res = removeBundledQuiz({ subjectId: positional[0], quizId: positional[1], dryRun, skipBuild, backupDir });
    console.log(JSON.stringify(res, null, 2));
  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  }
}

module.exports = { removeBundledQuiz };
