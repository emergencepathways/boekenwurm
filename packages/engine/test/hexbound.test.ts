// The Hex-bound Collector, the secret Mörk Borg mode (owner, 2026-11-21), stated in numbers. Text is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bookQualifies, isGameCode, pickTurn, turnAllowance, turnCandidates, turnKey, wordCount, type GameBook } from "../src/hexbound.ts";
import { passes } from "../src/checkpoint.ts";
import { HEXBOUND_RULES, SECRET_MORK_BORG } from "../src/hexbound.ts";
import { emptyPlay, mergePlay } from "../src/play.ts";

test("the code: any capitals, with or without the ö, extra spaces fine; nothing else", () => {
  for (const c of ["Mork Borg", "mork borg", "MORK BORG", "Mörk Borg", "MÖRK BORG", "  mörk   borg ", "Mörk-Borg"]) assert.ok(isGameCode(c), c);
  for (const c of ["Mork", "MorkBorg2", "BW-XXXX-XXXX", "mork borg!!x", ""]) assert.ok(!isGameCode(c), c);
});

test("fouten: 25% on turn 1, 3 points fewer each turn, passed or failed, down to 5%; minimum 3, 2, 1, never 0", () => {
  // 40 countable words: 10, 8, 7, 6, 5, 4, 2, 2 (5% of 40), …
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 20].map((t) => turnAllowance(40, t).allowed), [10, 8, 7, 6, 5, 4, 2, 2, 2]);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 20].map((t) => turnAllowance(40, t).percent), [25, 22, 19, 16, 13, 10, 7, 5, 5]);
  // 8 countable words: the strike minimum carries short paragraphs: 3, 2, 1, 1
  assert.deepEqual([0, 1, 2, 3, 9].map((t) => turnAllowance(8, t).allowed), [3, 2, 1, 1, 1]);
});

test("a turn is understood within its fouten (they are free); one more and the curse bites", () => {
  const a = turnAllowance(40, 0); // 10 fouten
  assert.equal(passes(10, a, HEXBOUND_RULES), true);
  assert.equal(passes(11, a, HEXBOUND_RULES), false);
  const late = turnAllowance(8, 9); // 1 fout
  assert.equal(passes(1, late, HEXBOUND_RULES), true);
  assert.equal(passes(2, late, HEXBOUND_RULES), false);
});

test("books: at least one level above the reader; from B2 the same level counts; no level, no book", () => {
  assert.equal(bookQualifies("B1", "A2"), true);
  assert.equal(bookQualifies("A2", "A2"), false);
  assert.equal(bookQualifies("A1", "A2"), false);
  assert.equal(bookQualifies("B2", "B1"), true);
  assert.equal(bookQualifies("B1", "B1"), false);
  assert.equal(bookQualifies("B2", "B2"), true);
  assert.equal(bookQualifies("C1", "B2"), true);
  assert.equal(bookQualifies("B1", "B2"), false);
  assert.equal(bookQualifies("C2", "C2"), true);
  assert.equal(bookQualifies(null, "A1"), false);
});

const long = (n: number) => Array.from({ length: n }, (_, i) => `woord${i}`).join(" ");
const book = (id: string, level: GameBook["level"], position: number, sizes: number[]): GameBook => ({ id, level, position, paragraphs: sizes.map((n) => ({ text: long(n) })) });

test("pages: unread (from the reader's place), not shown before in this game, and more than 20 words", () => {
  const books = [book("hoog", "B1", 2, [30, 30, 30, 20, 21, 50]), book("laag", "A2", 0, [40]), book("geen", null, 0, [40])];
  const all = turnCandidates(books, "A2", new Set());
  assert.deepEqual(all, [{ bookId: "hoog", ord: 2 }, { bookId: "hoog", ord: 4 }, { bookId: "hoog", ord: 5 }], "paragraphs 0–1 were read; 3 has 20 words; the A2 and unlevelled books don't count");
  assert.deepEqual(turnCandidates(books, "A2", new Set([turnKey("hoog", 4)])).map((c) => c.ord), [2, 5], "a page shown in this game isn't shown again");
  assert.deepEqual(turnCandidates(books, "B1", new Set()), [], "a B1 reader has no B2 book here");
  assert.equal(wordCount("Het is — echt 21 waar."), 4, "numbers and dashes aren't words");
});

test("a random page, chosen by the random number passed in", () => {
  const c = ["a", "b", "c", "d"];
  assert.equal(pickTurn(c, 0), "a");
  assert.equal(pickTurn(c, 0.5), "c");
  assert.equal(pickTurn(c, 0.9999), "d");
  assert.equal(pickTurn([], 0.3), null);
});

test("the secret badge syncs like the rest of the record, and is never lost", () => {
  const a = { ...emptyPlay(), secrets: [SECRET_MORK_BORG] };
  assert.deepEqual(mergePlay(a, emptyPlay()).secrets, [SECRET_MORK_BORG]);
  assert.deepEqual(mergePlay(emptyPlay(), emptyPlay()).secrets, []);
});
