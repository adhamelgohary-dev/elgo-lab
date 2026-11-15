"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { curated, present } = require("../src/core/explanation-presenter");
const question = { question: "What is the 2's complement of 00001111?", correctOptionId: "B", options: [{id:"A",text:"11110000"},{id:"B",text:"11110001"}] };
test("teaches the actual fixed-width calculation and only explains mistakes after a wrong choice", () => {
  assert.match(curated(question).explanation, /11110001/);
  assert.match(present(question, {}, { selectedOptId:"A",isRight:false }).mistake, /1’s complement/);
  assert.equal(present(question, {}, { selectedOptId:"B",isRight:true }).mistake, "");
  assert.equal(present(question, {}, {}).mistake, "");
});
test("does not silently contradict an answer key or a negative question", () => {
  assert.equal(curated({...question, correctOptionId:"A"}), null);
  assert.equal(curated({...question, question:"Which is NOT a two's complement of 00001111?"}), null);
});
test("Pandas summary does not display a subject-wide ML rule", () => {
  const q = {question:"To get summary of each numerical attribute in dataset, we use method",correctOptionId:"A",options:[{id:"A",text:".describe()"}]};
  const value = present(q, {rule:"الهدف في ML هو التعميم على بيانات جديدة",whyYouMightErr:"خلط دقة التدريب مع التعميم"}, {selectedOptId:"A",isRight:true});
  assert.match(value.explanation, /إحصائي/); assert.equal(value.rule,"df.describe()");
  assert.doesNotMatch(value.explanation,/التعميم/);
});
test("unknown topics keep their specific explanation but never invent a rule or repeat boilerplate", () => {
  const result = present({question:"Unknown"}, {academicExplanation:"شرح محدد للمفهوم",correctReasoning:"يطابق القاعدة العلمية أو النتيجة الحسابية",rule:"قانون للمادة كلها"}, {});
  assert.equal(result.explanation,"شرح محدد للمفهوم");assert.equal(result.rule,"");
});
test("RMSE and MAE are defined separately with a worked example and correct normalization", () => {
  const q={question:"Both the ........ and the........are ways to measure the distance between two vectors",correctOptionId:"A",options:[{id:"A",text:"RMSE, MAE"},{id:"B",text:"RMSE, ESMR"}]};
  const value=curated(q);
  assert.match(value.explanation, /Root Mean Squared Error<\/strong><br>/);
  assert.match(value.explanation, /Mean Absolute Error<\/strong><br>/);
  assert.match(value.explanation, /2\.24/);
  assert.match(value.explanation, /L1\/n/);
  assert.match(value.explanation, /L2\/√n/);
  assert.match(value.rule, /<sup>2<\/sup>/);
  assert.equal(curated({...q,correctOptionId:"B"}),null);
  assert.equal(curated({...q,question:"Which is incorrect about RMSE and MAE distance measures?"}),null);
});
