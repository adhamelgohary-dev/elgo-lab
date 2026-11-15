/**
 * Bank Question — Content Import Pipeline (Phase 5)
 *
 * Structural import for future lectures/quizzes and PDF-derived text, TXT,
 * Markdown, JSON and LMS exports.
 *
 * Guarantees:
 *  - imported question text, options and answer keys are preserved verbatim;
 *  - missing answers are reported, never guessed;
 *  - duplicates are reported, never deleted or merged;
 *  - every import is a versioned package that can be accepted, rejected and
 *    rolled back;
 *  - generated identifiers are added as metadata only (original ids are kept
 *    when present, `originalId: null` otherwise).
 *
 * The module is environment-agnostic and performs no UI work.
 */
(function (root) {
  "use strict";

  const Core = root.BankQuestionCore || {};
  let Registry = Core.ContentRegistry;
  let Validator = Core.ContentValidator;
  if (typeof require === "function") {
    if (!Registry) Registry = require("./content-registry.js");
    if (!Validator) Validator = require("./content-validator.js");
  }

  const STORAGE_KEY = "mcq_bank_import_packages_v1";
  const SCHEMA_VERSION = 1;
  const SUPPORTED_KINDS = ["json", "txt", "md", "markdown", "pdf-text", "lms", "text"];

  function safeString(value) {
    return value === null || value === undefined ? "" : String(value);
  }

  function nowIso(now) {
    if (now instanceof Date) return now.toISOString();
    if (typeof now === "string") return now;
    return new Date().toISOString();
  }

  function deepClone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function sanitizeImageUrl(raw) {
    const s = safeString(raw).trim();
    if (!s) return "";
    if (/^\/(?!\/)[^\s"'<>\\]{1,500}$/.test(s)) return s;
    if (/^https:\/\/[^\s"'<>\\]{4,1000}$/i.test(s)) return s;
    if (/^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]{16,380000}$/i.test(s)) return s;
    return "";
  }

  function collectQuestionImages(rawQuestion) {
    if (!rawQuestion || typeof rawQuestion !== "object") return [];
    const defaultAlt = safeString(rawQuestion.imageAlt || rawQuestion.alt).trim().slice(0, 200);
    const defaultCaption = safeString(rawQuestion.imageCaption || rawQuestion.caption).trim().slice(0, 300);
    const candidates = [];
    if (Array.isArray(rawQuestion.images)) {
      rawQuestion.images.forEach((it) => candidates.push(it));
    }
    const single = rawQuestion.image || rawQuestion.imageUrl || rawQuestion.img || rawQuestion.diagram || rawQuestion.figure;
    if (single) candidates.push(single);

    const out = [];
    const seen = new Set();
    for (let i = 0; i < candidates.length; i += 1) {
      const entry = candidates[i];
      if (!entry) continue;
      let rawUrl = "";
      let alt = defaultAlt;
      let caption = defaultCaption;
      if (typeof entry === "string") {
        rawUrl = entry;
      } else if (typeof entry === "object") {
        rawUrl = safeString(entry.url || entry.src || entry.image);
        alt = safeString(entry.alt || defaultAlt).trim().slice(0, 200);
        caption = safeString(entry.caption || defaultCaption).trim().slice(0, 300);
      }
      const cleanUrl = sanitizeImageUrl(rawUrl);
      if (!cleanUrl || seen.has(cleanUrl)) continue;
      seen.add(cleanUrl);
      const item = { url: cleanUrl };
      if (alt) item.alt = alt;
      if (caption) item.caption = caption;
      out.push(item);
      if (out.length >= 6) break;
    }
    return out;
  }

  function applyNormalizedImages(target, imgList) {
    if (!target || !Array.isArray(imgList) || imgList.length === 0) return target;
    target.image = imgList[0].url;
    if (imgList[0].alt) target.imageAlt = imgList[0].alt;
    if (imgList[0].caption) target.imageCaption = imgList[0].caption;
    target.images = imgList;
    return target;
  }

  function slugify(value) {
    return safeString(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "package";
  }

  function fingerprint(value) {
    return Validator
      ? Validator.fingerprint(value)
      : String(value).length.toString(16);
  }

  function normalizeKind(kind, filename) {
    const value = safeString(kind || "").toLowerCase();
    if (SUPPORTED_KINDS.includes(value)) {
      if (value === "markdown") return "md";
      if (value === "text") return "txt";
      return value;
    }
    const name = safeString(filename).toLowerCase();
    if (name.endsWith(".json")) return "json";
    if (name.endsWith(".md") || name.endsWith(".markdown")) return "md";
    if (name.endsWith(".pdf")) return "pdf-text";
    return "txt";
  }

  function detectQuestionText(question) {
    return Registry.questionText(question);
  }

  /**
   * Parse an LMS-style text export:
   *   Question: 1
   *   <stem>
   *   A. option
   *   B. option
   *   Correct Answer        <- marks the option above
   */
  function parseLmsText(text) {
    const blocks = String(text).split(/^Question:\s*(\d+)\s*$/m);
    const questions = [];
    for (let i = 1; i < blocks.length; i += 2) {
      const number = parseInt(blocks[i], 10);
      const lines = blocks[i + 1].split(/\r?\n/);
      const stemLines = [];
      const options = [];
      let current = null;
      let inOptions = false;

      lines.forEach((rawLine) => {
        const line = rawLine.trim();
        if (!line) return;
        if (/^(Staus|Status|Mark):/i.test(line)) return;
        if (/^Select only one$/i.test(line)) {
          inOptions = true;
          return;
        }
        const optionMatch = rawLine.match(/^\s*([A-H])\s*[.)]\s?(.*)$/);
        if (optionMatch) {
          inOptions = true;
          current = {
            id: optionMatch[1],
            text: optionMatch[2],
            isCorrect: false,
          };
          options.push(current);
          return;
        }
        if (/^Correct Answer\b/i.test(line)) {
          if (current) current.isCorrect = true;
          return;
        }
        if (/^Incorrect Answer\b/i.test(line)) {
          if (current) current.wasSelectedIncorrect = true;
          return;
        }
        if (!inOptions) {
          stemLines.push(rawLine);
        } else if (current) {
          current.text += `\n${rawLine}`;
        }
      });

      const correctOption = options.find((option) => option.isCorrect) || null;
      questions.push({
        id: `Q${number}`,
        number,
        question: stemLines.join("\n").trim(),
        options: options.map((option) => ({ id: option.id, text: option.text })),
        correctOptionId: correctOption ? correctOption.id : null,
        correctAnswerText: correctOption ? correctOption.text : null,
        reviewNotes: correctOption
          ? []
          : ["No correct answer marked in the imported source. Not guessed."],
      });
    }
    return questions;
  }

  /**
   * Parse a generic numbered TXT/Markdown quiz:
   *   1. Question text?
   *   A) option
   *   B) option
   *   Answer: B
   */
  function parseNumberedText(text, filename) {
    const lines = String(text).split(/\r?\n/);
    const questions = [];
    let current = null;
    let pendingCorrect = null;
    let pendingMeta = {};
    let pendingImages = [];
    let pendingImageAlt = "";
    let pendingImageCaption = "";
    let activeMetaField = null;

    function flush() {
      if (!current) return;
      let correctOptionId = pendingCorrect;
      const starred = current.options.find((option) => option._starred);
      if (!correctOptionId && starred) correctOptionId = starred.id;
      current.options.forEach((option) => delete option._starred);
      const qObj = {
        id: current.id,
        number: current.number,
        question: current.stemLines.join("\n").trim(),
        options: current.options.map((option) => ({ id: option.id, text: option.text })),
        correctOptionId: correctOptionId || null,
        correctAnswerText: correctOptionId
          ? (current.options.find((option) => option.id === correctOptionId) || {}).text || null
          : null,
        reviewNotes: correctOptionId
          ? []
          : ["No correct answer marked in the imported source. Not guessed."],
      };
      ["explanation", "explanationArabic", "rule", "whyYouMightErr", "memoryTrick"].forEach((k) => {
        if (pendingMeta[k] && String(pendingMeta[k]).trim()) {
          qObj[k] = String(pendingMeta[k]).trim();
        }
      });
      if (pendingImages.length > 0) {
        const imgs = pendingImages.map((img) => {
          const item = { url: img.url };
          const alt = img.alt || pendingImageAlt;
          const cap = img.caption || pendingImageCaption;
          if (alt) item.alt = alt;
          if (cap) item.caption = cap;
          return item;
        });
        applyNormalizedImages(qObj, imgs);
      }
      questions.push(qObj);
      current = null;
      pendingCorrect = null;
      pendingMeta = {};
      pendingImages = [];
      pendingImageAlt = "";
      pendingImageCaption = "";
      activeMetaField = null;
    }

    const metaMatchers = [
      { field: "explanationArabic", re: /^\s*(?:Arabic\s*Explanation|Explanation\s*(?:AR|Arabic)|التعليل|الشرح\s*بالعربي)\s*[:\-]\s*(.*)$/i },
      { field: "explanation", re: /^\s*(?:Academic\s*Explanation|Explanation|Reason|Rationale|شرح|تفسير)\s*[:\-]\s*(.*)$/i },
      { field: "rule", re: /^\s*(?:Key\s*Rule|Rule|القاعدة)\s*[:\-]\s*(.*)$/i },
      { field: "whyYouMightErr", re: /^\s*(?:Why(?:\s+You\s+Might\s+Err|\s+Mislead)?|Trap|Common\s+Mistake|لماذا\s+قد\s+تخطئ)\s*[:\-]\s*(.*)$/i },
      { field: "memoryTrick", re: /^\s*(?:Memory\s*Trick|Mnemonic|Hint|تلميح)\s*[:\-]\s*(.*)$/i },
    ];

    lines.forEach((rawLine) => {
      if (!rawLine.trim()) return; // blank lines separate blocks; never part of an option
      const line = rawLine.replace(/^\s*#{1,6}\s*/, "");
      const questionMatch = line.match(/^\s*(?:Question\s*)?(\d+)\s*[.)]\s+(.*)$/i);
      if (questionMatch) {
        flush();
        current = {
          id: `Q${questionMatch[1]}`,
          number: parseInt(questionMatch[1], 10),
          stemLines: [questionMatch[2]],
          options: [],
        };
        return;
      }
      if (!current) {
        // Preamble/title lines before the first question are ignored as metadata.
        return;
      }
      const mdImageOnly = line.match(/^\s*!\[([^\]]*)\]\(([^)\s]+)\)\s*$/);
      if (mdImageOnly) {
        const cleanUrl = sanitizeImageUrl(mdImageOnly[2]);
        if (cleanUrl && pendingImages.length < 6 && !pendingImages.some((it) => it.url === cleanUrl)) {
          pendingImages.push({ url: cleanUrl, alt: safeString(mdImageOnly[1]).trim().slice(0, 200) });
        }
        activeMetaField = null;
        return;
      }
      const imageLineMatch = line.match(/^\s*(?:Image(?:\s*URL)?|Img|Diagram|Figure|صورة)\s*[:\-]\s*(.*)$/i);
      if (imageLineMatch) {
        const rawSpec = imageLineMatch[1].trim();
        const nestedMd = rawSpec.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
        const cleanUrl = sanitizeImageUrl(nestedMd ? nestedMd[2] : rawSpec);
        if (cleanUrl && pendingImages.length < 6 && !pendingImages.some((it) => it.url === cleanUrl)) {
          pendingImages.push({ url: cleanUrl, alt: nestedMd ? safeString(nestedMd[1]).trim().slice(0, 200) : "" });
        }
        activeMetaField = null;
        return;
      }
      const imageAltMatch = line.match(/^\s*(?:Image\s*Alt|Alt)\s*[:\-]\s*(.*)$/i);
      if (imageAltMatch) {
        const altTxt = imageAltMatch[1].trim().slice(0, 200);
        if (pendingImages.length > 0) pendingImages[pendingImages.length - 1].alt = altTxt;
        else pendingImageAlt = altTxt;
        activeMetaField = null;
        return;
      }
      const imageCapMatch = line.match(/^\s*(?:Image\s*Caption|Caption|التعليق)\s*[:\-]\s*(.*)$/i);
      if (imageCapMatch) {
        const capTxt = imageCapMatch[1].trim().slice(0, 300);
        if (pendingImages.length > 0) pendingImages[pendingImages.length - 1].caption = capTxt;
        else pendingImageCaption = capTxt;
        activeMetaField = null;
        return;
      }
      const answerMatch = line.match(/^\s*(?:Correct\s*)?Answer\s*[:\-]\s*([A-H])\b/i);
      if (answerMatch) {
        pendingCorrect = answerMatch[1].toUpperCase();
        activeMetaField = null;
        return;
      }
      for (let m = 0; m < metaMatchers.length; m += 1) {
        const hit = line.match(metaMatchers[m].re);
        if (hit) {
          activeMetaField = metaMatchers[m].field;
          pendingMeta[activeMetaField] = hit[1] ? hit[1].trim() : "";
          return;
        }
      }
      const optionMatch = line.match(/^\s*([A-H])\s*[.)]\s*(.*)$/);
      if (optionMatch) {
        activeMetaField = null;
        const optionText = optionMatch[2];
        current.options.push({
          id: optionMatch[1],
          text: optionText.replace(/\s*\*+\s*$/, ""),
          _starred: /\*+\s*$/.test(optionText),
        });
        return;
      }
      if (activeMetaField) {
        pendingMeta[activeMetaField] = (pendingMeta[activeMetaField] ? pendingMeta[activeMetaField] + "\n" : "") + rawLine.trim();
        return;
      }
      if (current.options.length === 0) {
        current.stemLines.push(rawLine);
      } else if (current.options.length > 0) {
        const lastOption = current.options[current.options.length - 1];
        lastOption.text += `\n${rawLine}`;
      }
    });
    flush();

    return questions.map((question) => {
      const copy = Object.assign({}, question);
      if (!copy.question) {
        copy.question = `${filename || "Imported"} question ${copy.number}`;
      }
      return copy;
    });
  }

  function parseJsonQuestions(text) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new Error(`Invalid JSON: ${err.message}`);
    }
    let questions = [];
    if (Array.isArray(parsed)) questions = parsed;
    else if (parsed && Array.isArray(parsed.questions)) questions = parsed.questions;
    else if (parsed && parsed.quiz && Array.isArray(parsed.quiz.questions)) {
      questions = parsed.quiz.questions;
    } else if (parsed && Array.isArray(parsed.items)) questions = parsed.items;
    else throw new Error("JSON must contain an array of questions or a `questions` array.");

    const letters = ["A", "B", "C", "D", "E", "F", "G", "H"];

    return questions.map((question, index) => {
      const copy = deepClone(question) || {};
      if (copy.id === undefined || copy.id === null || copy.id === "") {
        copy.id = `Q${index + 1}`;
        copy.generatedId = true;
      }
      copy.originalId = question && question.id !== undefined ? question.id : null;
      if (copy.number === undefined || copy.number === null) copy.number = index + 1;

      // Question text mapping
      if (!copy.question && copy.text) {
        copy.question = copy.text;
      }
      if (!copy.text && copy.question) {
        copy.text = copy.question;
      }

      // Options normalization (supports array of strings or array of objects)
      if (Array.isArray(copy.options) && copy.options.length > 0) {
        copy.options = copy.options.map((opt, optIdx) => {
          if (typeof opt === "string") {
            return { id: letters[optIdx] || String(optIdx + 1), text: opt };
          }
          if (opt && typeof opt === "object") {
            const optCopy = Object.assign({}, opt);
            if (!optCopy.id) optCopy.id = letters[optIdx] || String(optIdx + 1);
            if (optCopy.text === undefined && optCopy.option !== undefined) optCopy.text = optCopy.option;
            return optCopy;
          }
          return { id: letters[optIdx] || String(optIdx + 1), text: String(opt || "") };
        });
      }

      // Correct answer mapping (supports numeric index 0..N, letter "B", or option id)
      if (copy.correctOptionId === undefined || copy.correctOptionId === null || copy.correctOptionId === "") {
        if (typeof copy.correctAnswer === "number" && copy.correctAnswer >= 0) {
          const targetOpt = (copy.options || [])[copy.correctAnswer];
          copy.correctOptionId = targetOpt ? targetOpt.id : (letters[copy.correctAnswer] || String(copy.correctAnswer + 1));
        } else if (typeof copy.correctAnswer === "string") {
          const clean = copy.correctAnswer.trim();
          const matchedOpt = (copy.options || []).find((o) => o.id.toUpperCase() === clean.toUpperCase());
          copy.correctOptionId = matchedOpt ? matchedOpt.id : clean;
        } else if (copy.answer !== undefined && copy.answer !== null) {
          if (typeof copy.answer === "number" && copy.options && copy.options[copy.answer]) {
            copy.correctOptionId = copy.options[copy.answer].id;
          } else if (typeof copy.answer === "string") {
            const clean = copy.answer.trim();
            const matchedOpt = (copy.options || []).find((o) => o.id.toUpperCase() === clean.toUpperCase());
            copy.correctOptionId = matchedOpt ? matchedOpt.id : clean;
          }
        }
      }

      // Preserve metadata & bilingual explanation aliases
      if (copy.arabicTranslation) copy.arabicTranslation = String(copy.arabicTranslation);
      if (copy.memoryTrick) copy.memoryTrick = String(copy.memoryTrick);
      if (copy.academicExplanation && !copy.explanation) copy.explanation = String(copy.academicExplanation);
      if (copy.arabicExplanation && !copy.explanationArabic) copy.explanationArabic = String(copy.arabicExplanation);
      if (copy.keyRule && !copy.rule) copy.rule = String(copy.keyRule);
      if ((copy.commonMistake || copy.whyMislead) && !copy.whyYouMightErr) {
        copy.whyYouMightErr = String(copy.commonMistake || copy.whyMislead);
      }

      const imgs = collectQuestionImages(copy);
      if (imgs.length > 0) {
        applyNormalizedImages(copy, imgs);
      } else {
        delete copy.image;
        delete copy.images;
      }

      return copy;
    });
  }

  function createPipeline(options) {
    const opts = options || {};
    const storage = opts.storage || (typeof localStorage !== "undefined" ? localStorage : null);
    const storageKey = opts.storageKey || STORAGE_KEY;
    const clock = opts.now;
    let registry = opts.registry || null;

    function readState() {
      if (!storage) return { schemaVersion: SCHEMA_VERSION, packages: [] };
      try {
        const raw = storage.getItem(storageKey);
        if (!raw) return { schemaVersion: SCHEMA_VERSION, packages: [] };
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.packages)) {
          return { schemaVersion: SCHEMA_VERSION, packages: [] };
        }
        return parsed;
      } catch (err) {
        return { schemaVersion: SCHEMA_VERSION, packages: [] };
      }
    }

    let state = readState();

    function persist() {
      if (!storage) return;
      try {
        storage.setItem(storageKey, JSON.stringify(state));
      } catch (err) {
        /* ignore quota errors, keep in memory */
      }
    }

    function setRegistry(next) {
      registry = next;
    }

    /** Parse raw input into a draft, without storing anything. */
    function parse(input) {
      const source = input || {};
      const kind = normalizeKind(source.kind, source.filename);
      const text = safeString(source.text);
      if (!text.trim()) throw new Error("The imported content is empty.");
      if (kind === "pdf-text" && /^%PDF-/.test(text)) {
        throw new Error(
          "Binary PDF import is not supported in the browser. Provide the extracted text of the PDF (PDF → text) and import it as text."
        );
      }

      let questions;
      if (kind === "json") {
        questions = Array.isArray(source.questions)
          ? deepClone(source.questions)
          : parseJsonQuestions(text);
      } else if (kind === "lms") {
        questions = source.questions
          ? deepClone(source.questions)
          : /^[\s]*[[{]/.test(text)
          ? parseJsonQuestions(text)
          : parseLmsText(text);
      } else if (/\bQuestion:\s*\d+\s*$/m.test(text)) {
        questions = parseLmsText(text);
      } else {
        questions = parseNumberedText(text, source.filename);
      }

      const subjectId = safeString(source.subjectId || "").trim() || "imported-content";
      const collectionId =
        safeString(source.collectionId || "").trim() ||
        `${slugify(source.title || source.filename || "import")}-${Date.now()}`;
      const title = source.title || collectionId;

      const issues = [];
      const duplicateOriginalIds = [];
      const duplicateTexts = [];
      const missingAnswers = [];
      const seenIds = new Map();
      const seenTexts = new Map();

      const prepared = questions.map((question, index) => {
        const copy = deepClone(question);
        copy.number = copy.number === undefined || copy.number === null ? index + 1 : copy.number;
        const originalId =
          copy.originalId !== undefined && copy.originalId !== null ? copy.originalId : copy.id;
        const id = safeString(copy.id || `Q${index + 1}`);
        copy.id = id;
        copy.importMeta = Object.assign({}, copy.importMeta, {
          originalId: originalId === undefined ? null : originalId,
          sourceType: "import",
          collectionId,
          subjectId,
          packageQuestionIndex: index,
        });
        // Provisional internal id; the registry assigns the final one on accept.
        copy.internalIdPreview = Registry
          ? Registry.internalIdFor(subjectId, "import", collectionId, id, index)
          : `${subjectId}::import::${collectionId}::${id}`;

        const optionIds = new Set(
          (copy.options || []).map((option) => safeString(option && option.id))
        );
        if (!detectQuestionText(copy).trim()) {
          issues.push({
            code: "missing_question_text",
            severity: "error",
            questionId: id,
            index,
            message: "The imported question has no text. Kept for review; nothing was invented.",
          });
        }
        if (!Array.isArray(copy.options) || copy.options.length === 0) {
          issues.push({
            code: "missing_options",
            severity: "error",
            questionId: id,
            index,
            message: "The imported question has no options. Kept for review.",
          });
        }
        if (!copy.correctOptionId || !optionIds.has(safeString(copy.correctOptionId))) {
          missingAnswers.push({ index, id, originalId: copy.importMeta.originalId });
          issues.push({
            code: "missing_correct_answer",
            severity: "error",
            questionId: id,
            index,
            message: "No valid correct answer in the imported source. Not guessed.",
          });
        }

        if (seenIds.has(id)) {
          duplicateOriginalIds.push(id);
          issues.push({
            code: "duplicate_import_id",
            severity: "warn",
            questionId: id,
            index,
            message: "The imported package reuses a question id. Kept; internal ids keep them distinct.",
          });
        }
        seenIds.set(id, index);

        const normalized = Registry
          ? Registry.normalizeText(detectQuestionText(copy))
          : safeString(detectQuestionText(copy)).toLowerCase();
        if (normalized && seenTexts.has(normalized)) {
          duplicateTexts.push({ text: normalized, firstIndex: seenTexts.get(normalized), index });
          issues.push({
            code: "duplicate_import_text",
            severity: "info",
            questionId: id,
            index,
            message: "Duplicate question text inside the imported package. Kept as-is.",
          });
        } else if (normalized) {
          seenTexts.set(normalized, index);
        }

        if (registry && normalized) {
          const existing = registry.entries.filter(
            (entry) =>
              Registry.normalizeText(Registry.questionText(entry.question)) === normalized
          );
          if (existing.length > 0) {
            issues.push({
              code: "duplicate_existing_content",
              severity: "info",
              questionId: id,
              index,
              message: "This question text already exists in the project content. It is not deleted or merged.",
              existingInternalIds: existing.map((entry) => entry.internalId),
            });
          }
        }

        if (Array.isArray(copy.reviewNotes) && copy.reviewNotes.length > 0) {
          issues.push({
            code: "review_notes_present",
            severity: "info",
            questionId: id,
            index,
            message: "The imported item carries review notes.",
          });
        }

        return copy;
      });

      const checksum = fingerprint(prepared);
      return {
        kind,
        filename: source.filename || null,
        subjectId,
        collectionId,
        title,
        questions: prepared,
        checksum,
        issues,
        summary: {
          questionCount: prepared.length,
          missingAnswers: missingAnswers.length,
          duplicateImportIds: duplicateOriginalIds.length,
          duplicateImportTexts: duplicateTexts.length,
          issues: issues.length,
        },
        reviewQueue: issues.map((issue) => ({
          code: issue.code,
          severity: issue.severity,
          questionId: issue.questionId,
          index: issue.index,
          message: issue.message,
        })),
        missingAnswers,
        duplicateOriginalIds,
        duplicateTexts,
      };
    }

    function makePackageId(draft) {
      return `${slugify(draft.subjectId)}-${slugify(draft.collectionId)}`;
    }

    /** Store a draft as a pending package version. */
    function stage(draft) {
      const packageId = draft.packageId || makePackageId(draft);
      let record = state.packages.find((item) => item.id === packageId);
      if (!record) {
        record = { id: packageId, createdAt: nowIso(clock), versions: [] };
        state.packages.push(record);
      }
      const previous = record.versions[record.versions.length - 1];
      const version = previous ? previous.version + 1 : 1;
      record.subjectId = draft.subjectId;
      record.collectionId = draft.collectionId;
      record.title = draft.title;
      record.updatedAt = nowIso(clock);
      record.versions.push({
        version,
        status: "pending",
        importedAt: nowIso(clock),
        kind: draft.kind,
        filename: draft.filename,
        checksum: draft.checksum,
        summary: draft.summary,
        issues: draft.issues,
        reviewQueue: draft.reviewQueue,
        missingAnswers: draft.missingAnswers,
        questions: draft.questions,
      });
      persist();
      return { packageId, version, record: deepClone(record) };
    }

    function getPackage(packageId) {
      return deepClone(state.packages.find((item) => item.id === packageId) || null);
    }

    function getVersion(packageId, version) {
      const record = state.packages.find((item) => item.id === packageId);
      if (!record) return null;
      if (version === undefined || version === null) {
        return deepClone(record.versions[record.versions.length - 1] || null);
      }
      return deepClone(record.versions.find((item) => item.version === version) || null);
    }

    function listPackages() {
      return state.packages.map((record) => ({
        id: record.id,
        subjectId: record.subjectId,
        collectionId: record.collectionId,
        title: record.title,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        versions: record.versions.map((version) => ({
          version: version.version,
          status: version.status,
          importedAt: version.importedAt,
          questionCount: version.summary.questionCount,
          checksum: version.checksum,
        })),
      }));
    }

    function setVersionStatus(packageId, version, status) {
      const record = state.packages.find((item) => item.id === packageId);
      if (!record) throw new Error(`Unknown package: ${packageId}`);
      const target = record.versions.find((item) => item.version === version);
      if (!target) throw new Error(`Unknown package version: ${packageId} v${version}`);
      target.status = status;
      if (status === "accepted") {
        target.acceptedAt = nowIso(clock);
        record.activeVersion = version;
        record.versions.forEach((other) => {
          if (other.version !== version && other.status === "accepted") {
            other.status = "superseded";
          }
        });
      }
      if (status === "rejected") target.rejectedAt = nowIso(clock);
      record.updatedAt = nowIso(clock);
      persist();
      return deepClone(target);
    }

    function accept(packageId, version) {
      const record = state.packages.find((item) => item.id === packageId);
      if (!record) throw new Error(`Unknown package: ${packageId}`);
      const target =
        version === undefined
          ? record.versions[record.versions.length - 1]
          : record.versions.find((item) => item.version === version);
      if (!target) throw new Error(`Unknown package version: ${packageId} v${version}`);
      setVersionStatus(packageId, target.version, "accepted");
      return {
        packageId,
        version: target.version,
        subjectId: record.subjectId,
        collectionId: record.collectionId,
        title: record.title,
        questions: deepClone(target.questions),
        summary: deepClone(target.summary),
      };
    }

    function reject(packageId, version) {
      const record = state.packages.find((item) => item.id === packageId);
      if (!record) throw new Error(`Unknown package: ${packageId}`);
      const target =
        version === undefined
          ? record.versions[record.versions.length - 1]
          : record.versions.find((item) => item.version === version);
      if (!target) throw new Error(`Unknown package version: ${packageId} v${version}`);
      return setVersionStatus(packageId, target.version, "rejected");
    }

    /**
     * Roll back to an earlier accepted version. Returns the payload the app must
     * re-apply, so the active content can be replaced without deleting files.
     */
    function rollback(packageId, version) {
      const record = state.packages.find((item) => item.id === packageId);
      if (!record) throw new Error(`Unknown package: ${packageId}`);
      const target = record.versions.find((item) => item.version === version);
      if (!target) throw new Error(`Unknown package version: ${packageId} v${version}`);
      if (target.status === "rejected") {
        throw new Error("Cannot roll back to a rejected version.");
      }
      record.versions.forEach((other) => {
        if (other.version !== version && other.status === "accepted") {
          other.status = "superseded";
        }
      });
      target.status = "accepted";
      target.acceptedAt = nowIso(clock);
      record.activeVersion = version;
      record.updatedAt = nowIso(clock);
      persist();
      return {
        packageId,
        version,
        subjectId: record.subjectId,
        collectionId: record.collectionId,
        title: record.title,
        questions: deepClone(target.questions),
        summary: deepClone(target.summary),
      };
    }

    function activeVersion(packageId) {
      const record = state.packages.find((item) => item.id === packageId);
      return record ? record.activeVersion || null : null;
    }

    function exportReport(packageId, version) {
      const record = state.packages.find((item) => item.id === packageId);
      if (!record) throw new Error(`Unknown package: ${packageId}`);
      const target =
        version === undefined
          ? record.versions[record.versions.length - 1]
          : record.versions.find((item) => item.version === version);
      if (!target) throw new Error(`Unknown package version.`);
      return {
        schemaVersion: SCHEMA_VERSION,
        reportType: "import",
        generatedAt: nowIso(clock),
        packageId,
        packageVersion: target.version,
        status: target.status,
        checksum: target.checksum,
        subjectId: record.subjectId,
        collectionId: record.collectionId,
        title: record.title,
        summary: target.summary,
        issues: target.issues,
        reviewQueue: target.reviewQueue,
        missingAnswers: target.missingAnswers,
        policy: {
          questionsPreserved: true,
          answersGuessed: false,
          duplicatesDeleted: false,
          contentRewritten: false,
        },
      };
    }

    return {
      STORAGE_KEY: storageKey,
      setRegistry,
      parse,
      stage,
      listPackages,
      getPackage,
      getVersion,
      accept,
      reject,
      rollback,
      activeVersion,
      exportReport,
      getState: () => deepClone(state),
      reload: () => {
        state = readState();
        return state;
      },
    };
  }

  const api = {
    STORAGE_KEY,
    SCHEMA_VERSION,
    SUPPORTED_KINDS,
    createPipeline,
    parseLmsText,
    parseNumberedText,
    parseJsonQuestions,
    normalizeKind,
  };

  root.BankQuestionCore = root.BankQuestionCore || {};
  root.BankQuestionCore.ImportPipeline = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
