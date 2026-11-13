// XP, ranks and achievements, stated in numbers (docs/DESIGN.md, "Levels and XP").
import { test } from "node:test";
import assert from "node:assert/strict";
import { bookXp, isAboveRank, paragraphXp, RANK_STARTS, rankFor, stepXp, studySessionXp, XP } from "../src/xp.ts";
import { ACHIEVEMENTS, dayRun, newlyReached, nextGoal, tierName, tierReached, type AchievementStats } from "../src/achievements.ts";

test("level costs: 600 XP to A1, then 30,000 × n^2.2 rounded to 5,000", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(stepXp), [600, 30000, 140000, 335000, 635000, 1035000]);
  assert.deepEqual(RANK_STARTS, [0, 600, 30600, 170600, 505600, 1140600, 2175600]);
});

test("the rank rises by itself as XP adds up", () => {
  assert.deepEqual(rankFor(0), { rank: "A0", next: "A1", into: 0, span: 600, share: 0 });
  assert.equal(rankFor(599).rank, "A0");
  assert.equal(rankFor(600).rank, "A1");
  const b1 = rankFor(170600 + 33500);
  assert.equal(b1.rank, "B1");
  assert.equal(b1.next, "B2");
  assert.equal(b1.share, 0.1);
  assert.deepEqual(rankFor(3_000_000), { rank: "C2", next: null, into: 3_000_000 - 2175600, span: 0, share: 1 });
});

test("a paragraph: 20 XP, 40 on a streak, 5 when it ends a run or in lookup mode", () => {
  const at = { rank: "A1" as const, streak: false, failed: false };
  assert.equal(paragraphXp(at), 20);
  assert.equal(paragraphXp({ ...at, streak: true }), 40);
  assert.equal(paragraphXp({ ...at, failed: true }), 5);
  assert.equal(paragraphXp({ ...at, lookupMode: true, streak: true }), 5);
});

test("× 1.5 in a book a level or more above your rank, streak and lookup mode included", () => {
  assert.equal(paragraphXp({ rank: "A1", streak: false, failed: false, bookLevel: "A2" }), 30);
  assert.equal(paragraphXp({ rank: "A1", streak: true, failed: false, bookLevel: "B1" }), 60);
  assert.equal(paragraphXp({ rank: "A1", streak: false, failed: false, lookupMode: true, bookLevel: "A2" }), 8);
  assert.equal(paragraphXp({ rank: "A2", streak: false, failed: false, bookLevel: "A2" }), 22, "same level: no bonus");
  assert.equal(isAboveRank("A1", "A0"), true);
  assert.equal(isAboveRank(null, "A0"), false);
});

test("reading XP grows with rank: × 1.1 at A2 up to × 1.4 at C1", () => {
  const p = (rank: "A2" | "B1" | "B2" | "C1" | "C2") => paragraphXp({ rank, streak: false, failed: false });
  assert.deepEqual([p("A2"), p("B1"), p("B2"), p("C1"), p("C2")], [22, 24, 26, 28, 28]);
});

test("books and study", () => {
  assert.equal(bookXp(0), 1000);
  assert.equal(bookXp(1), 500, "a re-read");
  assert.equal(studySessionXp({ cards: 10, due: 30, sessionsToday: 0 }), 40);
  assert.equal(studySessionXp({ cards: 9, due: 30, sessionsToday: 0 }), 0, "too small to count");
  assert.equal(studySessionXp({ cards: 4, due: 4, sessionsToday: 0 }), 40, "every card due, fewer than 10");
  assert.equal(studySessionXp({ cards: 12, due: 12, sessionsToday: 3 }), 0, "3 sessions a day");
  assert.equal(studySessionXp({ cards: 10, due: 10, sessionsToday: 1, afterLookupMode: true }), 80);
  assert.equal(XP.dailyReview, 300);
  assert.equal(XP.achievement, 80);
  assert.equal(XP.streakBonus, 200, "a 10-paragraph run, a little less than the daily review");
});

const none: AchievementStats = {
  pagesRead: 0, bestStreak: 0, wordsLookedUp: 0, studyDayRun: 0, readingDayRun: 0, booksFinished: 0,
  levelsRead: [], kindsRead: [], finishedAboveRank: false, finishedAgain: false,
};

