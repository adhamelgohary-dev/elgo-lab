/**
 * Bank Question — Online Student Identity, Leaderboard & Cloudflare Sync Client
 *
 * Responsibilities:
 *  1. Maintain a persistent anonymous student `playerId` (`mcq_bank_player_id_v1`)
 *     and student profile (`mcq_bank_student_profile_v1`) with unique username.
 *  2. Synchronize username registration and controlled updates with the
 *     Cloudflare Worker + D1 API (`POST /api/user/profile`) while keeping a
 *     local mirror so the UI works offline or in local static preview.
 *  3. Submit completed quiz/lecture/sheet attempts (`POST /api/quiz/submit`)
 *     with full question-by-question answers and duration for server-side
 *     answer-key validation and anti-replay protection.
 *  4. Query the live Leaderboard (`GET /api/leaderboard`) with subject & quiz
 *     filters, tie-broken by best score then fastest duration, with automatic
 *     fallback to locally recorded validated attempts when offline.
 */
(function (root) {
  "use strict";

  const PLAYER_ID_KEY = "mcq_bank_player_id_v1";
  const PROFILE_KEY = "mcq_bank_student_profile_v1";
  const LOCAL_LEADERBOARD_KEY = "mcq_bank_local_leaderboard_v1";
  const PENDING_ATTEMPTS_KEY = "mcq_bank_pending_attempts_v1";
  const USERNAME_PROMPT_DISMISSED_KEY = "mcq_bank_username_prompt_dismissed_v1";

  const USERNAME_REGEX = /^(?:[A-Za-z0-9 _-]|[\u0620-\u065F\u0660-\u0669\u066E-\u06D3\u06D5\u06EE-\u06FC\u06FF]){3,24}$/u;
  const RESERVED_USERNAMES = ["admin", "administrator", "root", "system", "moderator", "faculty", "instructor", "support"];
  const MAX_USERNAME_CHANGES = 3;

  function generatePlayerId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return "stu_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
    }
    const rnd = Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
    return "stu_" + rnd;
  }

  function validateUsername(raw) {
    const clean = String(raw || "").normalize("NFKC").trim().replace(/\s+/g, " ");
    if (!clean) {
      return { ok: false, message: "Please enter a username." };
    }
    if (clean.length < 3 || clean.length > 24) {
      return { ok: false, message: "Username must be between 3 and 24 characters." };
    }
    if (!USERNAME_REGEX.test(clean)) {
      return {
        ok: false,
        message: "Use only letters (English or Arabic), numbers, spaces, hyphens, or underscores (_).",
      };
    }
    const moderation = moderateUsername(clean);
    if (!moderation.ok) return moderation;
    if (RESERVED_USERNAMES.includes(clean.toLowerCase())) {
      return { ok: false, message: "This username is reserved." };
    }
    return { ok: true, username: clean };
  }

  function moderateUsername(value) {
    // Authoritative moderation is handled by server validateUsernameServer()
    // without leaking the blocklist dictionary into public client bundles.
    return { ok: true };
  }

  function formatDuration(ms) {
    const totalSec = Math.max(1, Math.round((Number(ms) || 0) / 1000));
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    if (mins === 0) return `${secs}s`;
    return `${mins}m ${String(secs).padStart(2, "0")}s`;
  }

  function createOnlineClient(options) {
    const opts = options || {};
    const storage = opts.storage || (typeof localStorage !== "undefined" ? localStorage : null);
    const fetchImpl = opts.fetch || (typeof fetch === "function" ? fetch : null);
    const apiBase = String(opts.apiBase || "/api").replace(/\/+$/, "");
    const getAuthToken = typeof opts.getAuthToken === "function" ? opts.getAuthToken : () => "";

    function readJson(key, fallback) {
      if (!storage) return fallback;
      try {
        const raw = storage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (_err) {
        return fallback;
      }
    }

    function writeJson(key, value) {
      if (!storage) return;
      try {
        storage.setItem(key, JSON.stringify(value));
      } catch (_err) {
        /* ignore quota errors */
      }
    }

    function getOrCreatePlayerId() {
      if (!storage) return generatePlayerId();
      try {
        let id = storage.getItem(PLAYER_ID_KEY);
        if (!id || typeof id !== "string" || id.length < 6) {
          id = generatePlayerId();
          storage.setItem(PLAYER_ID_KEY, id);
        }
        return id;
      } catch (_err) {
        return generatePlayerId();
      }
    }

    function getProfile() {
      const playerId = getOrCreatePlayerId();
      const saved = readJson(PROFILE_KEY, null);
      if (saved && saved.playerId === playerId) {
        return saved;
      }
      const initial = {
        playerId,
        username: saved && saved.username ? saved.username : "",
        changeCount: saved && Number.isFinite(saved.changeCount) ? saved.changeCount : 0,
        updatedAt: saved && saved.updatedAt ? saved.updatedAt : null,
      };
      writeJson(PROFILE_KEY, initial);
      return initial;
    }

    function shouldPromptForUsername() {
      const profile = getProfile();
      if (profile.username) return false;
      if (!storage) return false;
      try {
        return storage.getItem(USERNAME_PROMPT_DISMISSED_KEY) !== "1";
      } catch (_err) {
        return false;
      }
    }

    function dismissUsernamePrompt() {
      if (!storage) return;
      try {
        storage.setItem(USERNAME_PROMPT_DISMISSED_KEY, "1");
      } catch (_err) {
        /* ignore */
      }
    }

    async function saveUsername(rawUsername) {
      const check = validateUsername(rawUsername);
      if (!check.ok) return check;

      const current = getProfile();
      const nextUsername = check.username;
      if (current.username && current.username.toLowerCase() === nextUsername.toLowerCase()) {
        return { ok: true, profile: current, unchanged: true };
      }

      if (current.username && current.changeCount >= MAX_USERNAME_CHANGES) {
        return {
          ok: false,
          message: `Username change limit reached (${MAX_USERNAME_CHANGES} changes maximum).`,
        };
      }

      // Check local leaderboard entries for duplicate username belonging to a different playerId
      const localEntries = readJson(LOCAL_LEADERBOARD_KEY, []);
      const conflict = localEntries.find(
        (entry) =>
          entry.playerId !== current.playerId &&
          String(entry.username || "").toLowerCase() === nextUsername.toLowerCase()
      );
      if (conflict) {
        return { ok: false, message: "This username is already taken by another student." };
      }

      // Renaming the server account requires a logged-in session. Guests only keep a local
      // nickname (they cannot appear on the global leaderboard until they log in).
      const renameToken = String(getAuthToken() || "");
      if (fetchImpl && renameToken) {
        try {
          const res = await fetchImpl(`${apiBase}/user/profile`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${renameToken}` },
            body: JSON.stringify({ username: nextUsername }),
          });
          if (res && typeof res.json === "function") {
            const data = await res.json().catch(() => null);
            if (res.status === 409 || (data && data.reason === "username-taken")) {
              return {
                ok: false,
                message: (data && data.message) || "This username is already taken by another student.",
              };
            }
            if (res.status === 401) {
              return { ok: false, message: "Your session expired. Please log in again." };
            }
            if (res.status === 429 || (data && data.reason === "change-limit")) {
              return {
                ok: false,
                message: (data && data.message) || "Username change limit or cooldown active.",
              };
            }
            if (res.ok && data && data.ok && data.profile) {
              const synced = {
                playerId: current.playerId,
                username: data.profile.username || nextUsername,
                changeCount:
                  typeof data.profile.changeCount === "number"
                    ? data.profile.changeCount
                    : current.username
                    ? current.changeCount + 1
                    : 0,
                updatedAt: data.profile.updatedAt || new Date().toISOString(),
              };
              writeJson(PROFILE_KEY, synced);
              updateLocalLeaderboardUsername(current.playerId, synced.username);
              return { ok: true, profile: synced, online: true };
            }
          }
        } catch (_err) {
          /* Offline or local preview server: save locally below */
        }
      }

      const updated = {
        playerId: current.playerId,
        username: nextUsername,
        changeCount: current.username ? current.changeCount + 1 : 0,
        updatedAt: new Date().toISOString(),
      };
      writeJson(PROFILE_KEY, updated);
      updateLocalLeaderboardUsername(current.playerId, updated.username);
      return { ok: true, profile: updated, online: false };
    }

    async function deleteUserProfile(options) {
      const current = getProfile();
      const token = String(getAuthToken() || "");
      if (fetchImpl && token) {
        // Server account deletion needs the session AND the password (re-authentication).
        try {
          const res = await fetchImpl(`${apiBase}/user/profile`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ password: String((options && options.password) || "") })
          });
          if (res && !res.ok) {
            const data = res.json ? await res.json().catch(() => null) : null;
            return { ok: false, message: (data && data.error) || "Could not delete the account." };
          }
        } catch (_err) {
          return { ok: false, message: "Could not reach the server. Try again later." };
        }
      }
      const list = readJson(LOCAL_LEADERBOARD_KEY, []);
      const filtered = list.filter((item) => item.playerId !== current.playerId);
      writeJson(LOCAL_LEADERBOARD_KEY, filtered);

      remove(PROFILE_KEY);
      remove(PLAYER_ID_KEY);
      remove("mcq_bank_student_username_v1");
      remove("mcq_bank_synced_attempts_v2");
      return { ok: true, deleted: true };
    }

    function updateLocalLeaderboardUsername(playerId, username) {
      const list = readJson(LOCAL_LEADERBOARD_KEY, []);
      let changed = false;
      list.forEach((item) => {
        if (item.playerId === playerId && item.username !== username) {
          item.username = username;
          changed = true;
        }
      });
      if (changed) writeJson(LOCAL_LEADERBOARD_KEY, list);
    }

    function recordLocalAttempt(attempt) {
      const list = readJson(LOCAL_LEADERBOARD_KEY, []);
      const entry = {
        id: attempt.id || `att_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        playerId: attempt.playerId,
        username: attempt.username || "Student",
        subjectId: attempt.subjectId,
        subjectName: attempt.subjectName || attempt.subjectId,
        quizId: attempt.quizId,
        quizTitle: attempt.quizTitle || attempt.quizId,
        score: Number(attempt.score) || 0,
        totalQuestions: Math.max(1, Number(attempt.totalQuestions) || 1),
        percentage: Number(attempt.percentage) || 0,
        durationMs: Math.max(1000, Number(attempt.durationMs) || 15000),
        createdAt: attempt.createdAt || new Date().toISOString(),
      };
      list.push(entry);
      writeJson(LOCAL_LEADERBOARD_KEY, list.slice(-500));
      return entry;
    }

    function createAttemptId() {
      if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return "att_" + crypto.randomUUID();
      }
      return "att_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 12);
    }

    function readPendingAttempts() {
      const pending = readJson(PENDING_ATTEMPTS_KEY, []);
      return Array.isArray(pending) ? pending : [];
    }

    function writePendingAttempts(attempts) {
      writeJson(PENDING_ATTEMPTS_KEY, Array.isArray(attempts) ? attempts.slice(-100) : []);
    }

    function queueAttempt(attempt) {
      const pending = readPendingAttempts();
      if (!pending.some((item) => item && item.attemptId === attempt.attemptId)) {
        pending.push(attempt);
        writePendingAttempts(pending);
      }
    }

    const PERMANENT_REJECTIONS = [400, 403, 404, 409, 413, 415, 422];

    /**
     * Only answers are sent. The server grades them against its private key and ignores any
     * score/total/percentage the client might add. Returns { data } on success, { drop: true }
     * when the server will never accept this attempt, or { retry: true } for transient problems.
     */
    async function postAttempt(attempt) {
      if (!fetchImpl) return { retry: true };
      const authToken = String(getAuthToken() || "");
      if (!authToken) return { retry: true };
      try {
        const res = await fetchImpl(`${apiBase}/quiz/submit`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${authToken}` },
          body: JSON.stringify({
            subjectId: attempt.subjectId,
            quizId: attempt.quizId,
            quizTitle: attempt.quizTitle,
            mode: attempt.mode,
            answers: attempt.answers,
            durationMs: attempt.durationMs,
            attemptId: attempt.attemptId,
            submittedAt: attempt.submittedAt,
          }),
        });
        const data = res && typeof res.json === "function" ? await res.json().catch(() => null) : null;
        if (res && res.ok && data && data.ok) return { data };
        if (res && PERMANENT_REJECTIONS.indexOf(res.status) !== -1) return { drop: true };
        return { retry: true };
      } catch (_err) {
        return { retry: true };
      }
    }

    async function syncPendingAttempts() {
      const pending = readPendingAttempts();
      if (!pending.length || !fetchImpl) return { synced: 0, pending: pending.length };
      const unsynced = [];
      let synced = 0;
      for (let index = 0; index < pending.length; index += 1) {
        const outcome = await postAttempt(pending[index]);
        if (outcome.data) synced += 1;
        else if (!outcome.drop) unsynced.push(pending[index]);
      }
      writePendingAttempts(unsynced);
      return { synced, pending: unsynced.length };
    }

    async function submitQuizAttempt(payload) {
      if (!payload || !payload.subjectId || !payload.quizId) {
        return { ok: false, message: "Missing subjectId or quizId." };
      }
      const profile = getProfile();
      const attemptData = {
        playerId: profile.playerId,
        username: profile.username || "Student",
        subjectId: payload.subjectId,
        subjectName: payload.subjectName || payload.subjectId,
        quizId: payload.quizId,
        quizTitle: payload.quizTitle || payload.quizId,
        mode: payload.mode || "quiz",
        answers: payload.answers || {},
        score: Number(payload.score) || 0,
        total: Math.max(1, Number(payload.total || payload.totalQuestions) || 1),
        totalQuestions: Math.max(1, Number(payload.totalQuestions || payload.total) || 1),
        percentage: Number(payload.percentage) || 0,
        durationMs: Math.max(1000, Number(payload.durationMs) || 15000),
        attemptId: payload.attemptId || createAttemptId(),
        submittedAt: payload.submittedAt || new Date().toISOString(),
      };

      // Keep the legacy local field for existing local ranking and migrations.
      attemptData.createdAt = attemptData.submittedAt;

      const localEntry = recordLocalAttempt(attemptData);
      if (!String(getAuthToken() || "")) {
        // Guests keep local progress only; ranked results require a login.
        return { ok: true, online: false, localOnly: true, attempt: localEntry };
      }
      const outcome = await postAttempt(attemptData);
      if (outcome.data) {
        return { ok: true, online: true, attempt: outcome.data.attempt || localEntry, rank: outcome.data.rank || null };
      }
      if (outcome.drop) {
        return { ok: true, online: false, rejected: true, attempt: localEntry };
      }

      // A failed request must not make a completed quiz private to this browser.
      // Persist it and retry on the next leaderboard visit / page start.
      queueAttempt(attemptData);
      return { ok: true, online: false, pending: true, attempt: localEntry };
    }

    function computeLocalLeaderboard(filters) {
      const f = filters || {};
      const subjectId = f.subjectId && f.subjectId !== "all" ? f.subjectId : null;
      const quizId = f.quizId && f.quizId !== "all" ? f.quizId : null;
      const raw = readJson(LOCAL_LEADERBOARD_KEY, []);

      const filtered = raw.filter((item) => {
        if (subjectId && item.subjectId !== subjectId) return false;
        if (quizId && item.quizId !== quizId) return false;
        return true;
      });

      // Group by playerId: keep best valid score per student (or aggregate across quizzes when quizId is "all")
      const byPlayer = new Map();
      filtered.forEach((item) => {
        const key = quizId ? `${item.playerId}::${item.quizId}` : `${item.playerId}::${item.subjectId}::${item.quizId}`;
        const existing = byPlayer.get(key);
        if (
          !existing ||
          item.percentage > existing.percentage ||
          (item.percentage === existing.percentage && item.score > existing.score) ||
          (item.percentage === existing.percentage &&
            item.score === existing.score &&
            item.durationMs < existing.durationMs)
        ) {
          byPlayer.set(key, Object.assign({}, item));
        }
      });

      // Now aggregate per student so each student appears once on the chosen leaderboard view
      const studentMap = new Map();
      Array.from(byPlayer.values()).forEach((bestQuizAttempt) => {
        const pid = bestQuizAttempt.playerId;
        if (!studentMap.has(pid)) {
          studentMap.set(pid, {
            playerId: pid,
            username: bestQuizAttempt.username || "Student",
            subjectId: subjectId || "all",
            subjectName: subjectId ? bestQuizAttempt.subjectName : "All Subjects",
            quizId: quizId || "all",
            quizTitle: quizId ? bestQuizAttempt.quizTitle : "Best Validated Attempts",
            score: 0,
            totalQuestions: 0,
            percentage: 0,
            durationMs: 0,
            quizzesCount: 0,
            updatedAt: bestQuizAttempt.createdAt,
          });
        }
        const agg = studentMap.get(pid);
        agg.username = bestQuizAttempt.username || agg.username;
        agg.score += Number(bestQuizAttempt.score) || 0;
        agg.totalQuestions += Number(bestQuizAttempt.totalQuestions) || 0;
        agg.durationMs += Number(bestQuizAttempt.durationMs) || 0;
        agg.quizzesCount += 1;
        if (bestQuizAttempt.createdAt > agg.updatedAt) {
          agg.updatedAt = bestQuizAttempt.createdAt;
        }
      });

      const rows = Array.from(studentMap.values()).map((row) => {
        row.percentage =
          row.totalQuestions > 0 ? Math.round((row.score / row.totalQuestions) * 1000) / 10 : 0;
        row.points = computeStudyXP(row);
        row.xp = row.points;
        return row;
      });

      return rankLeaderboardEntries(rows);
    }

    async function fetchLeaderboard(filters) {
      const f = filters || {};
      const params = new URLSearchParams();
      if (f.subjectId && f.subjectId !== "all") params.set("subjectId", f.subjectId);
      if (f.quizId && f.quizId !== "all") params.set("quizId", f.quizId);
      if (f.includeAll !== false && (!f.quizId || f.quizId === "all")) params.set("includeAll", "1");
      params.set("limit", String(f.limit || 200));

      if (fetchImpl) {
        try {
          await syncPendingAttempts();
          const url = `${apiBase}/leaderboard${params.toString() ? "?" + params.toString() : ""}`;
          const lbHeaders = { Accept: "application/json" };
          const lbToken = String(getAuthToken() || "");
          if (lbToken) lbHeaders.Authorization = `Bearer ${lbToken}`;
          const res = await fetchImpl(url, {
            method: "GET",
            headers: lbHeaders,
          });
          if (res && res.ok && typeof res.json === "function") {
            const data = await res.json().catch(() => null);
            if (data && data.ok && Array.isArray(data.entries)) {
              const localEntries = computeLocalLeaderboard(f);
              const merged = data.entries.slice();
              const seen = new Set(
                merged.map((entry) => `${String(entry.username || "").toLowerCase()}::${entry.subjectId || "all"}`)
              );
              localEntries.forEach((entry) => {
                const key = `${String(entry.username || "").toLowerCase()}::${entry.subjectId || "all"}`;
                if (!seen.has(key)) {
                  merged.push(entry);
                  seen.add(key);
                }
              });
              merged.sort((a, b) => {
                const ax = Number(a.points ?? a.xp ?? 0);
                const bx = Number(b.points ?? b.xp ?? 0);
                const ap = Number(a.bestPercentage ?? a.percentage ?? 0);
                const bp = Number(b.bestPercentage ?? b.percentage ?? 0);
                return bx - ax || bp - ap || Number(b.bestScore ?? b.score ?? 0) - Number(a.bestScore ?? a.score ?? 0);
              });
              const rankedMerged = merged.map((row, idx) => Object.assign({}, row, { rank: idx + 1 }));
              const myProfile = getProfile();
              let myRank = null;
              if (myProfile) {
                const found = rankedMerged.find(
                  (e) => e.isMe === true || (e.playerId && e.playerId === myProfile.playerId)
                );
                if (found) {
                  myRank = {
                    rank: found.rank,
                    bestScore: found.bestScore ?? found.score ?? 0,
                    totalQuestions: found.totalQuestions ?? found.total ?? 0,
                    bestPercentage: found.bestPercentage ?? found.percentage ?? 0,
                    fastestDurationMs: found.fastestDurationMs ?? found.durationMs ?? 0,
                    attemptsCount: found.attemptsCount || 1,
                  };
                }
              }
              return {
                ok: true,
                online: true,
                entries: rankedMerged,
                myRank,
                total: rankedMerged.length,
              };
            }
          }
        } catch (_err) {
          /* Fall back to local leaderboard */
        }
      }

      // Older offline attempts may exist only in localStorage. Keep them visible
      // when the server has no rows yet, instead of showing an empty leaderboard.
      const entries = computeLocalLeaderboard(f);
      const myProfile = getProfile();
      let myRank = null;
      if (myProfile) {
        const found = entries.find((e) => e.playerId && e.playerId === myProfile.playerId);
        if (found) {
          myRank = {
            rank: found.rank,
            bestScore: found.bestScore ?? found.score ?? 0,
            totalQuestions: found.totalQuestions ?? found.total ?? 0,
            bestPercentage: found.bestPercentage ?? found.percentage ?? 0,
            fastestDurationMs: found.fastestDurationMs ?? found.durationMs ?? 0,
            attemptsCount: found.attemptsCount || 1,
          };
        }
      }
      return {
        ok: true,
        online: false,
        entries,
        myRank,
        total: entries.length,
      };
    }

    return {
      PLAYER_ID_KEY,
      PROFILE_KEY,
      LOCAL_LEADERBOARD_KEY,
      PENDING_ATTEMPTS_KEY,
      getOrCreatePlayerId,
      getProfile,
      shouldPromptForUsername,
      dismissUsernamePrompt,
      validateUsername,
      saveUsername,
      deleteUserProfile,
      submitQuizAttempt,
      syncPendingAttempts,
      fetchLeaderboard,
      computeLocalLeaderboard,
      rankLeaderboardEntries,
      formatDuration,
    };
  }

  function computeStudyXP(entry) {
    if (!entry) return 0;
    const correct = Math.max(0, Number(entry.score || entry.bestScore || 0));
    const total = Math.max(1, Number(entry.totalQuestions || entry.total || 1));
    const pct = entry.percentage != null
      ? Number(entry.percentage)
      : (entry.bestPercentage != null ? Number(entry.bestPercentage) : (total > 0 ? (correct / total) * 100 : 0));
    let xp = correct * 10;
    if (pct >= 95) {
      xp += Math.round(correct * 5);
    } else if (pct >= 85) {
      xp += Math.round(correct * 3);
    } else if (pct >= 70) {
      xp += Math.round(correct * 1);
    }
    const quizzes = Math.max(1, Number(entry.quizzesCount || 1));
    xp += quizzes * 25;
    return Math.round(xp);
  }

  function computeDailyStreak(dateStrings) {
    const clean = Array.from(
      new Set(
        (Array.isArray(dateStrings) ? dateStrings : [])
          .map((d) => String(d || "").slice(0, 10))
          .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
      )
    )
      .sort()
      .reverse();
    if (!clean.length) return 0;
    const today = new Date().toISOString().slice(0, 10);
    const yDate = new Date(today + "T00:00:00Z");
    yDate.setUTCDate(yDate.getUTCDate() - 1);
    const yesterday = yDate.toISOString().slice(0, 10);
    if (clean[0] !== today && clean[0] !== yesterday) return 0;
    let streak = 1;
    let cursor = clean[0];
    for (let i = 1; i < clean.length; i += 1) {
      const prev = new Date(cursor + "T00:00:00Z");
      prev.setUTCDate(prev.getUTCDate() - 1);
      const expectedPrev = prev.toISOString().slice(0, 10);
      if (clean[i] === expectedPrev) {
        streak += 1;
        cursor = clean[i];
      } else if (clean[i] < expectedPrev) {
        break;
      }
    }
    return streak;
  }

  function computeStudentBadges(metrics) {
    const quizzesCount = Number(metrics && metrics.quizzesCount) || 0;
    const bestPct = Number(metrics && metrics.bestPct) || 0;
    const fastestDurationMs = Number(metrics && metrics.fastestDurationMs) || 0;
    const streakDays = Number(metrics && metrics.streakDays) || 0;
    const xp = Number(metrics && metrics.xp) || 0;
    const badges = [];
    if (quizzesCount >= 1) badges.push({ id: "first_quiz", label: "First Steps", icon: "🌱" });
    if (streakDays >= 3) badges.push({ id: "streak_3", label: streakDays + "d Streak", icon: "🔥" });
    if (streakDays >= 7) badges.push({ id: "streak_7", label: "7-Day Focus", icon: "📅" });
    if (bestPct >= 100 && quizzesCount >= 1) badges.push({ id: "perfect_100", label: "100% Perfect", icon: "💯" });
    else if (bestPct >= 95 && quizzesCount >= 1) badges.push({ id: "ace_95", label: "95%+ Ace", icon: "🎯" });
    if (quizzesCount >= 5) badges.push({ id: "explorer_5", label: "Quiz Explorer", icon: "🧭" });
    if (quizzesCount >= 15) badges.push({ id: "scholar_15", label: "Scholar", icon: "🎓" });
    if (fastestDurationMs > 0 && fastestDurationMs <= 120000 && quizzesCount >= 1) {
      badges.push({ id: "speed_runner", label: "Fast Finisher", icon: "⚡" });
    }
    if (xp >= 1000) badges.push({ id: "xp_1000", label: "1K+ XP", icon: "🏆" });
    return badges;
  }

  function rankLeaderboardEntries(entries) {
    const list = Array.isArray(entries) ? entries.map((e) => Object.assign({}, e)) : [];
    list.sort((a, b) => {
      const aPoints = a.points ?? a.xp ?? null;
      const bPoints = b.points ?? b.xp ?? null;
      if (aPoints !== null && bPoints !== null && aPoints !== bPoints) {
        return bPoints - aPoints;
      }
      if ((b.percentage || 0) !== (a.percentage || 0)) return (b.percentage || 0) - (a.percentage || 0);
      if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
      if ((a.durationMs || 0) !== (b.durationMs || 0)) return (a.durationMs || 0) - (b.durationMs || 0);
      return String(a.submittedAt || a.updatedAt || "").localeCompare(String(b.submittedAt || b.updatedAt || ""));
    });
    return list.map((item, idx) => Object.assign({}, item, { rank: idx + 1 }));
  }

  const api = {
    PLAYER_ID_KEY,
    PROFILE_KEY,
    LOCAL_LEADERBOARD_KEY,
    validateUsername,
    computeStudyXP,
    computeDailyStreak,
    computeStudentBadges,
    rankLeaderboardEntries,
    formatDuration,
    createOnlineClient,
  };

  root.BankQuestionCore = root.BankQuestionCore || {};
  root.BankQuestionCore.OnlineClient = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
