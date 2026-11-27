// The app gate's rules in numbers (docs/APP_GATE.md, src/gate/rules.ts). Removed with the gate by
// scripts/remove-app-gate.sh.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as R from "../../src/gate/rules.ts";

const MIN = 60_000;

test("a quick review is 5 minutes by default (5 to 10) and unlocks 15; a deep one is 20 and unlocks an hour", () => {
  assert.equal(R.reviewMs("quick"), 5 * MIN);
  assert.equal(R.reviewMs("quick", 8), 8 * MIN);
  assert.equal(R.reviewMs("quick", 3), 5 * MIN);
  assert.equal(R.reviewMs("quick", 25), 10 * MIN);
  assert.equal(R.reviewMs("quick", Number.NaN), 5 * MIN);
  assert.equal(R.reviewMs("deep", 8), 20 * MIN);
  assert.equal(R.unlockMinutes("quick"), 15);
  assert.equal(R.unlockMinutes("deep"), 60);
});

test("time counts only with the page on screen and a tap in the last 2 minutes", () => {
  let c = R.startClock(0);
  for (let t = 1000; t <= 60_000; t += 1000) c = R.tick(c, t, true);
  assert.equal(c.activeMs, 60_000);
  // Hidden for 10 seconds: nothing counts.
  for (let t = 61_000; t <= 70_000; t += 1000) c = R.tick(c, t, false);
  assert.equal(c.activeMs, 60_000);
  // Visible again but no tap since 0: counts up to 2 minutes after the last tap, then stops.
  for (let t = 71_000; t <= 200_000; t += 1000) c = R.tick(c, t, true);
  assert.equal(c.activeMs, 60_000 + 50_000);
  assert.equal(R.isIdle(c, 200_000, true), true);
  // A tap: counting again.
  c = R.touch(c, 200_500);
  c = R.tick(c, 201_000, true);
  assert.equal(c.activeMs, 110_000 + 1000);
  assert.equal(R.isIdle(c, 201_000, true), false);
});

test("a long gap between ticks (the phone slept) adds nothing", () => {
  let c = R.startClock(0);
  c = R.touch(c, 1000);
  c = R.tick(c, 1000 + R.MAX_TICK_MS + 1, true);
  assert.equal(c.activeMs, 0);
  c = R.tick(c, 1000 + R.MAX_TICK_MS + 1001, true);
  assert.equal(c.activeMs, 1000);
});

test("a failed paragraph's time is taken back, never below zero", () => {
  const c = { ...R.startClock(0), activeMs: 90_000 };
  assert.equal(R.deduct(c, 30_000).activeMs, 60_000);
  assert.equal(R.deduct(c, 200_000).activeMs, 0);
  assert.equal(R.deduct(c, -5).activeMs, 90_000);
  assert.equal(R.isDone({ ...c, activeMs: 5 * MIN }, "quick"), true);
  assert.equal(R.isDone({ ...c, activeMs: 5 * MIN - 1 }, "quick"), false);
});

test("a paragraph stays up 120 words a minute, at least 8 seconds", () => {
  assert.equal(R.minReadMs(0), 8000);
  assert.equal(R.minReadMs(10), 8000);
  assert.equal(R.minReadMs(16), 8000);
  assert.equal(R.minReadMs(60), 30_000);
  assert.equal(R.minReadMs(120), 60_000);
});

test("reading and cards take turns; whatever has nothing left is skipped", () => {
  const both = { paragraph: true, cards: true };
  assert.equal(R.nextActivity(null, both), "paragraph");
  assert.equal(R.nextActivity("paragraph", both), "cards");
  assert.equal(R.nextActivity("cards", both), "paragraph");
  assert.equal(R.nextActivity("paragraph", { paragraph: true, cards: false }), "paragraph");
  assert.equal(R.nextActivity("cards", { paragraph: false, cards: true }), "cards");
  assert.equal(R.nextActivity(null, { paragraph: false, cards: false }), "none");
  assert.equal(R.CARDS_PER_ROUND, 5);
});

