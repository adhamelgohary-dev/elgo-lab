/**
 * Bank Question — Mistakes Notebook store (Phase 3)
 *
 * Rules implemented here:
 *  - A mistake is never deleted automatically, including after a correct answer.
 *  - Status is only changed by an explicit user action (resolve / reopen).
 *  - Failure count, first failure date, last attempt date and the selected
 *    answer are retained.
 *  - The primary key is the composite internal question id, so identical source
 *    ids in different subjects never collide.
 *
 * The store is plain data plus pure functions, usable from the app and tests.
 */
(function (root) {
  "use strict";

  const SCHEMA_VERSION = 2;
  const STATUS = Object.freeze({ UNRESOLVED: "unresolved", RESOLVED: "resolved" });
  const MAX_ATTEMPT_HISTORY = 25;

  function nowIso(now) {
    if (now instanceof Date) return now.toISOString();
    if (typeof now === "string") return now;
    return new Date().toISOString();
  }

  function safeString(value) {
    return value === null || value === undefined ? "" : String(value);
  }

  function emptyStore() {
    return { schemaVersion: SCHEMA_VERSION, items: [] };
  }

  function createItem(input, now) {
    const at = nowIso(now);
    const status =
      input.status === STATUS.RESOLVED ? STATUS.RESOLVED : STATUS.UNRESOLVED;
    return {
      internalId: safeString(input.internalId),
      originalQuestionId:
        input.originalQuestionId === undefined ? null : input.originalQuestionId,
      subjectId: input.subjectId || null,
      quizId: input.quizId === undefined ? null : input.quizId,
      sourceType: input.sourceType || null,
      collectionId: input.collectionId || null,
      status,
      failureCount: typeof input.failureCount === "number" ? input.failureCount : 1,
      firstFailedAt: input.firstFailedAt || at,
      lastAttemptedAt: input.lastAttemptedAt || at,
      resolvedAt: status === STATUS.RESOLVED ? input.resolvedAt || at : null,
      selectedOptionId:
        input.selectedOptionId === undefined ? null : input.selectedOptionId,
      correctOptionId:
        input.correctOptionId === undefined ? null : input.correctOptionId,
      questionText: input.questionText || "",
      attempts: Array.isArray(input.attempts) ? input.attempts.slice(-MAX_ATTEMPT_HISTORY) : [],
      migrationStatus: input.migrationStatus || "native",
    };
  }

  /**
   * Normalise anything the app may have stored (v1 unresolved/resolved arrays or
   * v2 items) into the current schema without discarding fields the user has.
   */
  function normalizeStore(raw, now) {
    if (!raw || typeof raw !== "object") return emptyStore();
    if (Array.isArray(raw.items)) {
      return {
        schemaVersion: SCHEMA_VERSION,
        items: raw.items.map((item) => createItem(item, now)),
      };
    }

    const items = [];
    const push = (item, legacyStatus) => {
      if (!item || typeof item !== "object") return;
      const internalId = safeString(item.internalId || item.questionId);
      if (!internalId) return;
      items.push(
        createItem(
          {
            internalId,
            originalQuestionId: item.originalQuestionId || item.questionId || null,
            subjectId: item.subjectId || null,
            quizId: item.quizId === undefined ? null : item.quizId,
            sourceType: item.sourceType || null,
            collectionId: item.collectionId || null,
            status: item.status || legacyStatus,
            failureCount: item.failureCount || item.failCount || 1,
            firstFailedAt: item.firstFailedAt || item.createdAt || null,
            lastAttemptedAt: item.lastAttemptedAt || item.firstFailedAt || null,
            resolvedAt: item.resolvedAt || null,
            selectedOptionId: item.selectedOptionId,
            correctOptionId: item.correctOptionId,
            questionText: item.questionText || "",
            attempts: item.attempts,
            migrationStatus: item.migrationStatus || "legacy",
          },
          now
        )
      );
    };

    (Array.isArray(raw.unresolved) ? raw.unresolved : []).forEach((item) =>
      push(item, STATUS.UNRESOLVED)
    );
    (Array.isArray(raw.resolved) ? raw.resolved : []).forEach((item) =>
      push(item, STATUS.RESOLVED)
    );
    (Array.isArray(raw.items) ? raw.items : []).forEach((item) =>
      push(item, STATUS.UNRESOLVED)
    );

    return mergeItems(items);
  }

  function mergeItems(items) {
    const byId = new Map();
    const merged = [];
    (items || []).forEach((item) => {
      const key = item.internalId;
      if (!key) return;
      if (!byId.has(key)) {
        byId.set(key, item);
        merged.push(item);
        return;
      }
      // Never discard a record: merge the facts, prefer "unresolved" because it
      // still needs the student's attention.
      const existing = byId.get(key);
      existing.failureCount = Math.max(
        existing.failureCount || 1,
        item.failureCount || 1
      );
      existing.firstFailedAt = earliest(existing.firstFailedAt, item.firstFailedAt);
      existing.lastAttemptedAt = latest(existing.lastAttemptedAt, item.lastAttemptedAt);
      existing.attempts = (existing.attempts || [])
        .concat(item.attempts || [])
        .sort((a, b) => new Date(a.at) - new Date(b.at))
        .slice(-MAX_ATTEMPT_HISTORY);
      if (!existing.selectedOptionId && item.selectedOptionId) {
        existing.selectedOptionId = item.selectedOptionId;
      }
      if (!existing.correctOptionId && item.correctOptionId) {
        existing.correctOptionId = item.correctOptionId;
      }
      if (!existing.questionText && item.questionText) {
        existing.questionText = item.questionText;
      }
      if (item.status === STATUS.UNRESOLVED) {
        existing.status = STATUS.UNRESOLVED;
        existing.resolvedAt = null;
      } else if (existing.status === STATUS.RESOLVED) {
        existing.resolvedAt = latest(existing.resolvedAt, item.resolvedAt);
      }
    });
    return { schemaVersion: SCHEMA_VERSION, items: merged };
  }

  function earliest(a, b) {
    if (!a) return b || null;
    if (!b) return a;
    return new Date(a) <= new Date(b) ? a : b;
  }

  function latest(a, b) {
    if (!a) return b || null;
    if (!b) return a;
    return new Date(a) >= new Date(b) ? a : b;
  }

  function findItem(store, internalId) {
    if (!store || !Array.isArray(store.items)) return null;
    return store.items.find((item) => item.internalId === internalId) || null;
  }

  /**
   * Record an answer attempt.
   *  - wrong answer: creates or updates a mistake (status is NOT changed)
   *  - correct answer: only updates the attempt history of an existing mistake
   * Nothing is ever deleted.
   */
  function recordAttempt(store, input, now) {
    const current = store && Array.isArray(store.items) ? store : emptyStore();
    const at = nowIso(now);
    const internalId = safeString(input.internalId);
    if (!internalId) return current;

    const items = current.items.slice();
    const index = items.findIndex((item) => item.internalId === internalId);
    const isCorrect = Boolean(input.isCorrect);
    const attempt = {
      at,
      selectedOptionId: input.selectedOptionId === undefined ? null : input.selectedOptionId,
      correct: isCorrect,
    };

    if (index < 0) {
      if (isCorrect) return current; // A correct answer alone is not a mistake.
      items.push(
        createItem(
          {
            internalId,
            originalQuestionId: input.originalQuestionId,
            subjectId: input.subjectId,
            quizId: input.quizId,
            sourceType: input.sourceType,
            collectionId: input.collectionId,
            status: STATUS.UNRESOLVED,
            failureCount: 1,
            firstFailedAt: at,
            lastAttemptedAt: at,
            selectedOptionId: input.selectedOptionId,
            correctOptionId: input.correctOptionId,
            questionText: input.questionText,
            attempts: [attempt],
          },
          at
        )
      );
      return { schemaVersion: SCHEMA_VERSION, items };
    }

    const existing = Object.assign({}, items[index]);
    existing.failureCount = isCorrect
      ? existing.failureCount
      : (existing.failureCount || 1) + 1;
    existing.lastAttemptedAt = at;
    if (!isCorrect) {
      existing.selectedOptionId = input.selectedOptionId;
      if (input.correctOptionId) existing.correctOptionId = input.correctOptionId;
      if (!existing.firstFailedAt) existing.firstFailedAt = at;
      if (!existing.questionText && input.questionText) {
        existing.questionText = input.questionText;
      }
      if (!existing.originalQuestionId && input.originalQuestionId !== undefined) {
        existing.originalQuestionId = input.originalQuestionId;
      }
    }
    existing.attempts = (existing.attempts || []).concat([attempt]).slice(-MAX_ATTEMPT_HISTORY);
    // Deliberately do not touch `status`: only explicit user actions change it.
    items[index] = existing;
    return { schemaVersion: SCHEMA_VERSION, items };
  }

  function withStatus(store, internalId, status, now) {
    const current = store && Array.isArray(store.items) ? store : emptyStore();
    const items = current.items.map((item) => {
      if (item.internalId !== internalId) return item;
      const updated = Object.assign({}, item, { status });
      if (status === STATUS.RESOLVED) {
        updated.resolvedAt = nowIso(now);
      } else {
        updated.resolvedAt = null;
      }
      return updated;
    });
    return { schemaVersion: SCHEMA_VERSION, items };
  }

  function resolveMistake(store, internalId, now) {
    return withStatus(store, internalId, STATUS.RESOLVED, now);
  }

  function reopenMistake(store, internalId, now) {
    return withStatus(store, internalId, STATUS.UNRESOLVED, now);
  }

  function deleteMistake(store, internalId) {
    const current = store && Array.isArray(store.items) ? store : emptyStore();
    return {
      schemaVersion: SCHEMA_VERSION,
      items: current.items.filter((item) => item.internalId !== internalId),
    };
  }

  function clearMistakes() {
    return emptyStore();
  }

  function filterByStatus(store, status) {
    const items = store && Array.isArray(store.items) ? store.items : [];
    if (!status || status === "all") return items.slice();
    return items.filter((item) => item.status === status);
  }

  function filterBySubject(store, subjectId) {
    const items = store && Array.isArray(store.items) ? store.items : [];
    if (!subjectId || subjectId === "all") return items.slice();
    return items.filter((item) => item.subjectId === subjectId);
  }

  function getItems(store) {
    return store && Array.isArray(store.items) ? store.items : [];
  }

  function counts(store) {
    const items = getItems(store);
    const unresolved = items.filter((item) => item.status === STATUS.UNRESOLVED).length;
    return {
      total: items.length,
      unresolved,
      resolved: items.length - unresolved,
    };
  }

  /**
   * Smart Review Deck (spaced-repetition priority scoring).
   * Unresolved items outrank resolved items; repeated failures and stale items
   * surface first so weak concepts get priority practice.
   */
  function scoreReviewPriority(item, nowMs) {
    if (!item) return 0;
    const refMs = Number.isFinite(nowMs) ? nowMs : Date.now();
    const isUnresolved = item.status !== STATUS.RESOLVED;
    const failures = Math.max(1, Number(item.failureCount) || 1);
    const lastMs = Date.parse(item.lastAttemptedAt || item.firstFailedAt || "");
    const ageHours = Number.isFinite(lastMs) ? Math.max(0, (refMs - lastMs) / 3600000) : 24;
    const ageBoost = Math.min(72, ageHours) * 0.5;
    return (isUnresolved ? 1000 : 0) + failures * 45 + ageBoost;
  }

  function buildSmartReviewDeck(store, options) {
    const opts = options || {};
    const items = getItems(store);
    const subjectId = opts.subjectId && opts.subjectId !== "all" ? opts.subjectId : null;
    const includeResolved = opts.includeResolved === true;
    const limit = Math.max(1, Math.min(200, Number(opts.limit) || 25));
    const nowMs = opts.nowMs !== undefined ? Number(opts.nowMs) : Date.now();

    const candidates = items.filter((item) => {
      if (subjectId && item.subjectId !== subjectId) return false;
      if (!includeResolved && item.status === STATUS.RESOLVED) return false;
      return true;
    });

    const scored = candidates.map((item) => ({
      item,
      priority: scoreReviewPriority(item, nowMs),
    }));
    scored.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return String(a.item.lastAttemptedAt || "").localeCompare(String(b.item.lastAttemptedAt || ""));
    });
    return scored.slice(0, limit).map((entry) =>
      Object.assign({}, entry.item, { reviewPriority: Math.round(entry.priority) })
    );
  }

  function toJSON(store) {
    return JSON.stringify(store && store.items ? store : emptyStore());
  }

  const api = {
    SCHEMA_VERSION,
    STATUS,
    emptyStore,
    normalizeStore,
    createItem,
    mergeItems,
    findItem,
    recordAttempt,
    resolveMistake,
    reopenMistake,
    deleteMistake,
    clearMistakes,
    filterByStatus,
    filterBySubject,
    getItems,
    counts,
    scoreReviewPriority,
    buildSmartReviewDeck,
    toJSON,
  };

  root.BankQuestionCore = root.BankQuestionCore || {};
  root.BankQuestionCore.MistakesStore = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
