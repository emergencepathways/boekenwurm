// Word lists: unseen / seen / tapped, colours, the learned rule, list-first reviews and the common-words badge.
import { test } from "node:test";
import assert from "node:assert/strict";
import { commonListsLearned, COMMON_LIST_SIZES, LEARNED_EASY_DAYS, LEARNED_UNTAPPED_READS, listProgress, listWordStatus } from "../src/wordlist.ts";
import { answer, newReviewCard, reviewOrder, reviewSet, type ReviewCard } from "../src/review.ts";
import { applySession, type WordStats } from "../src/words.ts";
import { beginParagraph, reveal, startSession, turnPage, type Session } from "../src/session.ts";
import { DEFAULT_RULES } from "../src/checkpoint.ts";
import { ACHIEVEMENTS, tierReached } from "../src/achievements.ts";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 16, 12);
const stats = (o: Partial<WordStats> = {}): WordStats => ({ lemma: "huis", reveals: 0, encounters: 0, firstSeen: 0, lastRevealed: null, ...o });
const card = (o: Partial<ReviewCard> = {}): ReviewCard => ({ ...newReviewCard("huis", NOW - 30 * DAY), ...o });

test("not met yet, seen but never tapped, tapped", () => {
  assert.equal(listWordStatus(undefined, undefined, NOW).state, "unseen");
  assert.equal(listWordStatus(stats({ encounters: 3 }), undefined, NOW).state, "seen");
  assert.equal(listWordStatus(stats({ encounters: 3 }), undefined, NOW).colour, null, "a seen word has no colour");
  assert.equal(listWordStatus(stats({ encounters: 3, reveals: 1, recent: [NOW - DAY] }), undefined, NOW).state, "tapped");
});

test("a tapped word's colour is the worse of recent taps and its review rating", () => {
  const twoTaps = stats({ encounters: 5, reveals: 2, recent: [NOW - DAY, NOW - 2 * DAY] }); // green by taps
  const eightTaps = stats({ encounters: 9, reveals: 8, recent: Array.from({ length: 8 }, (_, i) => NOW - i * 3_600_000) }); // red by taps
  assert.equal(listWordStatus(twoTaps, card({ pool: "easy" }), NOW).colour, "green");
  assert.equal(listWordStatus(twoTaps, card({ pool: "medium" }), NOW).colour, "yellow");
  assert.equal(listWordStatus(twoTaps, card({ pool: "hard" }), NOW).colour, "red");
  assert.equal(listWordStatus(eightTaps, card({ pool: "easy" }), NOW).colour, "red", "8 taps in 2 weeks outweigh an Easy rating");
});

test("learned: 10 paragraphs read without a tap; if ever tapped, also Easy for 14 days", () => {
  assert.equal(LEARNED_UNTAPPED_READS, 10);
  assert.equal(LEARNED_EASY_DAYS, 14);
  assert.equal(listWordStatus(stats({ encounters: 9, untapped: 9 }), undefined, NOW).learned, false, "9 reads");
  assert.equal(listWordStatus(stats({ encounters: 10, untapped: 10 }), undefined, NOW).learned, true, "10 reads, never tapped");
  const tapped = stats({ encounters: 14, reveals: 2, untapped: 12, recent: [] });
  assert.equal(listWordStatus(tapped, card({ pool: "easy", easySince: NOW - 13 * DAY }), NOW).learned, false, "Easy for 13 days");
  assert.equal(listWordStatus(tapped, card({ pool: "easy", easySince: NOW - 14 * DAY }), NOW).learned, true, "Easy for 14 days");
  assert.equal(listWordStatus(tapped, card({ pool: "medium" }), NOW).learned, false, "not Easy");
  assert.equal(listWordStatus(stats({ encounters: 9, reveals: 1, untapped: 8 }), card({ pool: "easy", easySince: NOW - 60 * DAY }), NOW).learned, false, "Easy long enough, but only 8 untapped reads");
});

test("Easy since: set when a card turns Easy, kept through check-backs, cleared by Hard, Medium or Skip", () => {
  let c = answer(card({ pool: "hard" }), "easy", NOW);
  assert.equal(c.easySince, NOW);
  c = answer(c, "easy", c.due);
  assert.equal(c.easySince, NOW, "a passed check-back keeps it");
  assert.equal(answer(c, "medium", c.due).easySince, null);
  assert.equal(answer(c, "skip", c.due).easySince, null);
});

