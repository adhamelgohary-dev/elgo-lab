#!/usr/bin/env node
/**
 * Change the Elgo Lab MASTER administrator password (launched by manage-admin-password.bat).
 *
 * How the master password works: it is not stored in the database. The backend reads it from the
 * Cloudflare Pages secret ADMIN_PASSWORD_HASH (preferred) or the legacy plaintext secret ADMIN_PASSWORD.
 * This tool:
 *   1. checks that Wrangler is installed and logged in (your existing login; no tokens are stored here),
 *   2. asks for the new password twice with hidden input (never printed, never written to disk),
 *   3. hashes it with salted PBKDF2-SHA256 (the same format the backend uses for student passwords),
 *   4. stores only the hash as the Pages secret ADMIN_PASSWORD_HASH,
 *   5. offers to remove the old plaintext ADMIN_PASSWORD secret, and
 *   6. offers to sign out existing master-admin sessions.
 * Student and co-admin passwords live in the users table and are never touched.
 * Like every Pages secret change, the new password takes effect with the next deployment (deploy.bat).
 */
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ITERATIONS = 100000; // must not exceed the backend's PBKDF2 maximum (backend/worker.js)
const MIN_LENGTH = 12;
const ROOT = path.resolve(__dirname, "..");

/** Resolve Pages project & D1 database names from env overrides, wrangler.toml, or wrangler.example.toml. */
function resolveWranglerTarget(rootDir) {
  const base = rootDir || ROOT;
  let project = process.env.ELGO_PAGES_PROJECT || "";
  let db = process.env.ELGO_D1_DB || "";
  for (const rel of ["wrangler.toml", "wrangler.example.toml"]) {
    const file = path.join(base, rel);
    if (!fs.existsSync(file)) continue;
    const raw = fs.readFileSync(file, "utf8");
    if (!project) {
      const m = raw.match(/^\s*name\s*=\s*"([^"]+)"/m);
      if (m) project = m[1].trim();
    }
    if (!db) {
      const m = raw.match(/^\s*database_name\s*=\s*"([^"]+)"/m);
      if (m) db = m[1].trim();
    }
    if (project && db) break;
  }
  return {
    project: project || "elgo-lab",
    db: db || "elgo_lab_db",
  };
}

const { project: PROJECT, db: DB } = resolveWranglerTarget();

/** Same format as hashUserPassword() in backend/worker.js: pbkdf2$<iterations>$<salt hex>$<digest hex>. */
function hashAdminPassword(password, iterations) {
  const iter = iterations || ITERATIONS;
  const salt = crypto.randomBytes(16);
  const digest = crypto.pbkdf2Sync(String(password), salt, iter, 32, "sha256");
  return `pbkdf2$${iter}$${salt.toString("hex")}$${digest.toString("hex")}`;
}

function checkStrength(password) {
  if (password.length < MIN_LENGTH) return `Use at least ${MIN_LENGTH} characters.`;
  if (password.length > 200) return "Use at most 200 characters.";
  if (/^(.)\1+$/.test(password)) return "Do not repeat a single character.";
  const lower = password.toLowerCase();
  if (["password", "123456", "qwerty", "admin", "elgo", "mcq", "letmein"].some((w) => lower.includes(w)) && password.length < 20) {
    return "Avoid common words such as 'password', 'admin' or the site name.";
  }
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (classes < 3 && password.length < 16) return "Mix at least three of: lowercase, uppercase, digits, symbols (or use 16+ characters).";
  return "";
}

function wrangler(args, input) {
  // npx resolves to npx.cmd on Windows, so a shell is needed. Secrets only ever travel through stdin.
  // All arguments are fixed constants from this file (never user input), joined into one command line.
  const command = ["npx", "--yes", "wrangler@4"].concat(args).join(" ");
  const res = spawnSync(command, {
    cwd: ROOT, shell: true, encoding: "utf8", input: input === undefined ? "" : input, timeout: 3 * 60 * 1000
  });
  return { ok: res.status === 0, out: `${res.stdout || ""}${res.stderr || ""}` };
}

function ask(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const onData = (buf) => { process.stdin.removeListener("data", onData); process.stdin.pause(); resolve(String(buf).trim()); };
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}

/** Hidden input: characters are not echoed. */
function askHidden(question) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) return reject(new Error("Run this from a terminal window (double-click manage-admin-password.bat)."));
    process.stdout.write(question);
    let value = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (ch) => {
      for (const c of ch) {
        if (c === "\r" || c === "\n") { finish(); return; }
        if (c === "\u0003") { cleanup(); process.stdout.write("\n"); reject(new Error("Cancelled.")); return; }
        if (c === "\u0008" || c === "\u007f") { value = value.slice(0, -1); continue; }
        if (c >= " ") value += c;
      }
    };
    const cleanup = () => { stdin.setRawMode(false); stdin.pause(); stdin.removeListener("data", onData); };
    const finish = () => { cleanup(); process.stdout.write("\n"); resolve(value); };
    stdin.on("data", onData);
  });
}

