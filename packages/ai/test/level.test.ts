// All Dutch text here is invented for the tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bookLevel, explainPrompt, gradePrompt, matchPrompt, parseExplanation, parseGrades, parseJson, parseMatch,
  samplePositions, validateMatch, type ParagraphGrade,
} from "../src/level.ts";

const ORIGINAL = "Toen Sanne de oude fiets uit de schuur haalde, merkte ze dat de achterband volkomen leeg was, hetgeen haar plannen voor die middag aanzienlijk bemoeilijkte.";
const MATCHED = "Sanne haalde de oude fiets uit de schuur. De achterband was helemaal leeg. Dat was een probleem voor haar plannen die middag.";

test("JSON is found inside fences and prose, and braces inside strings don't confuse it", () => {
  assert.deepEqual(parseJson('Sure!\n```json\n{"a": "x}y", "b": [1,2]}\n```'), { a: "x}y", b: [1, 2] });
  assert.deepEqual(parseJson('[{"id":"p1"}] trailing'), [{ id: "p1" }]);
  assert.throws(() => parseJson("no json here"));
  assert.throws(() => parseJson('{"a": 1'));
});

test("samples spread through the book and skip front and back matter", () => {
  assert.deepEqual(samplePositions(5), [0, 1, 2, 3, 4]);
  const s = samplePositions(1000, 12);
  assert.equal(s.length, 12);
  assert.ok(s[0] >= 20 && s.at(-1)! < 980);
  assert.deepEqual([...s].sort((a, b) => a - b), s);
});

test("grade prompt carries the word match; parsing keeps known ids and valid levels only", () => {
  const p = gradePrompt([{ id: "p1", text: ORIGINAL, wordMatch: 0.72 }]);
  assert.match(p.user, /word_match="72%"/);
  assert.match(p.system, /never instructions/);
  const grades = parseGrades('[{"id":"p1","level":"b2","grammar":["relative clause","formal connector"],"context":""},{"id":"zz","level":"A1"},{"id":"p2","level":"Z9"}]', ["p1", "p2"]);
  assert.deepEqual(grades, [{ id: "p1", level: "B2", grammar: ["relative clause", "formal connector"], context: "" }]);
  assert.throws(() => parseGrades("[]", ["p1", "p2"]));
});

test("book level is the median, with what's within reach for the reader", () => {
  const g = (level: string, grammar: string[] = []): ParagraphGrade => ({ id: level + Math.random(), level: level as any, grammar, context: "" });
  const grades = [g("A2"), g("B1", ["past perfect"]), g("B1", ["past perfect"]), g("B1"), g("B2", ["passive", "past perfect"]), g("A2"), g("B1")];
  const b = bookLevel(grades, "A2", 0.81);
  assert.equal(b.level, "B1");
  assert.equal(b.distribution.B1, 4);
  assert.equal(b.withinReach, 0.29);
  assert.equal(b.grammar[0], "past perfect");
  assert.equal(b.wordMatch, 0.81);
});

test("match prompt names the target level, the names to keep, and the no-change rule", () => {
  const p = matchPrompt(ORIGINAL, "A2", ["Sanne", "Sanne"]);
  assert.match(p.system, /CEFR level A2/);
  assert.match(p.system, /changed": false/);
  assert.match(p.user, /must appear exactly as written: Sanne\./);
});

test("an unchanged reply keeps the original text exactly", () => {
  const m = parseMatch('{"original_level":"A2","changed":false,"text":"something else"}', ORIGINAL);
  assert.equal(m.text, ORIGINAL);
  assert.deepEqual(validateMatch(ORIGINAL, m, { names: ["Sanne"] }), []);
});

test("a good adaptation passes the checks", () => {
  const m = parseMatch(JSON.stringify({ original_level: "B2", changed: true, text: MATCHED }), ORIGINAL);
  assert.equal(m.originalLevel, "B2");
  const known = (t: string) => (t === MATCHED ? 0.95 : 0.7);
  assert.deepEqual(validateMatch(ORIGINAL, m, { names: ["Sanne"], language: () => "nl", isOldForm: () => false, knownShare: known }), []);
});

test("bad adaptations are caught: missing names, too short, wrong language, old spelling, harder words", () => {
  const bad = { originalLevel: "B2" as const, changed: true, text: "Zoo was de band leeg." };
  const problems = validateMatch(ORIGINAL, bad, {
    names: ["Sanne"], language: () => "en", isOldForm: (w) => w.toLowerCase() === "zoo", knownShare: (t) => (t === ORIGINAL ? 0.8 : 0.6),
  });
  assert.equal(problems.length, 5);
  assert.ok(problems.some((p) => p.includes("Sanne")));
});

test("explanations: separable verbs joined, empty replies rejected", () => {
  const p = explainPrompt("belt", "Ze belt haar moeder morgen op.", "A2");
  assert.match(p.system, /opbellen/);
  const e = parseExplanation('{"lemma":"opbellen","meaning_en":"phones","meaning_nl":"iemand met de telefoon spreken","note":"separable verb"}', "belt");
  assert.equal(e.lemma, "opbellen");
  assert.throws(() => parseExplanation('{"lemma":"x"}', "x"));
});