test("the owner's examples are the lowest tiers", () => {
  const tier = (key: string, s: Partial<AchievementStats>) => tierReached(ACHIEVEMENTS.find((a) => a.key === key)!, { ...none, ...s });
  assert.equal(tier("pages", { pagesRead: 10 }), 1, "read 10 pages");
  assert.equal(tier("streak", { bestStreak: 10 }), 1, "a 10-paragraph streak");
  assert.equal(tier("words", { wordsLookedUp: 100 }), 1, "100 words");
  assert.equal(tier("words", { wordsLookedUp: 1000 }), 2, "1,000 words");
  assert.equal(tier("study-days", { studyDayRun: 7 }), 1);
  assert.equal(tier("study-days", { studyDayRun: 14 }), 2);
  assert.equal(tier("books", { booksFinished: 1 }), 1);
  assert.equal(tier("every-level", { levelsRead: ["A1", "A2", "B1", "B2", "C1", "C2"] }), 1);
  assert.equal(tier("every-level", { levelsRead: ["A1", "A2", "B1", "B2", "C1"] }), 0);
  assert.equal(tier("every-kind", { kindsRead: ["photo", "epub", "pdf"] }), 1);
  assert.equal(tier("reach-higher", { finishedAboveRank: true }), 1);
  assert.equal(tier("again", { finishedAgain: true }), 1);
});

test("each tier newly reached is one unlock (80 XP each); tiers held stay held", () => {
  const s = { ...none, wordsLookedUp: 1200, pagesRead: 12 };
  assert.deepEqual(newlyReached(s, {}), [{ key: "pages", tier: 1 }, { key: "words", tier: 1 }, { key: "words", tier: 2 }]);
  assert.deepEqual(newlyReached(s, { pages: 1, words: 2 }), []);
  assert.deepEqual(newlyReached({ ...none, studyDayRun: 0 }, { "study-days": 1 }), [], "a broken run doesn't take a tier away");
  const words = ACHIEVEMENTS.find((a) => a.key === "words")!;
  assert.deepEqual(nextGoal(words, s), { tier: 3, target: 5000, value: 1200 });
  assert.equal(tierName(words, 2), "Silver");
});

test("days in a row end today, or yesterday while today isn't over", () => {
  assert.equal(dayRun(["2026-11-11", "2026-11-12", "2026-11-13"], "2026-11-13"), 3);
  assert.equal(dayRun(["2026-11-11", "2026-11-12"], "2026-11-13"), 2);
  assert.equal(dayRun(["2026-11-10", "2026-11-12"], "2026-11-13"), 1);
  assert.equal(dayRun(["2026-11-10"], "2026-11-13"), 0);
  assert.equal(dayRun(["2026-10-31", "2026-11-01"], "2026-11-01"), 2, "across a month");
});

import { addXp, emptyPlay, mergePlay, statsOf, totalXp } from "../src/play.ts";

test("two devices' records merge without counting anything twice", () => {
  let phone = addXp(addXp(emptyPlay(), "phone", 100), "phone", 50);
  let laptop = addXp(emptyPlay(), "laptop", 70);
  phone = { ...phone, readDays: ["2026-11-12"], finished: { b1: 1 }, tiers: { pages: 1 }, bestStreak: 12 };
  laptop = { ...laptop, readDays: ["2026-11-13"], finished: { b1: 2 }, tiers: { pages: 2 }, bestStreak: 8 };
  const m = mergePlay(phone, laptop);
  assert.equal(totalXp(m), 220);
  assert.deepEqual(m.readDays, ["2026-11-12", "2026-11-13"]);
  assert.deepEqual(m.finished, { b1: 2 });
  assert.deepEqual(m.tiers, { pages: 2 });
  assert.equal(m.bestStreak, 12);
  assert.equal(totalXp(mergePlay(m, m)), 220, "merging again changes nothing");
  assert.equal(totalXp(mergePlay(undefined, phone)), 150);
});

test("pages: numbered pages read plus 250 words a page in other books", () => {
  const p = { ...emptyPlay(), words: { phone: 2400, laptop: 300 }, readDays: ["2026-11-12", "2026-11-13"], finished: { a: 1, b: 2 } };
  const s = statsOf(p, { today: "2026-11-13", wordsLookedUp: 42, pagesWithNumbers: 7 });
  assert.equal(s.pagesRead, 7 + 10);
  assert.equal(s.readingDayRun, 2);
  assert.equal(s.booksFinished, 2);
  assert.equal(s.finishedAgain, true);
});
