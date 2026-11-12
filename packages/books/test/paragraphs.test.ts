// Paragraphs under 7 words are joined with the next one. Text is invented for the tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { joinShortBlocks, joinShortParagraphs, joinText, MIN_PARAGRAPH_WORDS, wordCount } from "../src/paragraphs.ts";

const join = (xs: string[]) => joinShortParagraphs(xs, (s) => s, joinText);

test("words are counted without numbers or punctuation", () => {
  assert.equal(MIN_PARAGRAPH_WORDS, 7);
  assert.equal(wordCount("Hoofdstuk 3"), 1);
  assert.equal(wordCount("Zo'n e-mail, 12 keer: één!"), 4);
  assert.equal(wordCount("— 14 —"), 0);
});

test("a paragraph of 6 words is joined with the next; one of 7 stays on its own", () => {
  const six = "De kat zat op de mat.";
  const seven = "De kat zat op de oude mat.";
  const next = "Toen kwam de hond binnen en begon hard te blaffen.";
  assert.deepEqual(join([six, next]), [`${six} ${next}`]);
  assert.deepEqual(join([seven, next]), [seven, next]);
});

test("a heading goes with the paragraph after it", () => {
  assert.deepEqual(join(["Hoofdstuk 3", "Het was nog vroeg toen Lotte haar fiets uit de schuur haalde."]), [
    "Hoofdstuk 3 Het was nog vroeg toen Lotte haar fiets uit de schuur haalde.",
  ]);
});

test("pieces keep joining until the block has 7 words", () => {
  assert.deepEqual(join(["Het was", "nog vroeg", "toen Lotte", "opstond.", "Daarna fietste ze snel naar het station toe."]), [
    "Het was nog vroeg toen Lotte opstond.",
    "Daarna fietste ze snel naar het station toe.",
  ]);
});

test("short text at the very end goes with the paragraph before it", () => {
  const long = "Ze at aan het raam en keek naar de boten.";
  assert.deepEqual(join([long, "Einde."]), [`${long} Einde.`]);
  assert.deepEqual(join(["Einde."]), ["Einde."], "a book of one short paragraph keeps it");
  assert.deepEqual(join([]), []);
});

test("objects: the caller decides what joining keeps (here: the first page number)", () => {
  type P = { text: string; pageNumber: number | null };
  const out = joinShortParagraphs<P>(
    [{ text: "Hoofdstuk 4", pageNumber: 20 }, { text: "Het regende de hele dag in de stad.", pageNumber: 21 }],
    (p) => p.text,
    (a, b) => ({ text: joinText(a.text, b.text), pageNumber: a.pageNumber ?? b.pageNumber }),
  );
  assert.deepEqual(out, [{ text: "Hoofdstuk 4 Het regende de hele dag in de stad.", pageNumber: 20 }]);
});

test("a joined block belongs to the page most of its words are on", () => {
  const out = joinShortBlocks([
    { text: "Het was nog vroeg toen Lotte haar fiets pakte.", pageNumber: 12 },
    { text: "12:", pageNumber: 12 }, // a misread page number at the foot of page 12
    { text: "Na de vergadering at ze een broodje kaas in de kantine.", pageNumber: 13 },
    { text: "Hoofdstuk 4", pageNumber: 14 },
    { text: "Het regende de hele dag in de stad.", pageNumber: 14 },
  ]);
  assert.deepEqual(out.map((p) => p.pageNumber), [12, 13, 14], "page 13 keeps its paragraph");
  assert.equal(out[1].text, "12: Na de vergadering at ze een broodje kaas in de kantine.");
});
