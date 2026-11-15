#!/usr/bin/env node
/**
 * Read-only Usernames Audit Script (`tools/audit-usernames.js`)
 *
 * Scans a local D1 SQL export file against `backend/username-moderation.js`
 * and prints a JSON report to stdout (or writes `--out <file>`).
 *
 * Usage:
 *   node tools/audit-usernames.js <path-to-d1-dump.sql> [--out report.json]
 */
"use strict";

const fs = require("fs");
const path = require("path");
const moderation = require("../backend/username-moderation");

function parseSqlUsernames(sqlContent) {
  const usernames = new Set();

  const userInsertRegex = /INSERT\s+INTO\s+users\s*(?:\([^)]+\))?\s*VALUES\s*([^;]+);/gi;
  let match;
  while ((match = userInsertRegex.exec(sqlContent)) !== null) {
    const tupleRegex = /\(\s*'([^']+)'\s*,\s*'([^']+)'/g;
    let tuple;
    while ((tuple = tupleRegex.exec(match[1])) !== null) {
      if (tuple[2]) usernames.add(tuple[2]);
    }
  }

  const scoreInsertRegex = /INSERT\s+INTO\s+best_scores\s*(?:\([^)]+\))?\s*VALUES\s*([^;]+);/gi;
  while ((match = scoreInsertRegex.exec(sqlContent)) !== null) {
    const stringLiterals = [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    stringLiterals.forEach((lit) => {
      if (!lit.startsWith("stu_") && !lit.startsWith("gst_") && !lit.startsWith("quiz_") && !lit.includes("-") && lit.length >= 3 && lit.length <= 24) {
        usernames.add(lit);
      }
    });
  }

  return Array.from(usernames).sort();
}

function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  let outFile = null;
  if (outIdx !== -1 && args[outIdx + 1]) {
    outFile = path.resolve(process.cwd(), args[outIdx + 1]);
  }
  const sqlArg = args.find((a, i) => !a.startsWith("--") && i !== outIdx + 1);
  if (!sqlArg) {
    console.error("Usage: node tools/audit-usernames.js <dump.sql> [--out report.json]");
    process.exit(1);
  }

  const resolvedPath = path.resolve(process.cwd(), sqlArg);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`Error: File not found at ${resolvedPath}`);
    process.exit(1);
  }

  const sqlContent = fs.readFileSync(resolvedPath, "utf8");
  const extracted = parseSqlUsernames(sqlContent);
  const flagged = [];
  const approved = [];

  for (const uname of extracted) {
    const check = moderation.checkModeration(uname);
    if (!check.ok) {
      flagged.push({ username: uname, reason: "Violates username moderation policy" });
    } else {
      approved.push(uname);
    }
  }

  const report = {
    auditedAt: new Date().toISOString(),
    inputFile: resolvedPath,
    totalScanned: extracted.length,
    approvedCount: approved.length,
    flaggedCount: flagged.length,
    flaggedUsernames: flagged,
  };

  const json = JSON.stringify(report, null, 2);
  if (outFile) {
    fs.writeFileSync(outFile, json + "\n", "utf8");
    console.log(`Audit report written to ${outFile}`);
  } else {
    console.log(json);
  }
}

main();
