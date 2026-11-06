import { test } from "node:test";
import assert from "node:assert/strict";
import { rulesFor } from "../src/checkpoint.ts";
import { beginParagraph, startSession, turnPage, type Session } from "../src/session.ts";
import { acceptLevelUp, declineLevelUp, recordSession, startProgress, tokensToOffer, type Progress } from "../src/progress.ts";

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
  let p: Progress = startProgress("A2");
  for (const id of ["s1", "s2"]) p = recordSession(p, streak(10, id).session, 0).progress;
  assert.equal(p.offer, null);
  assert.equal(tokensToOffer(p), 1);
  p = recordSession(p, streak(12, "s3").session, 0).progress;
  assert.deepEqual(p.offer, { from: "A2", to: "B1" });
  assert.equal(acceptLevelUp(p).level, "B1");
  assert.equal(acceptLevelUp(p).tokens.length, 0);
});

test("the same session can't be counted twice, and a session without a token counts nothing", () => {
  let p = startProgress("A1");
  const s = streak(10, "same").session;
  p = recordSession(p, s, 0).progress;
  const again = recordSession(p, s, 1);
  assert.equal(again.earned, false);
  assert.equal(again.progress.tokens.length, 1);
  assert.equal(recordSession(p, streak(5, "short").session, 2).earned, false);
});

test("declining clears the count, so the offer returns after three more tokens", () => {
  let p = startProgress("A1");
  for (const id of ["a", "b", "c"]) p = recordSession(p, streak(10, id).session, 0).progress;
  p = declineLevelUp(p);
  assert.equal(p.level, "A1");
  assert.equal(p.offer, null);
  assert.equal(tokensToOffer(p), 3);
  assert.equal(p.history.length, 3);
});

test("no offer past C2", () => {
  let p = startProgress("C2");
  for (const id of ["a", "b", "c"]) p = recordSession(p, streak(10, id).session, 0).progress;
  assert.equal(p.offer, null);
  assert.equal(p.history.length, 3);
  assert.equal(tokensToOffer(p), 0);
});
