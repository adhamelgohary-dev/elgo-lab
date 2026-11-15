/**
 * Bank Question — Content Registry (Phase 1 & 2)
 *
 * Builds a stable, read-only index over every question in every content source
 * (original question bank quizzes, generated lecture quizzes and instructor
 * sheets) and assigns each question a unique *internal* identifier:
 *
 *     subjectId::sourceType::collectionId::originalQuestionId
 *
 * Why: several source collections reuse the same original question id (for
 * example `sheet1_q1` exists in both CSC214 sheet 1 and Digital Logic sheet 1).
 * The original id is never renamed, rewritten or deleted; it is preserved as
 * metadata (`originalId`) while the composite internal id provides uniqueness.
 *
 * This module is deliberately environment-agnostic: it works in the browser
 * (attaching itself to `window.BankQuestionCore`) and in Node (`module.exports`).
 * It performs no DOM access and never writes to the content it indexes.
 */
(function (root) {
  "use strict";

  const SOURCE_TYPES = Object.freeze({
    QUIZ: "quiz",
    LECTURE: "lecture",
    SHEET: "sheet",
  });

  const SOURCE_LABELS = Object.freeze({
    quiz: "Question Bank",
    lecture: "Lecture",
    sheet: "Sheet",
  });

  function safeString(value) {
    return value === null || value === undefined ? "" : String(value);
  }

  function segment(value, fallback) {
    const text = safeString(value).trim();
    return text.length > 0 ? text : fallback;
  }

  /**
   * Build the canonical internal id.
   * Missing ids are still addressable: a deterministic placeholder is used so
   * that no question is dropped just because its source id is absent.
   */
  function internalIdFor(subjectId, sourceType, collectionId, originalId, index) {
    const subject = segment(subjectId, "__unknown_subject__");
    const type = segment(sourceType, "__unknown_source__");
    const collection = segment(collectionId, "__unknown_collection__");
    const original =
      safeString(originalId).trim().length > 0
        ? safeString(originalId).trim()
        : `__missing_id__${typeof index === "number" ? index : 0}`;
    return `${subject}::${type}::${collection}::${original}`;
  }

  function normalizeText(value) {
    return safeString(value).replace(/\s+/g, " ").trim().toLowerCase();
  }

  function questionText(question) {
    if (!question || typeof question !== "object") return "";
    if (typeof question.question === "string" && question.question.trim()) {
      return question.question;
    }
    if (typeof question.text === "string") return question.text;
    return "";
  }

  function subjectNameLookup(subjects) {
    const map = new Map();
    (subjects || []).forEach((subject) => {
      if (subject && subject.id) map.set(subject.id, subject.name || subject.id);
    });
    return map;
  }

  /**
   * Flatten the three content sources into ordered entries.
   * Order follows the source order, which keeps reports deterministic.
   */
  function buildContentEntries(dataset) {
    const data = dataset || {};
    const subjects = Array.isArray(data.bank && data.bank.subjects)
      ? data.bank.subjects
      : [];
    const lecturesBySubject = data.lecturesBySubject || {};
    const sheetsBySubject = data.sheetsBySubject || {};
    const subjectNames = subjectNameLookup(subjects);
    const entries = [];

    function pushQuestion(question, context, index) {
      const originalId =
        question && question.id !== undefined && question.id !== null
          ? String(question.id)
          : null;
      entries.push({
        internalId: internalIdFor(
          context.subjectId,
          context.sourceType,
          context.collectionId,
          originalId,
          index
        ),
        originalId,
        subjectId: context.subjectId,
        subjectName:
          context.subjectName ||
          subjectNames.get(context.subjectId) ||
          context.subjectId,
        sourceType: context.sourceType,
        sourceLabel: SOURCE_LABELS[context.sourceType] || context.sourceType,
        collectionId: context.collectionId,
        collectionTitle: context.collectionTitle || context.collectionId,
        questionIndex: index,
        number: question && question.number !== undefined ? question.number : null,
        question,
      });
    }

    // 1. Original question bank quizzes
    subjects.forEach((subject) => {
      const quizzes = Array.isArray(subject.quizzes) ? subject.quizzes : [];
      quizzes.forEach((quiz) => {
        const questions = Array.isArray(quiz.questions) ? quiz.questions : [];
        questions.forEach((question, index) => {
          pushQuestion(
            question,
            {
              subjectId: subject.id,
              subjectName: subject.name,
              sourceType: SOURCE_TYPES.QUIZ,
              collectionId: quiz.id,
              collectionTitle: quiz.title,
            },
            index
          );
        });
      });
    });

    // 2. Generated lecture quizzes
    Object.keys(lecturesBySubject).forEach((subjectId) => {
      const lectures = Array.isArray(lecturesBySubject[subjectId])
        ? lecturesBySubject[subjectId]
        : [];
      lectures.forEach((lecture) => {
        const questions =
          lecture && lecture.generatedQuiz && Array.isArray(lecture.generatedQuiz.questions)
            ? lecture.generatedQuiz.questions
            : [];
        questions.forEach((question, index) => {
          pushQuestion(
            question,
            {
              subjectId,
              subjectName: lecture.subjectName || subjectNames.get(subjectId),
              sourceType: SOURCE_TYPES.LECTURE,
              collectionId: lecture.id,
              collectionTitle: lecture.title,
            },
            index
          );
        });
      });
    });

    // 3. Instructor sheets
    Object.keys(sheetsBySubject).forEach((subjectId) => {
      const sheets = Array.isArray(sheetsBySubject[subjectId])
        ? sheetsBySubject[subjectId]
        : [];
      sheets.forEach((sheet) => {
        const questions = Array.isArray(sheet.questions) ? sheet.questions : [];
        questions.forEach((question, index) => {
          pushQuestion(
            question,
            {
              subjectId,
              subjectName: sheet.subjectName || subjectNames.get(subjectId),
              sourceType: SOURCE_TYPES.SHEET,
              collectionId: sheet.id,
              collectionTitle: sheet.title,
            },
            index
          );
        });
      });
    });

    return entries;
  }

  /**
   * Build the registry object consumed by the app, the validator and tests.
   */
  function buildRegistry(dataset) {
    const entries = buildContentEntries(dataset);
    const byInternalId = new Map();
    const byOriginalId = new Map();
    const byCollection = new Map();
    const duplicateInternalIds = [];
    const internalIdCounts = new Map();

    entries.forEach((entry) => {
      internalIdCounts.set(
        entry.internalId,
        (internalIdCounts.get(entry.internalId) || 0) + 1
      );
    });

    // Disambiguate the (very unlikely) case of the same original id appearing
    // twice inside the same source collection: the composite id would collide,
    // so later occurrences receive a deterministic suffix. Nothing is dropped.
    entries.forEach((entry) => {
      if (internalIdCounts.get(entry.internalId) > 1) {
        const seen = byInternalId.has(entry.internalId)
          ? entry.internalId.split("::#").length
          : 1;
        let candidate = seen > 1 ? `${entry.internalId}::#${seen}` : entry.internalId;
        let collision = 2;
        while (byInternalId.has(candidate)) {
          candidate = `${entry.internalId}::#${collision}`;
          collision += 1;
        }
        if (candidate !== entry.internalId) {
          duplicateInternalIds.push({
            baseInternalId: entry.internalId,
            internalId: candidate,
            subjectId: entry.subjectId,
            sourceType: entry.sourceType,
            collectionId: entry.collectionId,
            originalId: entry.originalId,
          });
          entry.baseInternalId = entry.internalId;
          entry.internalId = candidate;
        }
      }
      byInternalId.set(entry.internalId, entry);

      const originalKey = safeString(entry.originalId);
      if (originalKey) {
        if (!byOriginalId.has(originalKey)) byOriginalId.set(originalKey, []);
        byOriginalId.get(originalKey).push(entry);
      }

      const collectionKey = `${entry.subjectId}::${entry.sourceType}::${entry.collectionId}`;
      if (!byCollection.has(collectionKey)) byCollection.set(collectionKey, []);
      byCollection.get(collectionKey).push(entry);
    });

    // Duplicate original ids across the whole dataset.
    const duplicateOriginalIds = [];
    byOriginalId.forEach((list, originalId) => {
      if (list.length > 1) {
        duplicateOriginalIds.push({
          originalId,
          count: list.length,
          entries: list.map((entry) => ({
            internalId: entry.internalId,
            subjectId: entry.subjectId,
            sourceType: entry.sourceType,
            collectionId: entry.collectionId,
          })),
        });
      }
    });

    // Duplicate question text (normalised, case-insensitive). Reported only.
    const textMap = new Map();
    entries.forEach((entry) => {
      const normalized = normalizeText(questionText(entry.question));
      if (!normalized) return;
      if (!textMap.has(normalized)) textMap.set(normalized, []);
      textMap.get(normalized).push(entry);
    });
    const duplicateTexts = [];
    textMap.forEach((list, normalized) => {
      if (list.length > 1) {
        duplicateTexts.push({
          normalizedText: normalized,
          count: list.length,
          entries: list.map((entry) => ({
            internalId: entry.internalId,
            originalId: entry.originalId,
            subjectId: entry.subjectId,
            sourceType: entry.sourceType,
            collectionId: entry.collectionId,
          })),
        });
      }
    });

    const subjectIds = new Set(entries.map((entry) => entry.subjectId));
    const bySubject = new Map();
    subjectIds.forEach((subjectId) => {
      bySubject.set(
        subjectId,
        entries.filter((entry) => entry.subjectId === subjectId)
      );
    });

    const registry = {
      version: 1,
      entries,
      byInternalId,
      byOriginalId,
      byCollection,
      bySubject,
      duplicateOriginalIds,
      duplicateInternalIds,
      duplicateTexts,

      /** Resolve by internal id first, then fall back to the original id. */
      lookup(reference) {
        if (reference === null || reference === undefined) return null;
        const ref = String(reference);
        if (byInternalId.has(ref)) return byInternalId.get(ref);
        const list = byOriginalId.get(ref);
        return list && list.length > 0 ? list[0] : null;
      },

      /** All entries that share an original id (used for migration ambiguity). */
      lookupAllByOriginalId(originalId) {
        return byOriginalId.get(safeString(originalId)) || [];
      },

      /** Find the best entry for a known content location. */
      lookupAt(subjectId, sourceType, collectionId, originalId) {
        const list = byCollection.get(`${subjectId}::${sourceType}::${collectionId}`) || [];
        return (
          list.find((entry) => safeString(entry.originalId) === safeString(originalId)) ||
          null
        );
      },

      /**
       * Add `internalId`/`originalId` metadata to *copies* of questions.
       * Callers pass session clones, never the source question objects.
       */
      annotateQuestions(questions, context) {
        const ctx = context || {};
        const list = byCollection.get(
          `${ctx.subjectId}::${ctx.sourceType}::${ctx.collectionId}`
        ) || [];
        return (questions || []).map((question, index) => {
          if (!question || typeof question !== "object") return question;
          const originalId =
            question.id !== undefined && question.id !== null ? String(question.id) : null;
          let entry =
            list.find(
              (candidate) =>
                candidate.questionIndex === index &&
                safeString(candidate.originalId) === safeString(originalId)
            ) || null;
          if (!entry) {
            entry = list.find(
              (candidate) => safeString(candidate.originalId) === safeString(originalId)
            ) || null;
          }
          if (entry) {
            question.internalId = entry.internalId;
            question.originalId = entry.originalId;
            question.sourceType = entry.sourceType;
            question.collectionId = entry.collectionId;
          }
          return question;
        });
      },

      /** Plain serialisable summary (useful for reports and tests). */
      toJSON() {
        return {
          version: 1,
          totals: {
            questions: entries.length,
            subjects: bySubject.size,
            duplicateOriginalIds: duplicateOriginalIds.length,
            duplicateTexts: duplicateTexts.length,
            duplicateInternalIds: duplicateInternalIds.length,
          },
          entries: entries.map((entry) => ({
            internalId: entry.internalId,
            originalId: entry.originalId,
            subjectId: entry.subjectId,
            sourceType: entry.sourceType,
            collectionId: entry.collectionId,
          })),
          duplicateOriginalIds,
        };
      },
    };

    return registry;
  }

  const api = {
    SOURCE_TYPES,
    SOURCE_LABELS,
    internalIdFor,
    normalizeText,
    questionText,
    buildContentEntries,
    buildRegistry,
  };

  root.BankQuestionCore = root.BankQuestionCore || {};
  root.BankQuestionCore.ContentRegistry = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
