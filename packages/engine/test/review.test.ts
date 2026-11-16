// Flashcards: Hard / Medium / Easy / Skip, a review pool, sets repeated until every card is Easy. Stated in numbers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { answer, clampSetSize, EASY_GAPS_DAYS, inPool, newReviewCard, requeue, reviewOrder, reviewSet, SET_SIZE, unskip, type ReviewCard } from "../src/review.ts";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 14, 12);
const card = (lemma: string, o: Partial<ReviewCard> = {}): ReviewCard => ({ ...newReviewCard(lemma, NOW - DAY), ...o });

test("a new word waits in the pool as Medium until it is rated", () => {
  const c = newReviewCard("lopen", NOW);
  assert.equal(c.pool, "medium");
  assert.equal(inPool(c, NOW), true);
});

test("Hard and Medium keep a card in the pool; Hard comes first", () => {
  const cards = [card("c", { pool: "medium", due: NOW - 3 * DAY }), card("a", { pool: "hard", due: NOW - DAY }), card("b", { pool: "hard", due: NOW - 2 * DAY })];
  assert.deepEqual(reviewOrder(cards, NOW).map((c) => c.lemma), ["b", "a", "c"], "Hard first, oldest first, then Medium");
});

test("Easy takes it out; it comes back for a check after 3 days, then 1 week, 3 weeks, and every 2 months", () => {
  assert.deepEqual(EASY_GAPS_DAYS, [3, 7, 21, 60]);
  let c = answer(card("huis", { pool: "hard" }), "easy", NOW);
  assert.equal(c.pool, "easy");
  assert.equal(c.due, NOW + 3 * DAY);
  assert.equal(inPool(c, NOW + 2 * DAY), false);
  assert.equal(inPool(c, NOW + 3 * DAY), true, "the check-back is due");
  const gaps = [];
  for (let i = 0; i < 5; i++) {
    const at = c.due;
    c = answer(c, "easy", at);
    gaps.push((c.due - at) / DAY);
  }
  assert.deepEqual(gaps, [7, 21, 60, 60, 60]);
});

test("forgetting an Easy word at its check-back puts it back in the pool, and the gaps start over", () => {
  const easy = card("boom", { pool: "easy", easyStep: 2, due: NOW });
  const hard = answer(easy, "hard", NOW);
  assert.equal(hard.pool, "hard");
  assert.equal(hard.lapses, 1);
  assert.equal(answer(hard, "easy", NOW).due, NOW + 3 * DAY);
});

test("Easy check-backs come after the hard and medium cards", () => {
  const cards = [card("e", { pool: "easy", due: NOW - 10 * DAY }), card("m", { pool: "medium" }), card("h", { pool: "hard" })];
  assert.deepEqual(reviewOrder(cards, NOW).map((c) => c.lemma), ["h", "m", "e"]);
});

test("Skip drops a word from every review until it is brought back", () => {
  const s = answer(card("draak", { pool: "hard" }), "skip", NOW);
  assert.equal(s.pool, "skipped");
  assert.equal(inPool(s, NOW + 999 * DAY), false);
  assert.equal(unskip(s, NOW).pool, "medium");
});

test("sets: 30 cards by default, the reader picks 20 to 50", () => {
  assert.deepEqual(SET_SIZE, { min: 20, max: 50, default: 30 });
  assert.deepEqual([clampSetSize(undefined), clampSetSize(10), clampSetSize(35), clampSetSize(80)], [30, 20, 35, 50]);
  const pool = Array.from({ length: 70 }, (_, i) => card(`w${String(i).padStart(2, "0")}`, { pool: i < 10 ? "hard" : "medium", due: NOW - i }));
  const set = reviewSet(pool, NOW, 30);
  assert.equal(set.length, 30);
  assert.ok(set.slice(0, 10).every((c) => c.pool === "hard"), "the 10 hard cards lead the set");
});

test("in a set, Hard comes round again after 3 cards, Medium after 6; Easy and Skip leave the set", () => {
  const q = ["a", "b", "c", "d", "e", "f", "g", "h"];
  assert.deepEqual(requeue(q, "hard"), ["b", "c", "d", "a", "e", "f", "g", "h"]);
  assert.deepEqual(requeue(q, "medium"), ["b", "c", "d", "e", "f", "g", "a", "h"]);
  assert.deepEqual(requeue(q, "easy"), ["b", "c", "d", "e", "f", "g", "h"]);
  assert.deepEqual(requeue(["a", "b"], "medium"), ["b", "a"], "fewer left: last");
  assert.deepEqual(requeue(["a"], "hard"), ["a"], "the last card repeats until it is Easy");
});