const read = (s: Session, id: string, lemmas: string[], taps: string[] = []): Session => {
  s = beginParagraph(s, id, lemmas);
  for (const l of taps) s = reveal(s, { lemma: l, surface: l, at: NOW });
  const out = turnPage(s);
  return out.session;
};

test("untapped reads count once per paragraph, and not in unlimited lookup mode", () => {
  let s = startSession({ ...DEFAULT_RULES }, { id: "t" });
  s = read(s, "p1", ["de", "huis", "huis", "boom"]); // huis twice: one read
  s = read(s, "p2", ["huis", "boom"], ["boom"]); // boom tapped: no read for boom
  const book = applySession({}, s, NOW);
  assert.equal(book.huis.untapped, 2);
  assert.equal(book.boom.untapped, 1);
  assert.equal(applySession({}, s, NOW, { lookupMode: true }).huis.untapped, undefined, "lookup mode: nothing counts");
});

test("reviews: the word list's Hard and Medium words come before any other word", () => {
  const onList = (l: string) => l.startsWith("list-");
  const cards = [
    card({ lemma: "other-hard", pool: "hard", due: NOW - 9 * DAY }),
    card({ lemma: "other-medium", pool: "medium", due: NOW - 9 * DAY }),
    card({ lemma: "list-medium", pool: "medium", due: NOW - DAY }),
    card({ lemma: "list-hard", pool: "hard", due: NOW - DAY }),
    card({ lemma: "other-easy", pool: "easy", due: NOW - 5 * DAY }),
    card({ lemma: "list-easy", pool: "easy", due: NOW - DAY }),
  ];
  assert.deepEqual(reviewOrder(cards, NOW, onList).map((c) => c.lemma), ["list-hard", "list-medium", "other-hard", "other-medium", "list-easy", "other-easy"]);
  assert.deepEqual(reviewOrder(cards, NOW).map((c) => c.lemma).slice(0, 2), ["other-hard", "list-hard"], "no list: as before");
  const many = Array.from({ length: 40 }, (_, i) => card({ lemma: `other-${i}`, pool: "hard", due: NOW - 99 * DAY }));
  const set = reviewSet([...many, card({ lemma: "list-x", pool: "medium" })], NOW, 20, onList);
  assert.equal(set[0].lemma, "list-x", "a list word leads a set of 20 even behind 40 older Hard cards");
});

test("progress through a list", () => {
  const s: Record<string, ReturnType<typeof listWordStatus>> = {
    a: { state: "unseen", colour: null, learned: false, skipped: false },
    b: { state: "seen", colour: null, learned: true, skipped: false },
    c: { state: "tapped", colour: "red", learned: false, skipped: false },
  };
  assert.deepEqual(listProgress(["a", "b", "c"], (w) => s[w]), { total: 3, learned: 1, tapped: 1, seen: 1, unseen: 1 });
});

test("common words: the 500, 1,000, 2,000 and 5,000 lists, each a badge tier when every word is learned", () => {
  assert.deepEqual(COMMON_LIST_SIZES, [500, 1000, 2000, 5000]);
  const common = Array.from({ length: 5000 }, (_, i) => `w${i}`);
  const upTo = (n: number) => (w: string) => Number(w.slice(1)) < n;
  assert.equal(commonListsLearned(common, upTo(499)), 0);
  assert.equal(commonListsLearned(common, upTo(500)), 500);
  assert.equal(commonListsLearned(common, upTo(1999)), 1000);
  assert.equal(commonListsLearned(common, upTo(5000)), 5000);
  assert.equal(commonListsLearned(common, (w) => w !== "w10"), 0, "one word missing in the first 500");
  const a = ACHIEVEMENTS.find((x) => x.key === "common-words")!;
  const base = { pagesRead: 0, bestStreak: 0, wordsLookedUp: 0, studyDayRun: 0, readingDayRun: 0, booksFinished: 0, levelsRead: [], kindsRead: [], finishedAboveRank: false, finishedAgain: false };
  assert.deepEqual([0, 500, 1000, 2000, 5000].map((n) => tierReached(a, { ...base, commonWordsLearned: n })), [0, 1, 2, 3, 4]);
});
