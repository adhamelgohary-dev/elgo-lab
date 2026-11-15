"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createEnv, legacyThenMigratedDb } = require("./helpers/d1-sqlite");
const worker = require("../backend/worker");
const fs = require("node:fs");
const path = require("node:path");
function ping(env, cookie, headers) {
  return worker.handleApiRequest(new Request("https://elgo.example/api/presence", {
    method: "POST", headers: Object.assign({ Origin: "https://elgo.example" }, cookie ? { Cookie: cookie } : {}, headers)
  }), env);
}
test("counts browsers, deduplicates tabs, and expires abandoned visits", async () => {
  const env = createEnv();
  const first = await ping(env);
  assert.equal((await first.json()).online, 1);
  assert.match(first.headers.get("Set-Cookie"), /HttpOnly; Secure; SameSite=Lax/);
  const cookie = first.headers.get("Set-Cookie").split(";")[0];
  const secondTab = await ping(env, cookie);
  assert.equal((await secondTab.json()).online, 1);
  const secondBrowser = await ping(env);
  assert.equal((await secondBrowser.json()).online, 2);
  env.sqlite.prepare("UPDATE site_presence SET last_seen = ?").run(Date.now() - 100000);
  assert.equal((await (await ping(env, cookie)).json()).online, 1);
  assert.equal(env.sqlite.prepare("SELECT COUNT(*) AS n FROM site_presence").get().n, 1);
});
test("does not cache or expose visitor ids and rejects cross-site registration", async () => {
  const env = createEnv();
  const res = await ping(env);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(Object.keys(await res.json()).sort(), ["activeWindowSeconds", "ok", "online"]);
  assert.equal((await ping(env, null, { Origin: "https://other.example" })).status, 403);
  assert.equal((await ping(env, null, { "Sec-Fetch-Site": "cross-site" })).status, 403);
});
test("missing presence migration reports unavailable, never a fake count", async () => {
  const env = createEnv();
  env.sqlite.exec("DROP TABLE site_presence");
  const res = await ping(env);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).code, "PRESENCE_UNAVAILABLE");
});
test("presence migration is additive and repeatable on an existing academic database", async () => {
  const db = legacyThenMigratedDb();
  const before = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
  const sql = fs.readFileSync(path.join(__dirname, "../backend/migrations/0004_site_presence.sql"), "utf8");
  db.exec(sql); db.exec(sql);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users").get().n, before);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM site_presence").get().n, 0);
});

test("admin online users endpoint exposes active usernames only to admins, tracks logout, and survives missing migration table", async () => {
  const env = createEnv({ adminPassword: "MasterStrongPassword!99" });

  // Guest + registered student sign in
  const gRes = await worker.handleApiRequest(new Request("https://elgo.example/api/auth/guest", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://elgo.example" },
    body: JSON.stringify({ username: "salma_guest" }),
  }), env);
  assert.equal(gRes.status, 200);
  const gData = await gRes.json();

  const rRes = await worker.handleApiRequest(new Request("https://elgo.example/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://elgo.example" },
    body: JSON.stringify({ username: "omar_student", password: "secure-password-123" }),
  }), env);
  assert.equal(rRes.status, 200);
  const rData = await rRes.json();

  // Named presence heartbeat with area still exposes ZERO usernames publicly
  const pRes = await worker.handleApiRequest(new Request("https://elgo.example/api/presence", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://elgo.example",
      Authorization: `Bearer ${rData.token}`,
    },
    body: JSON.stringify({ area: "player" }),
  }), env);
  assert.equal(pRes.status, 200);
  assert.deepEqual(Object.keys(await pRes.json()).sort(), ["activeWindowSeconds", "ok", "online"]);

  // Unauthenticated and student callers cannot read /api/admin/online-users
  assert.equal((await worker.handleApiRequest(new Request("https://elgo.example/api/admin/online-users"), env)).status, 401);
  assert.equal((await worker.handleApiRequest(new Request("https://elgo.example/api/admin/online-users", {
    headers: { Authorization: `Bearer ${rData.token}` },
  }), env)).status, 401);

  // Admin login and read live online users
  const admRes = await worker.handleApiRequest(new Request("https://elgo.example/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://elgo.example" },
    body: JSON.stringify({ password: "MasterStrongPassword!99" }),
  }), env);
  assert.equal(admRes.status, 200);
  const adminCookie = admRes.headers.get("set-cookie").split(";")[0];

  const list1 = await worker.handleApiRequest(new Request("https://elgo.example/api/admin/online-users", {
    headers: { Cookie: adminCookie },
  }), env);
  assert.equal(list1.status, 200);
  const d1 = await list1.json();
  assert.equal(d1.ok, true);
  assert.equal(d1.identifiedCount, 2);
  assert.ok(d1.totalOnline >= 2);
  const omar = d1.users.find((u) => u.username === "omar_student");
  const salma = d1.users.find((u) => u.username === "salma_guest");
  assert.ok(omar && !omar.isGuest && omar.currentArea === "player");
  assert.ok(salma && salma.isGuest === true);

  // Logout immediately removes student from online users
  const loRes = await worker.handleApiRequest(new Request("https://elgo.example/api/auth/logout", {
    method: "POST",
    headers: { Origin: "https://elgo.example", Authorization: `Bearer ${rData.token}` },
  }), env);
  assert.equal(loRes.status, 200);

  const list2 = await worker.handleApiRequest(new Request("https://elgo.example/api/admin/online-users", {
    headers: { Cookie: adminCookie },
  }), env);
  const d2 = await list2.json();
  assert.equal(d2.users.some((u) => u.username === "omar_student"), false);
  assert.equal(d2.users.some((u) => u.username === "salma_guest"), true);

  // Migration 0006 fallback: even if online_users_presence table is absent, fallback works cleanly
  env.sqlite.exec("DROP TABLE online_users_presence");
  const fbPing = await worker.handleApiRequest(new Request("https://elgo.example/api/presence", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://elgo.example",
      Authorization: `Bearer ${gData.token}`,
    },
    body: JSON.stringify({ area: "leaderboard" }),
  }), env);
  assert.equal(fbPing.status, 200);
  const listFb = await worker.handleApiRequest(new Request("https://elgo.example/api/admin/online-users", {
    headers: { Cookie: adminCookie },
  }), env);
  const dFb = await listFb.json();
  assert.equal(dFb.users.some((u) => u.username === "salma_guest" && u.currentArea === "leaderboard"), true);
});

test("migration 0006 is additive and repeatable on an existing academic database", () => {
  const db = legacyThenMigratedDb();
  const sql = fs.readFileSync(path.join(__dirname, "../backend/migrations/0006_online_user_presence.sql"), "utf8");
  db.exec(sql);
  db.exec(sql);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM online_users_presence").get().n, 0);
});
