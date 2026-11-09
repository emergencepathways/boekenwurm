// The import check and tap tokens, on synthetic text written for these tests (no book text).
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkBook, isOldForm, langOf, nameTest, sentenceAround, tokenize } from "../src/lib/text.ts";

const NL = [
  "Op zaterdag gaat Sanne met de fiets naar de markt in het centrum van de stad.",
  "Daar koopt zij verse groente, een stuk kaas en een grote zak appels voor de hele week.",
  "Meneer Jansen heeft al jaren een kraam en hij kent iedereen in de buurt bij naam.",
  "Hij vertelt dat de prijzen dit jaar flink gestegen zijn omdat de zomer te droog was.",
  "Op de terugweg begint het te regenen, dus zij wacht onder een brug tot het droog is.",
  "Thuis zet zij koffie en schrijft zij de nieuwe woorden van die ochtend in haar schrift.",
];

test("Dutch, English and mixed paragraphs are told apart", () => {
  assert.equal(langOf(NL[0]).lang, "nl");
  assert.equal(langOf("The weather was cold and the market was busy with people from the town.").lang, "en");
  assert.equal(langOf("Zij gaat naar de markt. She goes to the market and she buys the cheese there.").mixed, true);
});

test("modern Dutch is accepted, with its paragraphs", () => {
  const v = checkBook(NL);
  assert.equal(v.kind, "accept");
  assert.equal(v.paragraphs.length, 6);
  assert.equal(v.oldPer10k, 0);
});

test("fewer than 5 Dutch paragraphs of 8 words or more is not a usable book", () => {
  assert.equal(checkBook(NL.slice(0, 4)).kind, "reject_not_dutch");
  assert.equal(checkBook(["Hoofdstuk 1", "Kort.", ...NL.slice(0, 4)]).kind, "reject_not_dutch");
});

test("pre-1955 spelling above 15 per 10,000 words is rejected", () => {
  const old = NL.map((p) => p.replace("de stad", "de groote stad").replace("zij", "zij met de menschen"));
  const v = checkBook(old);
  assert.equal(v.kind, "reject_old_spelling");
  assert.ok(v.oldPer10k > 15);
  assert.ok(isOldForm("menschen") && isOldForm("tusschen") && !isOldForm("mensen") && !isOldForm("logisch"));
});

test("a learner book under 60% Dutch is accepted in part", () => {
  const en = Array.from({ length: 6 }, (_, i) => `This is an English explanation number ${i + 1} of the grammar that was in the text above.`);
  const v = checkBook([...NL, ...en]);
  assert.equal(v.kind, "accept_partial");
  assert.equal(v.paragraphs.length, 6);
});

test("names are capitalised mid-sentence and never lowercase elsewhere; numbers and names don't count", () => {
  const paras = ["Gisteren zag Sanne haar vriendin in de bibliotheek.", "Bank is een woord, maar een bank staat ook in de kamer."];
  const isName = nameTest(paras);
  const t = tokenize(paras[0] + " Om 10.30 uur.", isName);
  assert.deepEqual(t.filter((x) => x.k === "name").map((x) => x.t), ["Sanne"]);
  assert.deepEqual(t.filter((x) => x.k === "number").map((x) => x.t), ["10.30"]);
  // "Bank" starts a sentence and "bank" appears in lowercase, so it is a word.
  assert.equal(tokenize(paras[1], isName)[0].k, "word");
  // Offsets point back into the text.
  for (const x of t) assert.equal((paras[0] + " Om 10.30 uur.").slice(x.s, x.e), x.t);
});

test("the sentence a word was read in", () => {
  assert.equal(sentenceAround("Het regent. Zij wacht onder een brug. Dan gaat zij naar huis.", "brug"), "Zij wacht onder een brug.");
});
