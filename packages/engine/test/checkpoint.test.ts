import { test } from "node:test";
import assert from "node:assert/strict";
import { allowanceFor, inStreak, passes, rulesFor, PRESET_PERCENT, DEFAULT_RULES } from "../src/checkpoint.ts";

const standard = rulesFor("standard");

test("presets are 10 / 25 / 35 percent", () => {
  assert.deepEqual(PRESET_PERCENT, { strict: 10, standard: 25, relaxed: 35 });
});

test("standard: percentages per paragraph match the agreed table", () => {
  // passesInARow before each paragraph: p1=0, p2=1, p3=2 (streak starts), ...
  const expected = [25, 25, 22, 19, 16, 13, 10, 7, 5, 5, 5];
  const got = expected.map((_, i) => allowanceFor(200, i, standard).percent);
  assert.deepEqual(got, expected);
});

test("strict reaches the 5% floor on paragraph 4", () => {
  const strict = rulesFor("strict");
  assert.deepEqual([0, 1, 2, 3, 4].map((p) => allowanceFor(200, p, strict).percent), [10, 10, 7, 5, 5]);
});

test("relaxed reaches the 5% floor on paragraph 12", () => {
  const relaxed = rulesFor("relaxed");
  assert.equal(allowanceFor(200, 10, relaxed).percent, 8); // paragraph 11: 35 - 3*9
  assert.equal(allowanceFor(200, 11, relaxed).percent, 5); // paragraph 12: floor
});

test("streak shows from 2 passes in a row", () => {
  assert.equal(inStreak(1, standard), false);
  assert.equal(inStreak(2, standard), true);
});

test("long paragraphs: the percentage sets the allowance", () => {
  const a = allowanceFor(80, 0, standard); // 25% of 80
  assert.equal(a.allowed, 20);
  assert.equal(a.source, "percent");
});

test("short paragraphs: never fewer than 3 strikes to start", () => {
  const a = allowanceFor(8, 0, standard); // 25% of 8 = 2 -> 3 strikes
  assert.equal(a.byPercent, 2);
  assert.equal(a.allowed, 3);
  assert.equal(a.source, "strikes");
  assert.equal(allowanceFor(0, 0, standard).allowed, 3);
});

test("short paragraphs on a streak: 3 -> 2 -> 1 strike, never below 1", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 9].map((p) => allowanceFor(6, p, standard).allowed), [3, 3, 2, 1, 1, 1]);
});

test("the larger of percent and strikes wins", () => {
  // paragraph on streak step 1 (22%): 20 words -> floor(4.4) = 4 > 2 strikes
  assert.equal(allowanceFor(20, 2, standard).allowed, 4);
});

test("the 3rd strike ends it by default; 'exceeds' allows N mistakes instead", () => {
  const a = allowanceFor(8, 0, standard); // 3 strikes
  assert.equal(passes(2, a, standard), true);
  assert.equal(passes(3, a, standard), false);
  const lenient = rulesFor("standard", { failWhen: "exceeds" });
  assert.equal(passes(3, a, lenient), true);
  assert.equal(passes(4, a, lenient), false);
});

test("at the 1-strike floor any reveal fails the paragraph", () => {
  const a = allowanceFor(6, 4, standard); // deep in a streak: 1 strike
  assert.equal(a.allowed, 1);
  assert.equal(passes(0, a, standard), true);
  assert.equal(passes(1, a, standard), false);
});

test("the percentage allowance works the same way: 25% of 40 words is 10 strikes", () => {
  const a = allowanceFor(40, 0, standard);
  assert.equal(a.allowed, 10);
  assert.equal(passes(9, a, standard), true);
  assert.equal(passes(10, a, standard), false);
});

test("advanced settings are validated", () => {
  assert.throws(() => rulesFor("standard", { floorPercent: 40 }), RangeError);
  assert.throws(() => rulesFor("standard", { minStrikesFloor: 5 }), RangeError);
  assert.doesNotThrow(() => rulesFor("relaxed", { stepPercent: 2, floorPercent: 8 }));
});

test("defaults match the agreed design", () => {
  assert.equal(DEFAULT_RULES.streakStartsAfter, 2);
  assert.equal(DEFAULT_RULES.stepPercent, 3);
  assert.equal(DEFAULT_RULES.floorPercent, 5);
  assert.equal(DEFAULT_RULES.minStrikes, 3);
  assert.equal(DEFAULT_RULES.minStrikesFloor, 1);
  assert.equal(DEFAULT_RULES.failWhen, "reaches");
});
