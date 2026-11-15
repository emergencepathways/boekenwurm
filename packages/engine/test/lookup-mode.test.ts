// Unlimited lookup mode: any Bronze badge unlocks it; every paragraph passes, with no streak.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LOOKUP_MODE_RULES, inStreak, validateRules } from "../src/checkpoint.ts";
import { beginParagraph, reveal, startSession, turnPage } from "../src/session.ts";
import { lookupModeUnlocked } from "../src/achievements.ts";
import { paragraphXp } from "../src/xp.ts";

test("unlocked by any one badge at Bronze or above", () => {
  assert.equal(lookupModeUnlocked(undefined), false);
  assert.equal(lookupModeUnlocked({}), false);
  assert.equal(lookupModeUnlocked({ words: 0 }), false);
  assert.equal(lookupModeUnlocked({ books: 1 }), true);
  assert.equal(lookupModeUnlocked({ "every-kind": 1 }), true, "a one-off counts");
});

test("every paragraph passes, however many words are looked up, and no streak builds", () => {
  validateRules(LOOKUP_MODE_RULES);
  let s = startSession(LOOKUP_MODE_RULES, { id: "t", tokenAtStreak: Number.MAX_SAFE_INTEGER });
  const words = Array.from({ length: 12 }, (_, i) => `woord${i}`);
  for (let p = 0; p < 15; p++) {
    s = beginParagraph(s, `p${p}`, words);
    for (const w of words) s = reveal(s, { lemma: w, surface: w, at: p * 100 });
    const out = turnPage(s);
    assert.equal(out.kind, "continue", `paragraph ${p} with every word looked up still passes`);
    assert.equal(out.kind === "continue" && out.tokenEarnedNow, false, "no streak bonus");
    s = out.session;
    assert.equal(inStreak(s.passesInARow, s.rules), false);
  }
  assert.equal(s.reveals.length, 15 * 12, "every lookup is kept for the study list");
});

test("a lookup-mode paragraph is a quarter of the XP, × 1.5 above your rank", () => {
  assert.equal(paragraphXp({ rank: "A1", streak: false, failed: false, lookupMode: true }), 5);
  assert.equal(paragraphXp({ rank: "A1", streak: false, failed: false, lookupMode: true, bookLevel: "B1" }), 8);
});