async function main() {
  if (process.argv.includes("--hash")) {
    console.log("\nELGO LAB - generate ADMIN_PASSWORD_HASH for self-hosted servers / Docker / .env\n");
    let pwd = "";
    for (;;) {
      pwd = await askHidden("  Enter desired admin password: ");
      const problem = checkStrength(pwd);
      if (!problem) break;
      console.log("  Try again: " + problem + "\n");
    }
    const confirmPwd = await askHidden("  Type it again: ");
    if (confirmPwd !== pwd) {
      console.error("  FAIL  Passwords did not match.");
      return 1;
    }
    const hash = hashAdminPassword(pwd);
    console.log("\nPaste this line into your .env file or server environment variables:\n");
    console.log(`ADMIN_PASSWORD_HASH=${hash}\n`);
    return 0;
  }

  console.log("\nELGO LAB - change the master administrator password\n");
  console.log("This changes ONLY the master admin password (the one used on the Admin Access screen).");
  console.log("Student and co-admin accounts are not affected.\n");

  console.log("[1/6] Checking Wrangler and your Cloudflare login ...");
  const who = wrangler(["whoami"]);
  if (!/You are logged in/.test(who.out)) {
    console.error("  FAIL  Wrangler is not logged in. Run:  npx wrangler login   then start this tool again.");
    return 1;
  }
  const list = wrangler(["pages", "secret", "list", "--project-name", PROJECT]);
  if (!list.ok) { console.error("  FAIL  Could not read the Pages project secrets:\n" + list.out); return 1; }
  const hasPlain = /\bADMIN_PASSWORD\b(?!_HASH)/.test(list.out);
  const hasHash = /\bADMIN_PASSWORD_HASH\b/.test(list.out);
  console.log(`  OK    logged in; project "${PROJECT}" currently has: ${[hasHash && "ADMIN_PASSWORD_HASH", hasPlain && "ADMIN_PASSWORD"].filter(Boolean).join(", ") || "no admin secret"}`);

  console.log("\n[2/6] Choose the new password (typing is hidden).");
  let password = "";
  for (;;) {
    password = await askHidden("  New password: ");
    const problem = checkStrength(password);
    if (problem) { console.log("  " + problem + " Try again."); continue; }
    const again = await askHidden("  Repeat it:    ");
    if (again !== password) { console.log("  The two entries do not match. Try again."); continue; }
    break;
  }

  console.log("\n[3/6] Hashing (salted PBKDF2-SHA256, " + ITERATIONS.toLocaleString() + " iterations) ...");
  const hash = hashAdminPassword(password);
  // Verify with the backend's own code before uploading anything.
  const worker = require(path.join(ROOT, "backend", "worker.js"));
  const verified = await worker.verifyUserPassword(password, hash);
  password = "";
  if (!verified.ok) { console.error("  FAIL  The backend could not verify the new hash. Nothing was changed."); return 1; }
  console.log("  OK    hash created and verified with backend/worker.js");

  console.log("\n[4/6] Saving the hash as the Pages secret ADMIN_PASSWORD_HASH ...");
  const put = wrangler(["pages", "secret", "put", "ADMIN_PASSWORD_HASH", "--project-name", PROJECT], hash + "\n");
  if (!put.ok || /error/i.test(put.out) && !/Success/i.test(put.out)) {
    console.error("  FAIL  Wrangler could not save the secret. The old password is still active.\n" + put.out.replace(/pbkdf2\$[^\s]+/g, "[hash]"));
    return 1;
  }
  console.log("  OK    ADMIN_PASSWORD_HASH saved (only the hash; the password itself never left this PC)");

  console.log("\n[5/6] Old plaintext secret");
  if (hasPlain) {
    const answer = (await ask("  Remove the old plaintext ADMIN_PASSWORD secret? Recommended. [Y/n] ")).toLowerCase();
    if (answer === "" || answer === "y" || answer === "yes") {
      const del = wrangler(["pages", "secret", "delete", "ADMIN_PASSWORD", "--project-name", PROJECT], "y\n");
      console.log(del.ok ? "  OK    ADMIN_PASSWORD removed" : "  WARN  Could not remove ADMIN_PASSWORD (the new hash still takes priority):\n" + del.out);
    } else {
      console.log("  Kept. The new ADMIN_PASSWORD_HASH takes priority over it.");
    }
  } else {
    console.log("  Nothing to remove.");
  }

  console.log("\n[6/6] Existing admin sessions");
  const signOut = (await ask("  Sign out every current master-admin session now? [y/N] ")).toLowerCase();
  if (signOut === "y" || signOut === "yes") {
    const res = wrangler(["d1", "execute", DB, "--remote", "--command", "\"DELETE FROM admin_sessions\""]);
    console.log(res.ok ? "  OK    master-admin sessions cleared (students and co-admins stay signed in)" : "  WARN  Could not clear sessions:\n" + res.out);
  } else {
    console.log("  Skipped. Existing admin sessions expire on their own within 4 hours.");
  }

  console.log("\nDONE. The new password takes effect with the next deployment.");
  console.log("Run deploy.bat to publish it, then sign in on the Admin Access screen with the new password.\n");
  return 0;
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code; }).catch((err) => { console.error("\n" + err.message); process.exitCode = 1; });
}

module.exports = { hashAdminPassword, checkStrength, resolveWranglerTarget, ITERATIONS };
