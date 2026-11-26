// PRELAUNCH-REMOVE (docs/PRELAUNCH.md). Active reading time (src/activity.ts): only time on screen, with input in the last two minutes, counts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { activeSeconds, IDLE_MS, noteInput, startClock, tickClock } from "../src/activity.ts";
import { isAtOrAboveRank } from "../src/xp.ts";

const S = 1000;

test("reading with regular input counts every second", () => {
  let c = startClock(0);
  for (let t = 10 * S; t <= 600 * S; t += 10 * S) c = noteInput(c, t, true);
  assert.equal(activeSeconds(c), 600);
});

test("time stops two minutes after the last input", () => {
  let c = startClock(0);
  c = noteInput(c, 30 * S, true);
  for (let t = 40 * S; t <= 30 * 60 * S; t += 15 * S) c = tickClock(c, t, true);
  assert.equal(c.activeMs, 30 * S + IDLE_MS);
});

test("hidden time doesn't count, and neither does a sleep gap", () => {
  let c = startClock(0);
  c = noteInput(c, 20 * S, true);
  c = tickClock(c, 40 * S, false);         // switched to another app
  assert.equal(activeSeconds(c), 20);
  c = noteInput(c, 50 * S, true);           // back, but the 10 s before the input were hidden-ish: they count once visible
  c = tickClock(c, 10 * 60 * S, true);      // a 9-minute gap (device slept): nothing
  assert.equal(activeSeconds(c), 30);
});

test("ticks in the past change nothing", () => {
  const c = noteInput(startClock(0), 10 * S, true);
  assert.deepEqual(tickClock(c, 5 * S, true), c);
});

test("at or above the reader's rank", () => {
  assert.equal(isAtOrAboveRank("A2", "A2"), true);
  assert.equal(isAtOrAboveRank("B1", "A2"), true);
  assert.equal(isAtOrAboveRank("A1", "A2"), false);
  assert.equal(isAtOrAboveRank("A1", "A0"), true);
  assert.equal(isAtOrAboveRank(null, "A0"), false);
});
