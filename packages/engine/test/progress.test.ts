import { test } from "node:test";
import assert from "node:assert/strict";
import { rulesFor } from "../src/checkpoint.ts";
import { beginParagraph, startSession, turnPage, type Session } from "../src/session.ts";
import { acceptLevelUp, declineLevelUp, recordSession, setLevel, startProgress, tokensToOffer, type Progress } from "../src/progress.ts";
import { BADGES, currentTitle } from "../src/badges.ts";

const words = Array.from({ length: 40 }, (_, i) => `w${i}`);

/** Pass `n` paragraphs without reveals; report when the token arrived. */
function streak(n: number, id: string): { session: Session; tokenAt: number | null } {
  let s = startSession(rulesFor("standard"), { id });
  let tokenAt: number | null = null;
  for (let i = 1; i <= n; i++) {
    const out = turnPage(beginParagraph(s, `p${i}`, words));
    assert.equal(out.kind, "continue");
    if (out.kind === "continue" && out.tokenEarnedNow) tokenAt = i;
    s = out.session;
  }
  return { session: s, tokenAt };
}

test("a streak of 10 paragraphs earns the token on the 10th, once per session", () => {
  const nine = streak(9, "a");
  assert.equal(nine.tokenAt, null);
  assert.equal(nine.session.tokenEarned, false);
  const long = streak(25, "b");
  assert.equal(long.tokenAt, 10);
  assert.equal(long.session.tokenEarned, true);
  assert.equal(long.session.bestStreak, 25);
});

test("three tokens from three separate sessions offer the next level", () => {
  let p: Progress = startProgress("A2", 0);
  for (const id of ["s1", "s2"]) p = recordSession(p, streak(10, id).session, 0).progress;
  assert.equal(p.offer, null);
  assert.equal(tokensToOffer(p), 1);
  p = recordSession(p, streak(12, "s3").session, 0).progress;
  assert.deepEqual(p.offer, { from: "A2", to: "B1" });
  assert.equal(acceptLevelUp(p, 0).progress.level, "B1");
  assert.equal(acceptLevelUp(p, 0).progress.tokens.length, 0);
});

test("the same session can't be counted twice, and a session without a token counts nothing", () => {
  let p = startProgress("A1", 0);
  const s = streak(10, "same").session;
  p = recordSession(p, s, 0).progress;
  const again = recordSession(p, s, 1);
  assert.equal(again.earned, false);
  assert.equal(again.progress.tokens.length, 1);
  assert.equal(recordSession(p, streak(5, "short").session, 2).earned, false);
});

test("declining clears the count, so the offer returns after three more tokens", () => {
  let p = startProgress("A1", 0);
  for (const id of ["a", "b", "c"]) p = recordSession(p, streak(10, id).session, 0).progress;
  p = declineLevelUp(p);
  assert.equal(p.level, "A1");
  assert.equal(p.offer, null);
  assert.equal(tokensToOffer(p), 3);
  assert.equal(p.history.length, 3);
});

test("no offer past C2", () => {
  let p = startProgress("C2", 0);
  for (const id of ["a", "b", "c"]) p = recordSession(p, streak(10, id).session, 0).progress;
  assert.equal(p.offer, null);
  assert.equal(p.history.length, 3);
  assert.equal(tokensToOffer(p), 0);
});

test("an A1 reader starts with the A1 badge and title", () => {
  const p = startProgress("A1", 100);
  assert.deepEqual(p.badges, [{ level: "A1", at: 100, source: "start" }]);
  assert.equal(currentTitle(p.badges)?.title, "Letterproever");
});

test("starting higher awards the lower badges as placement", () => {
  const p = startProgress("B1", 0);
  assert.deepEqual(p.badges.map((b) => [b.level, b.source]), [["A1", "placement"], ["A2", "placement"], ["B1", "start"]]);
});

test("accepting a level-up earns that level's badge, shown once", () => {
  let p = startProgress("A1", 0);
  for (const id of ["x", "y", "z"]) p = recordSession(p, streak(10, id).session, 1).progress;
  const up = acceptLevelUp(p, 50);
  assert.deepEqual(up.newBadges, [{ level: "A2", at: 50, source: "level-up" }]);
  assert.equal(currentTitle(up.progress.badges)?.title, "Bladzijdeknabbelaar");
  assert.deepEqual(acceptLevelUp(up.progress, 60).newBadges, []); // no offer waiting
});

test("changing the level by hand: up awards placement badges, down keeps them all", () => {
  let p = startProgress("A1", 0);
  const up = setLevel(p, "B2", 5);
  assert.deepEqual(up.newBadges.map((b) => [b.level, b.source]), [["A2", "placement"], ["B1", "placement"], ["B2", "placement"]]);
  const down = setLevel(up.progress, "A2", 6);
  assert.equal(down.progress.level, "A2");
  assert.equal(down.progress.badges.length, 4);
  assert.deepEqual(down.newBadges, []);
  assert.equal(currentTitle(down.progress.badges)?.title, "Boekenwurm");
});

test("every level has a badge with a Dutch title and English meaning", () => {
  for (const l of ["A1", "A2", "B1", "B2", "C1", "C2"] as const) {
    assert.equal(BADGES[l].level, l);
    assert.ok(BADGES[l].title && BADGES[l].meaning);
  }
});