test("the app's name comes after #gate=, cleaned and at most 40 characters", () => {
  assert.equal(R.gateAppFromHash("#gate=TikTok"), "TikTok");
  assert.equal(R.gateAppFromHash("#gate=YouTube%20Kids"), "YouTube Kids");
  assert.equal(R.gateAppFromHash("#gate=X+Twitter"), "X Twitter");
  assert.equal(R.gateAppFromHash("#gate=<script>alert(1)</script>"), "scriptalert1script");
  assert.equal(R.gateAppFromHash(`#gate=${"a".repeat(60)}`), "a".repeat(40));
  assert.equal(R.gateAppFromHash("#gate=%E0%A4%A"), "a gated app"); // broken encoding
  assert.equal(R.gateAppFromHash("#gate"), "a gated app"); // an automation that doesn't pass the app on
  assert.equal(R.gateAppFromHash("#gate="), "a gated app");
  assert.equal(R.gateAppFromHash("#gate-setup"), null);
  assert.equal(R.gateAppFromHash("#privacy"), null);
  assert.equal(R.gateAppFromHash(""), null);
  assert.equal(R.isSetupHash("#gate-setup"), true);
  assert.deepEqual(R.setupHash("#gate-setup"), { verified: false });
  assert.deepEqual(R.setupHash("#gate-setup=ok"), { verified: true });
  assert.equal(R.setupHash("#gate-setup=yes"), null);
});

test("one shared Shortcut: unlock|minutes|app link, and test; the hand-built pair: minutes|app link", () => {
  assert.equal(R.unlockUrl(15, "tiktok://"), "shortcuts://run-shortcut?name=Boekenwurm%20Gate&input=text&text=unlock%7C15%7Ctiktok%3A%2F%2F");
  assert.equal(R.unlockUrl(60), "shortcuts://run-shortcut?name=Boekenwurm%20Gate&input=text&text=unlock%7C60%7C");
  assert.equal(R.testUrl(), "shortcuts://run-shortcut?name=Boekenwurm%20Gate&input=text&text=test");
  assert.equal(R.unlockUrl(15, "tiktok://", "pair"), "shortcuts://run-shortcut?name=Boekenwurm%20Unlock&input=text&text=15%7Ctiktok%3A%2F%2F");
  assert.equal(R.unlockUrl(60, null, "pair"), "shortcuts://run-shortcut?name=Boekenwurm%20Unlock&input=text&text=60%7C");
  // Anything that isn't an app's own link is dropped: no web pages, scripts or other Shortcuts.
  for (const bad of ["https://evil.example", "javascript:alert(1)", "data:text/html,x", "shortcuts://run-shortcut?name=x", "tiktok://<x>", "nope"])
    assert.equal(R.safeAppLink(bad), null, bad);
  assert.equal(R.safeAppLink(" instagram:// "), "instagram://");
  assert.equal(R.safeAppLink("youtube://watch?v=abc"), "youtube://watch?v=abc");
  assert.equal(R.gatePageUrl("https://boekenwurm.pages.dev/"), "https://boekenwurm.pages.dev/#gate=");
});

test("counts per app and day, kept 30 days", () => {
  let log: R.AttemptLog = {};
  log = R.recordShown(log, "2026-11-27", "TikTok");
  log = R.recordShown(log, "2026-11-27", "TikTok");
  log = R.recordPassed(log, "2026-11-27", "TikTok");
  log = R.recordShown(log, "2026-11-25", "Instagram");
  log = R.recordShown(log, "2026-11-20", "TikTok");
  log = R.recordShown(log, "2026-10-28", "TikTok"); // 30 days before: dropped by prune
  log = R.recordShown(log, "2026-10-29", "TikTok"); // 29 days before: kept
  assert.deepEqual(R.totals(log, "2026-11-27", 1, "TikTok"), { shown: 2, passed: 1 });
  assert.deepEqual(R.totals(log, "2026-11-27", 7, "TikTok"), { shown: 2, passed: 1 });
  assert.deepEqual(R.totals(log, "2026-11-27", 8, "TikTok"), { shown: 3, passed: 1 });
  assert.deepEqual(R.totals(log, "2026-11-27", 7), { shown: 3, passed: 1 });
  const kept = R.prune(log, "2026-11-27");
  assert.equal(kept["2026-10-28"], undefined);
  assert.ok(kept["2026-10-29"]);
  assert.deepEqual(R.appsInLog(kept), ["TikTok", "Instagram"]);
});