test("a set ends only when every card has been rated Easy", () => {
  let q = ["a", "b", "c"];
  const answers: Record<string, string[]> = { a: ["hard", "medium", "easy"], b: ["easy"], c: ["medium", "easy"] };
  let turns = 0;
  while (q.length && turns < 20) {
    const a = answers[q[0]].shift() as "hard" | "medium" | "easy";
    q = requeue(q, a);
    turns++;
  }
  assert.equal(q.length, 0);
  assert.equal(turns, 6);
});

// ---------------------------------------------------------------- the day's reviews
import { dueToday, NEW_PER_DAY, planSet, REVIEW_DAY, waitingAfterToday } from "../src/review.ts";

const many = (prefix: string, n: number, o: Partial<ReviewCard> = {}) =>
  Array.from({ length: n }, (_, i) => card(`${prefix}${String(i).padStart(3, "0")}`, { pool: "medium", due: NOW - DAY - i, ...o }));
const day = { now: NOW, reviewedToday: 0, newToday: 0 };

test("at most 90 cards are due in a day; the rest wait in the pool", () => {
  assert.deepEqual(REVIEW_DAY, { maxDue: 90, newPer30: 5, listShare: 0.4, recentListShare: 0.8, recentDays: 2 });
  const cards = many("w", 200);
  assert.equal(dueToday({ ...day, cards }), 90);
  assert.equal(waitingAfterToday({ ...day, cards }), 110);
  assert.equal(dueToday({ ...day, cards, reviewedToday: 60 }), 30, "60 reviewed today: 30 left");
  assert.equal(dueToday({ ...day, cards, reviewedToday: 90 }), 0);
  assert.equal(planSet({ ...day, cards, reviewedToday: 80 }, 30).lemmas.length, 10, "the last set is what's left of the 90");
  assert.equal(dueToday({ ...day, cards: many("w", 12) }), 12, "fewer in the pool: all of them");
});

test("every set of 30 brings in 5 new common words, at most 15 a day", () => {
  assert.equal(NEW_PER_DAY, 15);
  const newWords = Array.from({ length: 40 }, (_, i) => `nieuw${i}`);
  const plan = planSet({ ...day, cards: many("w", 100), newWords }, 30);
  assert.equal(plan.lemmas.length, 30);
  assert.deepEqual(plan.fresh, ["nieuw0", "nieuw1", "nieuw2", "nieuw3", "nieuw4"], "most common first");
  assert.equal(planSet({ ...day, cards: many("w", 100), newWords }, 50).fresh.length, 8, "a set of 50: 8 (5 per 30, rounded)");
  assert.equal(planSet({ ...day, cards: many("w", 100), newWords, newToday: 13 }, 30).fresh.length, 2, "13 brought in today: 2 left");
  assert.equal(dueToday({ ...day, cards: many("w", 20), newWords }), 35, "20 in the pool + 15 new");
});

test("the reader's flagged list words take up to 40% of a set; tapped in the last 2 days, up to 80%", () => {
  const onList = (l: string) => l.startsWith("L");
  const cards = [...many("w", 60), ...many("L", 40, { due: NOW })];
  const listIn = (p: { lemmas: string[] }) => p.lemmas.filter(onList).length;
  assert.equal(listIn(planSet({ ...day, cards, onList }, 30)), 12, "40% of 30");
  const recent = (l: string) => l >= "L000" && l < "L020";
  const plan = planSet({ ...day, cards, onList, tappedRecently: recent }, 30);
  assert.equal(listIn(plan), 20, "all 20 tapped lately (more than 40%), no others");
  assert.equal(listIn(planSet({ ...day, cards, onList, tappedRecently: () => true }, 30)), 24, "never more than 80% of 30");
  assert.ok(plan.lemmas.slice(0, 20).every(recent), "the recently tapped ones come first");
  const withNew = planSet({ ...day, cards, onList, tappedRecently: () => true, newWords: ["a", "b", "c", "d", "e", "f"] }, 30);
  assert.deepEqual([listIn(withNew), withNew.fresh.length, withNew.lemmas.length], [24, 5, 30], "24 list words, 5 new, 1 from the pool");
});

test("not enough flagged list words: the pool fills the set", () => {
  const onList = (l: string) => l.startsWith("L");
  const cards = [...many("w", 60), ...many("L", 3, { pool: "hard" }), card("Leasy", { pool: "easy", due: NOW - DAY })];
  const plan = planSet({ ...day, cards, onList }, 30);
  assert.deepEqual(plan.lemmas.slice(0, 3).sort(), ["L000", "L001", "L002"], "the 3 flagged list words lead");
  assert.equal(plan.lemmas.length, 30);
  assert.equal(new Set(plan.lemmas).size, 30, "no card twice");
});
