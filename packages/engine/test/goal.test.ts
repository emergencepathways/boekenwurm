// The daily reading goal (src/goal.ts): pages counted like everywhere else, at or above the reader's level if asked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { goalDay, goalProgress, isAtOrAboveRank, pagesOf, type PageRead, type ReadingGoal } from "../src/goal.ts";

const r = (key: string, page: number | null, atLevel = true, countable = 100, book = key.split(":")[0]): PageRead => ({ key, book, page, countable, atLevel });

test("at or above the reader's rank", () => {
  assert.equal(isAtOrAboveRank("A2", "A2"), true);
  assert.equal(isAtOrAboveRank("B1", "A2"), true);
  assert.equal(isAtOrAboveRank("A1", "A2"), false);
  assert.equal(isAtOrAboveRank("A1", "A0"), true);
  assert.equal(isAtOrAboveRank(null, "A0"), false, "a book without a level never counts");
});

test("a printed page counts once per book; 250 words make a page in books without page numbers", () => {
  const reads = [r("a:0", 10), r("a:1", 10), r("a:2", 11), r("a:2", 11), r("b:0", 10),
    r("c:0", null, true, 300), r("c:1", null, true, 250), r("c:1", null, true, 250)];
  assert.equal(pagesOf(reads, false), 3 + 2, "pages 10 and 11 of a, page 10 of b, 550 words of c");
});

test("at level only: reading below the level (or without one) doesn't count", () => {
  const reads = [r("a:0", 10), r("a:1", 11), r("b:0", 4, false), r("b:1", 5, false)];
  assert.equal(pagesOf(reads, true), 2);
  assert.equal(pagesOf(reads, false), 4);
});

test("5 pages a day: reached at 5", () => {
  const goal: ReadingGoal = { pages: 5, atLevel: true, dayStartHour: 2 };
  const four = [1, 2, 3, 4].map((p) => r(`a:${p}`, p));
  assert.deepEqual(goalProgress(four, goal), { pages: 4, target: 5, reached: false });
  assert.deepEqual(goalProgress([...four, r("a:5", 5)], goal), { pages: 5, target: 5, reached: true });
  assert.equal(goalProgress(four, { ...goal, pages: 0 }), null, "no goal set");
});

test("the goal's day starts at its hour: 01:30 still belongs to yesterday with a 02:00 start", () => {
  const utc = (t: number) => new Date(t).toISOString().slice(0, 10);
  const at0130 = Date.UTC(2026, 10, 27, 1, 30);
  assert.equal(goalDay(at0130, { pages: 5, atLevel: true, dayStartHour: 2 }, utc), "2026-11-26");
  assert.equal(goalDay(at0130, { pages: 5, atLevel: true, dayStartHour: 0 }, utc), "2026-11-27");
});
