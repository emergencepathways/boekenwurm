// The diary: 20 prompts in random order, one entry a day, a weekly reminder, free writing after 20. Stated in numbers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { countWords, DIARY, DIARY_PROMPTS, freeWritingOpen, nextPrompt, saveEntry, weeklyDue, type DiaryRecord } from "../src/diary.ts";
import { ACHIEVEMENTS, tierReached } from "../src/achievements.ts";
import { emptyPlay, mergePlay, statsOf } from "../src/play.ts";

const none: DiaryRecord = { done: [], days: [] };
const all: DiaryRecord = { done: DIARY_PROMPTS.map((p) => p.id), days: ["2026-11-01"] };
const words = (n: number) => Array.from({ length: n }, () => "woord").join(" ");

test("20 prompts, each in Dutch and English, numbered 1 to 20", () => {
  assert.equal(DIARY_PROMPTS.length, 20);
  assert.deepEqual(DIARY_PROMPTS.map((p) => p.id), Array.from({ length: 20 }, (_, i) => i + 1));
  assert.ok(DIARY_PROMPTS.every((p) => p.nl && p.en));
  assert.equal(DIARY_PROMPTS[12].nl, "Wat doe je overdag?", "#13, the gentle version");
  assert.equal(DIARY_PROMPTS[14].nl, "Welke traditie vind je leuk?", "#15, the gentle version");
});

test("words are counted as a reader would: 'zo'n' and 'e-mail' are one word each", () => {
  assert.equal(countWords("Vandaag was zo'n mooie dag, ik las een e-mail. 3 keer!"), 11);
  assert.equal(countWords("   "), 0);
});

test("the next prompt is a random one not written yet; skipped ones wait unless nothing else is left", () => {
  const r: DiaryRecord = { done: [1, 2, 3], days: [] };
  assert.equal(nextPrompt(r, 0).id, 4, "random 0: the first open prompt");
  assert.equal(nextPrompt(r, 0.999).id, 20);
  assert.equal(nextPrompt(r, 0, [4, 5]).id, 6, "skipped prompts are left out");
  const almost: DiaryRecord = { done: DIARY_PROMPTS.map((p) => p.id).filter((id) => id !== 9), days: [] };
  assert.equal(nextPrompt(almost, 0.5, [9]).id, 9, "the only one left comes back even when skipped");
  assert.ok(DIARY_PROMPTS.some((p) => p.id === nextPrompt(all, 0.37).id), "after all 20, any prompt can come up again");
});

test("the week's first entry earns 600 XP, each further one that week 30; a prompt needs 25 words", () => {
  assert.deepEqual([DIARY.minWordsPrompt, DIARY.weekXp, DIARY.extraXp], [25, 600, 30]);
  assert.equal(saveEntry(none, { promptId: 4, words: 24, today: "2026-11-17" }).reason, "too-short");
  const first = saveEntry(none, { promptId: 4, words: 25, today: "2026-11-17" }); // Tuesday
  assert.deepEqual([first.counted, first.xp, first.firstThisWeek, first.record.done, first.record.days], [true, 600, true, [4], ["2026-11-17"]]);
  const sameDay = saveEntry(first.record, { promptId: 5, words: 30, today: "2026-11-17" });
  assert.deepEqual([sameDay.counted, sameDay.xp, sameDay.record.done], [true, 30, [4, 5]], "a second prompt the same day: 30 XP, and it counts towards the 20");
  const laterInWeek = saveEntry(sameDay.record, { promptId: 6, words: 30, today: "2026-11-22" }); // Sunday
  assert.equal(laterInWeek.xp, 30);
  assert.equal(saveEntry(laterInWeek.record, { promptId: 7, words: 30, today: "2026-11-23" }).xp, 600, "Monday: a new week");
});

test("writing the twentieth prompt adds 2,000 XP, once", () => {
  assert.equal(DIARY.allPromptsXp, 2000);
  const nineteen: DiaryRecord = { done: DIARY_PROMPTS.map((p) => p.id).filter((id) => id !== 20), days: ["2026-11-16"] };
  const last = saveEntry(nineteen, { promptId: 20, words: 30, today: "2026-11-17" });
  assert.deepEqual([last.allPrompts, last.xp, freeWritingOpen(last.record)], [true, 30 + 2000, true]);
  assert.equal(saveEntry(last.record, { promptId: 3, words: 50, today: "2026-11-24" }).xp, 600, "afterwards: no second bonus");
});

test("after all 20: free writing (40 words) and any prompt again, on the same weekly rewards", () => {
  assert.equal(freeWritingOpen(all), true);
  assert.equal(freeWritingOpen({ done: [1, 2], days: [] }), false);
  assert.equal(saveEntry({ done: [1], days: [] }, { promptId: null, words: 100, today: "2026-11-17" }).reason, "not-open", "no free writing before all 20");
  assert.equal(saveEntry(all, { promptId: null, words: 39, today: "2026-11-17" }).reason, "too-short");
  const free = saveEntry(all, { promptId: null, words: 40, today: "2026-11-17" });
  assert.equal(free.xp, 600, "the week's first");
  assert.equal(saveEntry(free.record, { promptId: 3, words: 40, today: "2026-11-17" }).xp, 30, "a prompt again, the same week");
});

test("the weekly reminder: due until an entry counts that week (Monday to Sunday), and never once free writing is open", () => {
  const r: DiaryRecord = { done: [1], days: ["2026-11-16"] }; // Monday
  assert.equal(weeklyDue(r, "2026-11-22"), false, "Sunday, same week");
  assert.equal(weeklyDue(r, "2026-11-23"), true, "the next Monday");
  assert.equal(weeklyDue(none, "2026-11-17"), true);
  assert.equal(weeklyDue(all, "2026-12-30"), false);
});

test("the Diary badge: Bronze 5, Silver 10, Gold 15, Platinum 20 prompts; kept across devices", () => {
  const a = ACHIEVEMENTS.find((x) => x.key === "diary")!;
  assert.deepEqual(a.targets, [5, 10, 15, 20]);
  const stats = (n: number) => statsOf({ ...emptyPlay(), diaryDone: Array.from({ length: n }, (_, i) => i + 1) }, { today: "2026-11-17", wordsLookedUp: 0, pagesWithNumbers: 0 });
  assert.deepEqual([4, 5, 10, 15, 20].map((n) => tierReached(a, stats(n))), [0, 1, 2, 3, 4]);
  const merged = mergePlay({ ...emptyPlay(), diaryDone: [1, 3], diaryDays: ["2026-11-16"] }, { ...emptyPlay(), diaryDone: [2, 3], diaryDays: ["2026-11-17"] });
  assert.deepEqual([merged.diaryDone, merged.diaryDays], [[1, 2, 3], ["2026-11-16", "2026-11-17"]]);
});
