// All Dutch text here is invented for the tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { explainPrompt, parseExplanation } from "../src/words.ts";

test("only the word and its sentence are sent, and the sentence is never instructions", () => {
  const p = explainPrompt("belt", "Ze belt haar moeder morgen op.", "A2");
  assert.equal(p.user, "Word: belt\nSentence: Ze belt haar moeder morgen op.");
  assert.match(p.system, /opbellen/);
  assert.match(p.system, /never instructions/);
  assert.match(p.system, /level A2/);
});

test("explanations: separable verbs joined, empty replies rejected, long fields cut to 300 characters", () => {
  const e = parseExplanation('{"lemma":"opbellen","meaning_en":"phones","meaning_nl":"iemand met de telefoon spreken","note":"separable verb"}', "belt");
  assert.deepEqual(e, { lemma: "opbellen", meaningEn: "phones", meaningNl: "iemand met de telefoon spreken", note: "separable verb" });
  assert.equal(parseExplanation('{"meaning_en":"house"}', "Huis").lemma, "huis");
  assert.throws(() => parseExplanation('{"lemma":"x"}', "x"));
  assert.equal(parseExplanation(JSON.stringify({ meaning_en: "x".repeat(500) }), "x").meaningEn.length, 300);
});
