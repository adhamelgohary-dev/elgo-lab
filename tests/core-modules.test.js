"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const MistakesStore = require("../src/core/mistakes-store");
const ImportPipeline = require("../src/core/import-pipeline");
const { buildRegistry } = require("../src/core/content-registry");
const answerKey = require("../backend/answer-key");

const ROOT = path.resolve(__dirname, "..");

test("canonical subjects, lecture quizzes, and sheets match backend answer-key counts cleanly", () => {
  const subjFiles = fs.readdirSync(path.join(ROOT, "content/subjects")).filter((f) => f.endsWith(".json")).sort();
  assert.equal(subjFiles.length, 1);

  let totalQuestions = 0;
  for (const file of subjFiles) {
    const subj = JSON.parse(fs.readFileSync(path.join(ROOT, "content/subjects", file), "utf8"));
    assert.ok(subj.id && subj.name);
    for (const qz of subj.quizzes || []) {
      totalQuestions += qz.questions.length;
      const colKey = `${subj.id}::${qz.id}`;
      const colEntry = answerKey.collections[colKey];
      assert.ok(colEntry, `Missing answer-key collection: ${colKey}`);

      const keyedCount = qz.questions.filter((q) => Boolean(q.correctOptionId)).length;
      const unkeyedIds = qz.questions.filter((q) => !q.correctOptionId).map((q) => q.internalId).filter(Boolean);
      assert.equal(colEntry.gradableQuestions, keyedCount, `${colKey} gradable count mismatch`);
      for (const uid of unkeyedIds) {
        assert.ok((colEntry.ungradableIds || []).includes(uid), `${colKey} missing ungradableId ${uid}`);
      }

      for (const q of qz.questions) {
        assert.ok(String(q.question || q.text || "").trim().length > 0, `Empty stem in ${colKey}`);
        assert.ok(Array.isArray(q.options) && q.options.length >= 2, `Insufficient options in ${colKey}`);
        if (q.correctOptionId) {
          assert.ok(q.options.some((o) => o.id === q.correctOptionId), `Missing option key in ${colKey}`);
        }
      }
    }
    for (const lec of subj.lectures || []) {
      totalQuestions += (lec.generatedQuiz && lec.generatedQuiz.questions.length) || 0;
    }
    for (const sh of subj.sheets || []) {
      totalQuestions += sh.questions.length;
    }
  }
  assert.equal(totalQuestions, 12);
  assert.equal(totalQuestions, answerKey.totalQuestions);
});

test("MistakesStore tracks misses, preserves counts, and supports explicit resolution", () => {
  let store = MistakesStore.emptyStore();
  store = MistakesStore.recordAttempt(store, {
    internalId: "logic-number-systems::quiz::logic-fundamentals::DL_Q1_1",
    selectedOptionId: "B",
    correctOptionId: "A",
    isCorrect: false,
    questionText: "Hex conversion",
  });
  assert.equal(store.items.length, 1);
  assert.equal(store.items[0].failureCount, 1);
  assert.equal(store.items[0].status, "unresolved");

  store = MistakesStore.resolveMistake(store, "logic-number-systems::quiz::logic-fundamentals::DL_Q1_1");
  assert.equal(store.items[0].status, "resolved");
});

test("ImportPipeline parses JSON and text drafts safely without mutating source registry", () => {
  const registry = buildRegistry({ subjects: [] });
  const pipeline = ImportPipeline.createPipeline({ registry, now: "2026-11-13T00:00:00.000Z" });
  const draft = pipeline.parse({
    kind: "json",
    subjectId: "logic-number-systems",
    collectionId: "custom-practice",
    title: "Custom Practice",
    text: JSON.stringify([
      {
        id: "Q1",
        question: "What is 1 AND 1?",
        options: [{ id: "A", text: "0" }, { id: "B", text: "1" }],
        correctOptionId: "B",
        explanation: "AND returns 1 only when all inputs are 1.",
      },
    ]),
  });

  assert.equal(draft.questions.length, 1);
  assert.equal(draft.missingAnswers.length, 0);
});

test("ImportPipeline plaintext and JSON parsers preserve bilingual explanations, rules, and mistake notes", () => {
  const pipeline = ImportPipeline.createPipeline({ now: "2026-11-15T00:00:00.000Z" });
  const textDraft = pipeline.parse({
    kind: "text",
    subjectId: "operating-systems",
    collectionId: "os-quiz-1",
    title: "OS Scheduling",
    text: [
      "1. Which scheduling algorithm minimizes average waiting time for a known batch?",
      "A) FCFS",
      "B) SJF",
      "C) Round Robin",
      "D) Random",
      "Answer: B",
      "Explanation: Shortest Job First schedules the smallest burst first.",
      "Continuing the reasoning cleanly.",
      "Arabic Explanation: خوارزمية أقصر وظيفة أولاً تقلل متوسط وقت الانتظار.",
      "Rule: Optimal waiting time when burst times are known -> SJF.",
      "Why: Round Robin is fairer for interactive latency, not minimum waiting time.",
    ].join("\n"),
  });

  assert.equal(textDraft.questions.length, 1);
  const q1 = textDraft.questions[0];
  assert.equal(q1.correctOptionId, "B");
  assert.match(q1.explanation, /Shortest Job First/);
  assert.match(q1.explanation, /Continuing the reasoning/);
  assert.match(q1.explanationArabic, /أقصر وظيفة/);
  assert.match(q1.rule, /SJF/);
  assert.match(q1.whyYouMightErr, /Round Robin/);

  const jsonDraft = pipeline.parse({
    kind: "json",
    subjectId: "operating-systems",
    collectionId: "os-json",
    title: "OS JSON",
    text: JSON.stringify([
      {
        text: "Deadlock requires mutual exclusion?",
        options: ["True", "False"],
        correctAnswer: 0,
        academicExplanation: "One of the four Coffman conditions.",
        arabicExplanation: "أحد شروط كوفمان الأربعة.",
        keyRule: "Coffman: mutual exclusion, hold & wait, no preemption, circular wait.",
        commonMistake: "Confusing starvation with deadlock.",
      },
    ]),
  });

  assert.equal(jsonDraft.questions[0].question, "Deadlock requires mutual exclusion?");
  assert.equal(jsonDraft.questions[0].correctOptionId, "A");
  assert.equal(jsonDraft.questions[0].explanationArabic, "أحد شروط كوفمان الأربعة.");
  assert.match(jsonDraft.questions[0].rule, /Coffman/);
  assert.match(jsonDraft.questions[0].whyYouMightErr, /starvation/);
});
