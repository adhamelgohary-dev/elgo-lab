"use strict";
/**
 * Existing usernames that the moderation rules reject are hidden on the leaderboard
 * (display only: the accounts and their scores stay in the database).
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const worker = require("../backend/worker");
const { createEnv } = require("./helpers/d1-sqlite");

async function board(env, query) {
  const res = await worker.handleApiRequest(new Request("http://x/api/leaderboard" + (query || "")), env);
  return (await res.json()).entries;
}

test("a username that fails moderation is hidden on the leaderboard, ranks are renumbered, data is kept", async () => {
  const env = createEnv();
  const db = env.sqlite;
  const rows = [
    ["stu_a", "good_student", 30],
    ["stu_b", "fuckyou99", 29], // legacy name that would be rejected today
    ["stu_c", "Mohamed Ali", 28]
  ];
  rows.forEach(([id, name]) => db.prepare("INSERT INTO users (student_id, username, display_name) VALUES (?, ?, ?)").run(id, name, name));
  rows.forEach(([id, name, score]) => db.prepare(
    "INSERT INTO best_scores (student_id, subject_id, quiz_id, username, best_score, total, best_percentage, fastest_duration_ms, validated_by_server) VALUES (?, 's', 'q', ?, ?, 30, ?, 600000, 1)"
  ).run(id, name, score, Math.round((score / 30) * 100)));

  const entries = await board(env);
  assert.deepEqual(entries.map((e) => e.username), ["good_student", "Mohamed Ali"], "the rejected name is not shown");
  assert.deepEqual(entries.map((e) => e.rank), [1, 2], "ranks are renumbered with no gap");
  assert.equal(JSON.stringify(entries).includes("fuckyou"), false, "the name appears nowhere in the payload");

  assert.equal(db.prepare("SELECT COUNT(*) n FROM users").get().n, 3, "no account is deleted");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM best_scores").get().n, 3, "no score is deleted");
});

test("hiding names does not shorten the list below the requested limit when enough clean names exist", async () => {
  const env = createEnv();
  const db = env.sqlite;
  for (let i = 0; i < 6; i += 1) {
    const bad = i < 3; // the three best scores belong to rejected names
    const name = bad ? "fuckyou" + i : "student_" + i;
    db.prepare("INSERT INTO users (student_id, username, display_name) VALUES (?, ?, ?)").run("s" + i, name, name);
    db.prepare("INSERT INTO best_scores (student_id, subject_id, quiz_id, username, best_score, total, best_percentage, fastest_duration_ms, validated_by_server) VALUES (?, 's', 'q', ?, ?, 30, 100, 600000, 1)")
      .run("s" + i, name, 30 - i);
  }
  const entries = await board(env, "?limit=3");
  assert.equal(entries.length, 3);
  assert.ok(entries.every((e) => e.username.startsWith("student_")));
});
