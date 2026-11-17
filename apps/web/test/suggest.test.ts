// Word suggestions while writing: common words first, the reader's own words before those, de/het for nouns.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applySuggestion, buildSuggester, wordAtCaret } from "../src/lib/suggest.ts";

const ARTICLES: Record<string, "de" | "het"> = { boek: "het", boer: "de", boot: "de", boom: "de" };
const s = buildSuggester({
  lemmas: ["boek", "boer", "boot", "boom", "boekhandel", "lopen"],
  forms: { boeken: "boek", liep: "lopen", boten: "boot" },
  article: (w) => ARTICLES[w] ?? null,
});

test("the most common words that start with what was typed, three at most, from 2 letters", () => {
  assert.deepEqual(s.suggest("bo").map((x) => x.word), ["boek", "boeken", "boer"], "a form comes right after its base form");
  assert.deepEqual(s.suggest("b"), [], "one letter: nothing yet");
  assert.deepEqual(s.suggest("boe", 5).map((x) => x.word), ["boek", "boeken", "boer", "boekhandel"]);
});

test("nouns come with de or het; a typed capital is kept", () => {
  assert.deepEqual(s.suggest("boo")[0], { word: "boot", article: "de" });
  assert.equal(s.suggest("bo")[0].article, "het");
  assert.equal(s.suggest("Lo")[0].word, "Lopen");
  assert.equal(s.suggest("boeke")[0].article, null, "a plural form has no article");
});

test("words the reader has met come before more common ones", () => {
  const mine = buildSuggester({ lemmas: ["boek", "boer", "boot", "boom"], forms: {}, article: () => null, known: new Set(["boom"]) });
  assert.equal(mine.suggest("bo")[0].word, "boom");
});

test("the word at the caret is replaced by the suggestion, with a space after", () => {
  assert.deepEqual(wordAtCaret("Ik lees een bo", 14), { start: 12, word: "bo" });
  assert.deepEqual(applySuggestion("Ik lees een bo", 14, "boek"), { text: "Ik lees een boek ", caret: 17 });
  assert.deepEqual(applySuggestion("een bo. Mooi", 6, "boek"), { text: "een boek. Mooi", caret: 8 }, "no space before a full stop");
  assert.deepEqual(applySuggestion("een bo mooi", 6, "boek"), { text: "een boek mooi", caret: 8 });
});
