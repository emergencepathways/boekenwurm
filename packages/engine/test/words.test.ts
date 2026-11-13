// Colour-coded text: reveals of a word in the last 14 days decide its colour before it is tapped.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applySession, keepRecent, RECENT_DAYS, wordColor, type WordStats } from "../src/words.ts";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 13, 12);
const word = (recent: number[], reveals = recent.length || 1): WordStats => ({ lemma: "lopen", reveals, encounters: 10, firstSeen: 0, lastRevealed: recent.at(-1) ?? null, recent });
const times = (n: number, daysAgo = 1) => Array.from({ length: n }, (_, i) => NOW - daysAgo * DAY - i * 60_000);

test("never revealed: no colour", () => {
  assert.equal(wordColor(undefined, NOW), null);
  assert.equal(wordColor({ lemma: "huis", reveals: 0, encounters: 5, firstSeen: 0, lastRevealed: null, recent: [] }, NOW), null);
});

test("revealed 1 to 3 times in 14 days: green; 4 to 6: yellow; 7 or more: red", () => {
  assert.equal(RECENT_DAYS, 14);
  const expect: Record<number, string> = { 1: "green", 2: "green", 3: "green", 4: "yellow", 5: "yellow", 6: "yellow", 7: "red", 12: "red" };
  for (const [n, colour] of Object.entries(expect)) assert.equal(wordColor(word(times(Number(n))), NOW), colour, `${n} reveals`);
});

test("revealed before, but not in the last 14 days: green", () => {
  assert.equal(wordColor(word(times(9, 20), 9), NOW), "green");
  assert.equal(wordColor({ lemma: "x", reveals: 4, encounters: 4, firstSeen: 0, lastRevealed: NOW - 40 * DAY }, NOW), "green", "an old record without times");
});

test("the window is 14 days: a reveal 14 days and a minute ago no longer counts", () => {
  const edge = [...times(3), NOW - 14 * DAY + 60_000, NOW - 14 * DAY - 60_000];
  assert.equal(keepRecent(edge, NOW).length, 4);
  assert.equal(wordColor(word(edge), NOW), "yellow");
});

test("reveals in the session being read count too", () => {
  assert.equal(wordColor(word(times(3)), NOW, [NOW - 1000]), "yellow");
  assert.equal(wordColor(undefined, NOW, [NOW - 1000]), "green", "first reveal, this session");
});

test("finishing a session records each reveal's time and drops times older than the window", () => {
  const book = { lopen: word([NOW - 20 * DAY, NOW - 2 * DAY]) };
  const session = { reveals: [{ lemma: "lopen", surface: "liep", at: NOW - 1000 }, { lemma: "huis", surface: "huis", at: NOW - 500 }], encounters: {} };
  const out = applySession(book, session as never, NOW);
  assert.deepEqual(out.lopen.recent, [NOW - 2 * DAY, NOW - 1000]);
  assert.deepEqual(out.huis.recent, [NOW - 500]);
  assert.equal(wordColor(out.huis, NOW), "green");
});
