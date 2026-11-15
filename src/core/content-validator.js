/**
 * Bank Question — Content Integrity Validator (Phase 1)
 *
 * Validates content and reports problems. It never fixes, deletes, reorders or
 * rewrites anything: the returned report is the only output and the input data
 * is treated as strictly read-only.
 *
 * The validator is environment-agnostic (browser + Node).
 */
(function (root) {
  "use strict";

  const Core = root.BankQuestionCore || {};
  let Registry = Core.ContentRegistry;
  if (!Registry && typeof require === "function") {
    // eslint-disable-next-line global-require
    Registry = require("./content-registry.js");
  }

  const ISSUE_DEFINITIONS = Object.freeze({
    missing_question_text: {
      category: "requires-human-review",
      severity: "error",
      message: "Question text is missing or empty.",
    },
    missing_options: {
      category: "requires-human-review",
      severity: "error",
      message: "Question has no options.",
    },
    empty_option: {
      category: "requires-human-review",
      severity: "error",
      message: "One or more options have empty text.",
    },
    missing_option_id: {
      category: "requires-human-review",
      severity: "warn",
      message: "One or more options have no option id.",
    },
    duplicate_option_id: {
      category: "requires-human-review",
      severity: "warn",
      message: "Two options share the same option id.",
    },
    duplicate_question_id: {
      category: "duplicate-content",
      severity: "warn",
      message: "The original question id is reused by more than one question. Handled by internal ids; nothing is removed.",
    },
    duplicate_question_text: {
      category: "duplicate-content",
      severity: "info",
      message: "The same question text appears more than once. Kept as-is.",
    },
    missing_correct_answer: {
      category: "missing-answer",
      severity: "error",
      message: "No correct answer is recorded for this question. It is not guessed or fixed.",
    },
    invalid_correct_answer: {
      category: "missing-answer",
      severity: "error",
      message: "The recorded correct answer does not match any option. It is not guessed or fixed.",
    },
    missing_explanation: {
      category: "requires-human-review",
      severity: "warn",
      message: "No explanation is present.",
    },
    placeholder_explanation: {
      category: "requires-human-review",
      severity: "info",
      message: "Explanation contains a review marker or placeholder pattern; a human must inspect it.",
    },
    correct_answer_text_mismatch: {
      category: "requires-human-review",
      severity: "info",
      message: "`correctAnswerText` does not equal the text of the option referenced by `correctOptionId`.",
    },
    review_notes_present: {
      category: "requires-human-review",
      severity: "info",
      message: "The source record carries review notes from import.",
    },
    missing_question_number: {
      category: "requires-human-review",
      severity: "info",
      message: "Question number is missing.",
    },
    invalid_subject_reference: {
      category: "invalid-source",
      severity: "error",
      message: "The subject reference does not resolve to a known subject.",
    },
    invalid_quiz_reference: {
      category: "invalid-source",
      severity: "error",
      message: "The quiz reference is missing, duplicated or inconsistent.",
    },
    invalid_lecture_reference: {
      category: "invalid-source",
      severity: "error",
      message: "The lecture reference is missing, duplicated or inconsistent.",
    },
    invalid_sheet_reference: {
      category: "invalid-source",
      severity: "error",
      message: "The sheet reference is missing, duplicated or inconsistent.",
    },
    invalid_question_subject_reference: {
      category: "invalid-source",
      severity: "warn",
      message: "The question's own subjectId disagrees with its collection's subject.",
    },
    invalid_pdf_reference: {
      category: "invalid-source",
      severity: "error",
      message: "A PDF reference is missing, duplicated or points to an unknown subject/lecture.",
    },
    invalid_video_reference: {
      category: "invalid-source",
      severity: "error",
      message: "A video reference is missing, duplicated or has an invalid YouTube URL or subject.",
    },
  });

  const CATEGORY_ORDER = [
    "invalid-source",
    "missing-answer",
    "duplicate-content",
    "requires-human-review",
  ];

  function safeString(value) {
    return value === null || value === undefined ? "" : String(value);
  }

  function stableStringify(value) {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
    const keys = Object.keys(value).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }

  /** cyrb53 — deterministic 53-bit fingerprint, enough for change detection. */
  function fingerprint(value) {
    const str = typeof value === "string" ? value : stableStringify(value);
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i += 1) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
  }

  function normalizeOptionText(value) {
    return safeString(value).replace(/\s+/g, " ").trim().toLowerCase();
  }

  function addIssue(issues, entry, code, extra) {
    const definition = ISSUE_DEFINITIONS[code] || {
      category: "requires-human-review",
      severity: "warn",
      message: code,
    };
    issues.push(
      Object.assign(
        {
          code,
          category: definition.category,
          severity: definition.severity,
          message: definition.message,
          internalId: entry ? entry.internalId : null,
          originalId: entry ? entry.originalId : null,
          subjectId: entry ? entry.subjectId : null,
          sourceType: entry ? entry.sourceType : null,
          collectionId: entry ? entry.collectionId : null,
        },
        extra || {}
      )
    );
  }

  /**
   * Validate collection/subject references before per-question checks.
   * Returns a Map collectionKey -> array of issue descriptors.
   */
  function validateReferences(dataset, registry) {
    const data = dataset || {};
    const subjects = Array.isArray(data.bank && data.bank.subjects) ? data.bank.subjects : [];
    const knownSubjects = new Set(subjects.map((subject) => subject.id));
    const issues = [];
    const collectionIssues = new Map();

    function flagCollection(subjectId, sourceType, collectionId, code, detail) {
      const key = `${subjectId}::${sourceType}::${collectionId}`;
      if (!collectionIssues.has(key)) collectionIssues.set(key, []);
      collectionIssues.get(key).push({ code, detail });
      issues.push({
        code,
        category: ISSUE_DEFINITIONS[code].category,
        severity: ISSUE_DEFINITIONS[code].severity,
        message: ISSUE_DEFINITIONS[code].message,
        subjectId,
        sourceType,
        collectionId,
        detail,
      });
    }

    function checkSubject(subjectId, sourceType, collectionId) {
      if (!subjectId || !knownSubjects.has(subjectId)) {
        flagCollection(
          subjectId,
          sourceType,
          collectionId,
          "invalid_subject_reference",
          `Unknown subject id: ${safeString(subjectId) || "(empty)"}`
        );
        return false;
      }
      return true;
    }

    subjects.forEach((subject) => {
      const quizzes = Array.isArray(subject.quizzes) ? subject.quizzes : [];
      const seenQuizIds = new Set();
      quizzes.forEach((quiz) => {
        const quizId = safeString(quiz && quiz.id);
        checkSubject(subject.id, "quiz", quizId);
        if (!quizId) {
          flagCollection(subject.id, "quiz", quizId, "invalid_quiz_reference", "Quiz has no id.");
        } else if (seenQuizIds.has(quizId)) {
          flagCollection(
            subject.id,
            "quiz",
            quizId,
            "invalid_quiz_reference",
            `Quiz id "${quizId}" is duplicated inside subject "${subject.id}".`
          );
        }
        seenQuizIds.add(quizId);
        if (quiz && quiz.subjectId && quiz.subjectId !== subject.id) {
          flagCollection(
            subject.id,
            "quiz",
            quizId,
            "invalid_quiz_reference",
            `Quiz subjectId "${quiz.subjectId}" does not match "${subject.id}".`
          );
        }
        if (!quiz || !Array.isArray(quiz.questions)) {
          flagCollection(
            subject.id,
            "quiz",
            quizId,
            "invalid_quiz_reference",
            "Quiz has no questions array."
          );
        }
      });
    });

    const lecturesBySubject = data.lecturesBySubject || {};
    Object.keys(lecturesBySubject).forEach((subjectId) => {
      const lectures = Array.isArray(lecturesBySubject[subjectId])
        ? lecturesBySubject[subjectId]
        : [];
      checkSubject(subjectId, "lecture", "");
      const seen = new Set();
      lectures.forEach((lecture) => {
        const lectureId = safeString(lecture && lecture.id);
        if (!lectureId) {
          flagCollection(
            subjectId,
            "lecture",
            lectureId,
            "invalid_lecture_reference",
            "Lecture has no id."
          );
        } else if (seen.has(lectureId)) {
          flagCollection(
            subjectId,
            "lecture",
            lectureId,
            "invalid_lecture_reference",
            `Lecture id "${lectureId}" is duplicated inside subject "${subjectId}".`
          );
        }
        seen.add(lectureId);
        if (lecture && lecture.subjectId && lecture.subjectId !== subjectId) {
          flagCollection(
            subjectId,
            "lecture",
            lectureId,
            "invalid_lecture_reference",
            `Lecture subjectId "${lecture.subjectId}" does not match "${subjectId}".`
          );
        }
        if (
          !lecture ||
          !lecture.generatedQuiz ||
          !Array.isArray(lecture.generatedQuiz.questions)
        ) {
          flagCollection(
            subjectId,
            "lecture",
            lectureId,
            "invalid_lecture_reference",
            "Lecture has no generatedQuiz.questions array."
          );
        }
      });
    });

    const sheetsBySubject = data.sheetsBySubject || {};
    Object.keys(sheetsBySubject).forEach((subjectId) => {
      const sheets = Array.isArray(sheetsBySubject[subjectId]) ? sheetsBySubject[subjectId] : [];
      checkSubject(subjectId, "sheet", "");
      const seen = new Set();
      sheets.forEach((sheet) => {
        const sheetId = safeString(sheet && sheet.id);
        if (!sheetId) {
          flagCollection(
            subjectId,
            "sheet",
            sheetId,
            "invalid_sheet_reference",
            "Sheet has no id."
          );
        } else if (seen.has(sheetId)) {
          flagCollection(
            subjectId,
            "sheet",
            sheetId,
            "invalid_sheet_reference",
            `Sheet id "${sheetId}" is duplicated inside subject "${subjectId}".`
          );
        }
        seen.add(sheetId);
        if (sheet && sheet.subjectId && sheet.subjectId !== subjectId) {
          flagCollection(
            subjectId,
            "sheet",
            sheetId,
            "invalid_sheet_reference",
            `Sheet subjectId "${sheet.subjectId}" does not match "${subjectId}".`
          );
        }
        if (!sheet || !Array.isArray(sheet.questions)) {
          flagCollection(
            subjectId,
            "sheet",
            sheetId,
            "invalid_sheet_reference",
            "Sheet has no questions array."
          );
        }
      });
    });

    return { issues, collectionIssues };
  }

  function detectPlaceholderExplanation(text) {
    const value = safeString(text);
    if (!value.trim()) return false;
    // Only a *leading* marker counts (e.g. "FIXED ..."), so ordinary prose that
    // contains the word "fixed" (e.g. fixed cost in Operations Research) is not
    // misreported as a placeholder.
    return /^\s*(FIXED|TODO|TBD|PLACEHOLDER)\b/i.test(value);
  }

  function isValidYouTubeVideoId(id) {
    return typeof id === "string" && /^[A-Za-z0-9_-]{11}$/.test(id.trim());
  }

  function extractYouTubeVideoId(urlOrId) {
    const value = safeString(urlOrId).trim();
    if (!value) return null;

    const isUrl =
      /^https?:\/\//i.test(value) ||
      /^(?:www\.|m\.)?(?:youtube\.com|youtu\.be|youtube-nocookie\.com)/i.test(value) ||
      value.includes("/") ||
      value.includes("?") ||
      value.includes(".");

    if (isUrl) {
      try {
        let urlStr = value;
        if (!urlStr.startsWith("http://") && !urlStr.startsWith("https://") && !urlStr.startsWith("//")) {
          urlStr = "https://" + urlStr;
        } else if (urlStr.startsWith("//")) {
          urlStr = "https:" + urlStr;
        }
        const parsed = new URL(urlStr);
        const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
        if (host === "youtu.be") {
          const candidate = parsed.pathname.replace(/^\/+/, "").split("/")[0];
          if (isValidYouTubeVideoId(candidate)) return candidate;
          return null;
        }
        if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
          const v = parsed.searchParams.get("v");
          if (v && isValidYouTubeVideoId(v)) return v;
          const parts = parsed.pathname.split("/").filter(Boolean);
          if (parts.length >= 2 && ["embed", "shorts", "v", "e"].includes(parts[0].toLowerCase())) {
            if (isValidYouTubeVideoId(parts[1])) return parts[1];
          }
          return null;
        }
        return null;
      } catch (_err) {}

      const m = value.match(/(?:youtube(?:-nocookie)?\.com\/(?:watch\?[^#]*v=|embed\/|shorts\/|v\/|e\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i);
      if (m && isValidYouTubeVideoId(m[1])) return m[1];
      return null;
    }

    if (isValidYouTubeVideoId(value)) return value;
    return null;
  }

  const extractYouTubeId = extractYouTubeVideoId;

  /** Structural reference checks for PDFs and video attachments. */
  function validateLibrary(library, dataset) {
    const issues = [];
    const subjects = Array.isArray(dataset.bank && dataset.bank.subjects)
      ? dataset.bank.subjects
      : [];
    const knownSubjects = new Set(subjects.map((subject) => subject.id));
    const lecturesBySubject = dataset.lecturesBySubject || {};

    function lectureExists(subjectId, lectureId) {
      if (!lectureId) return true;
      return (lecturesBySubject[subjectId] || []).some((lecture) => lecture.id === lectureId);
    }

    function flag(code, type, id, message) {
      issues.push({
        code,
        category: "invalid-source",
        severity: "error",
        message,
        libraryType: type,
        libraryId: id || null,
        subjectId: null,
        sourceType: type,
        collectionId: id || null,
      });
    }

    function checkUnique(type, items, code) {
      const seen = new Set();
      items.forEach((item) => {
        const id = safeString(item && item.id);
        if (id && seen.has(id)) {
          flag(code, type, id, `Duplicate ${type} id "${id}". Kept as-is for review.`);
        }
        seen.add(id);
      });
    }

    const pdfs = Array.isArray(library && library.pdfs) ? library.pdfs : [];
    checkUnique("pdf", pdfs, "invalid_pdf_reference");
    pdfs.forEach((pdf) => {
      if (!pdf || !pdf.id) return flag("invalid_pdf_reference", "pdf", pdf && pdf.id, "PDF entry has no id.");
      if (!knownSubjects.has(pdf.subjectId)) {
        flag("invalid_pdf_reference", "pdf", pdf.id, `PDF "${pdf.id}" references an unknown subject "${pdf.subjectId}".`);
      }
      if (!pdf.path && !pdf.fileId) {
        flag("invalid_pdf_reference", "pdf", pdf.id, `PDF "${pdf.id}" has no path or uploaded file.`);
      }
      if (!lectureExists(pdf.subjectId, pdf.lectureId)) {
        flag("invalid_pdf_reference", "pdf", pdf.id, `PDF "${pdf.id}" references an unknown lecture "${pdf.lectureId}".`);
      }
    });

    const videos = Array.isArray(library && library.videos) ? library.videos : [];
    checkUnique("video", videos, "invalid_video_reference");
    videos.forEach((video) => {
      if (!video || !video.id) return flag("invalid_video_reference", "video", video && video.id, "Video entry has no id.");
      if (!String(video.title || "").trim()) {
        flag("invalid_video_reference", "video", video.id, `Video "${video.id}" has no title.`);
      }
      if (!knownSubjects.has(video.subjectId)) {
        flag("invalid_video_reference", "video", video.id, `Video "${video.id}" references an unknown subject "${video.subjectId}".`);
      }
      if (!extractYouTubeId(video.youtubeUrl || video.videoId)) {
        flag("invalid_video_reference", "video", video.id, `Video "${video.id}" has an invalid YouTube URL or id.`);
      }
      if (!lectureExists(video.subjectId, video.lectureId)) {
        flag("invalid_video_reference", "video", video.id, `Video "${video.id}" references an unknown lecture "${video.lectureId}".`);
      }
      if (video.order !== undefined && !Number.isFinite(Number(video.order))) {
        flag("invalid_video_reference", "video", video.id, `Video "${video.id}" has a non-numeric order.`);
      }
    });

    return {
      issues,
      counts: {
        pdfs: pdfs.length,
        videos: videos.length,
      },
    };
  }

  /**
   * Validate the dataset.
   * @param {object} dataset {bank, lecturesBySubject, sheetsBySubject}
   * @param {object} [options]
   */
  function validateContent(dataset, options) {
    const opts = options || {};
    const registry = opts.registry || Registry.buildRegistry(dataset);
    const entries = registry.entries;
    const issues = [];
    const referenceResult = validateReferences(dataset, registry);
    const libraryResult = opts.library
      ? validateLibrary(opts.library, dataset)
      : { issues: [], counts: { pdfs: 0, videos: 0 } };
    libraryResult.issues.forEach((issue) => issues.push(issue));

    // Collection-level reference problems apply to every question in the source.
    entries.forEach((entry) => {
      const key = `${entry.subjectId}::${entry.sourceType}::${entry.collectionId}`;
      const collectionProblems = referenceResult.collectionIssues.get(key) || [];
      if (collectionProblems.length === 0) return;
      collectionProblems.forEach((problem) => {
        addIssue(issues, entry, problem.code, { detail: problem.detail, scope: "collection" });
      });
    });

    // Duplicate id/text sets for O(1) membership tests.
    const duplicateIdSet = new Set(
      registry.duplicateOriginalIds.map((item) => item.originalId)
    );
    const duplicateTextSet = new Set(
      registry.duplicateTexts.map((item) => item.normalizedText)
    );

    entries.forEach((entry) => {
      const question = entry.question || {};
      const options = Array.isArray(question.options) ? question.options : [];
      const text = Registry.questionText(question);

      if (!text.trim()) {
        addIssue(issues, entry, "missing_question_text");
      }

      if (options.length === 0) {
        addIssue(issues, entry, "missing_options");
      } else {
        const optionIds = new Set();
        let emptyCount = 0;
        let missingIdCount = 0;
        let duplicateIdCount = 0;
        options.forEach((option) => {
          if (!safeString(option && option.text).trim()) emptyCount += 1;
          const optionId = safeString(option && option.id).trim();
          if (!optionId) {
            missingIdCount += 1;
          } else if (optionIds.has(optionId)) {
            duplicateIdCount += 1;
          }
          optionIds.add(optionId);
        });
        if (emptyCount > 0) addIssue(issues, entry, "empty_option", { count: emptyCount });
        if (missingIdCount > 0)
          addIssue(issues, entry, "missing_option_id", { count: missingIdCount });
        if (duplicateIdCount > 0)
          addIssue(issues, entry, "duplicate_option_id", { count: duplicateIdCount });
      }

      const originalKey = safeString(entry.originalId);
      if (originalKey && duplicateIdSet.has(originalKey)) {
        addIssue(issues, entry, "duplicate_question_id", {
          otherInternalIds: registry
            .lookupAllByOriginalId(originalKey)
            .filter((other) => other.internalId !== entry.internalId)
            .map((other) => other.internalId),
        });
      }

      const normalizedText = Registry.normalizeText(text);
      if (normalizedText && duplicateTextSet.has(normalizedText)) {
        addIssue(issues, entry, "duplicate_question_text");
      }

      const answerKey = safeString(question.correctOptionId).trim();
      if (!answerKey) {
        addIssue(issues, entry, "missing_correct_answer");
      } else if (!options.some((option) => safeString(option && option.id) === answerKey)) {
        addIssue(issues, entry, "invalid_correct_answer", { correctOptionId: answerKey });
      }

      const explanation = safeString(question.explanation);
      const explanationArabic = safeString(question.explanationArabic);
      if (!explanation.trim() && !explanationArabic.trim()) {
        addIssue(issues, entry, "missing_explanation");
      } else if (
        detectPlaceholderExplanation(explanation) ||
        detectPlaceholderExplanation(explanationArabic)
      ) {
        addIssue(issues, entry, "placeholder_explanation");
      }

      if (
        answerKey &&
        safeString(question.correctAnswerText).trim() &&
        options.some((option) => safeString(option && option.id) === answerKey)
      ) {
        const correctOption = options.find(
          (option) => safeString(option && option.id) === answerKey
        );
        if (
          normalizeOptionText(question.correctAnswerText) !==
          normalizeOptionText(correctOption && correctOption.text)
        ) {
          addIssue(issues, entry, "correct_answer_text_mismatch", {
            correctAnswerText: question.correctAnswerText,
            optionText: correctOption ? correctOption.text : null,
          });
        }
      }

      if (Array.isArray(question.reviewNotes) && question.reviewNotes.length > 0) {
        addIssue(issues, entry, "review_notes_present", {
          reviewNotes: question.reviewNotes.slice(),
        });
      }

      if (question.number === undefined || question.number === null || question.number === "") {
        addIssue(issues, entry, "missing_question_number");
      }

      if (
        question.subjectId &&
        safeString(question.subjectId) !== safeString(entry.subjectId)
      ) {
        addIssue(issues, entry, "invalid_question_subject_reference", {
          questionSubjectId: question.subjectId,
        });
      }
    });

    // Group issues by internal id and classify each question.
    const issuesByEntry = new Map();
    issues.forEach((issue) => {
      if (!issue.internalId) return;
      if (!issuesByEntry.has(issue.internalId)) issuesByEntry.set(issue.internalId, []);
      issuesByEntry.get(issue.internalId).push(issue);
    });

    const categories = {
      valid: [],
      "duplicate-content": [],
      "missing-answer": [],
      "invalid-source": [],
      "requires-human-review": [],
    };

    const entrySummaries = entries.map((entry) => {
      const entryIssues = issuesByEntry.get(entry.internalId) || [];
      const entryCategories = Array.from(
        new Set(entryIssues.map((issue) => issue.category))
      ).sort((a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b));

      if (entryCategories.length === 0) {
        categories.valid.push(entry.internalId);
      } else {
        entryCategories.forEach((category) => {
          if (categories[category]) categories[category].push(entry.internalId);
        });
      }

      return {
        internalId: entry.internalId,
        originalId: entry.originalId,
        subjectId: entry.subjectId,
        sourceType: entry.sourceType,
        collectionId: entry.collectionId,
        categories: entryCategories,
        issueCodes: Array.from(new Set(entryIssues.map((issue) => issue.code))).sort(),
      };
    });

    const issuesByCode = {};
    issues.forEach((issue) => {
      issuesByCode[issue.code] = (issuesByCode[issue.code] || 0) + 1;
    });

    const bySource = { quiz: 0, lecture: 0, sheet: 0 };
    const bySubject = {};
    entries.forEach((entry) => {
      bySource[entry.sourceType] = (bySource[entry.sourceType] || 0) + 1;
      bySubject[entry.subjectId] = (bySubject[entry.subjectId] || 0) + 1;
    });

    const fingerprintPayload = entries.map((entry) => ({
      internalId: entry.internalId,
      originalId: entry.originalId,
      subjectId: entry.subjectId,
      sourceType: entry.sourceType,
      collectionId: entry.collectionId,
      question: entry.question,
    }));

    const report = {
      schemaVersion: 1,
      reportType: "content-integrity",
      generatedAt: opts.generatedAt || new Date().toISOString(),
      mode: "validate-only",
      policy: {
        autoFix: false,
        autoDelete: false,
        autoRewrite: false,
        answerGuessing: false,
        originalDataImmutable: true,
      },
      source: opts.source || "project-data",
      contentFingerprint: fingerprint(fingerprintPayload),
      fileHashes: Array.isArray(opts.fileHashes) ? opts.fileHashes : [],
      totals: {
        questions: entries.length,
        bySource,
        bySubject,
      },
      summary: {
        valid: categories.valid.length,
        duplicateContent: categories["duplicate-content"].length,
        missingAnswer: categories["missing-answer"].length,
        invalidSource: categories["invalid-source"].length,
        requiresHumanReview: categories["requires-human-review"].length,
        issues: issues.length,
        issuesByCode,
        duplicateOriginalIdGroups: registry.duplicateOriginalIds.length,
        duplicateTextGroups: registry.duplicateTexts.length,
      },
      categories,
      duplicates: {
        originalIds: registry.duplicateOriginalIds,
        texts: registry.duplicateTexts,
      },
      references: {
        issues: referenceResult.issues,
        libraryIssues: libraryResult.issues,
      },
      library: {
        counts: libraryResult.counts,
        issues: libraryResult.issues,
      },
      issues,
      entries: entrySummaries,
    };

    return report;
  }

  /** Compact text summary used by the UI and the markdown report. */
  function summarizeReport(report) {
    if (!report) return "No integrity report available.";
    const summary = report.summary || {};
    return [
      `${report.totals.questions} questions validated`,
      `${summary.valid} valid`,
      `${summary.duplicateContent} duplicate-content`,
      `${summary.missingAnswer} missing-answer`,
      `${summary.invalidSource} invalid-source`,
      `${summary.requiresHumanReview} requiring human review`,
    ].join(" · ");
  }

  const api = {
    ISSUE_DEFINITIONS,
    CATEGORY_ORDER,
    validateContent,
    summarizeReport,
    stableStringify,
    fingerprint,
  };

  root.BankQuestionCore = root.BankQuestionCore || {};
  root.BankQuestionCore.ContentValidator = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
