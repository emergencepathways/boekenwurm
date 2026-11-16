/**
 * Word lists (the owner's rules, docs/DESIGN.md "Word lists"): the reader's own list, or the common-words lists
 * (the 500, 1,000, 2,000 and 5,000 most common Dutch words). For each word on a list:
 *
 * - its state: not met yet in anything read, seen in reading but never tapped, or tapped;
 * - its colour, for a tapped word: the worse of how often it was tapped lately (the colour-coded text's rule) and its
 *   latest review rating (Hard red, Medium amber, Easy green);
 * - learned: read in 10 or more paragraphs without a tap (unlimited lookup mode doesn't count), and, if it was ever
 *   tapped, its flashcard Easy for 2 weeks or more.
 */
import { wordColor, type WordColor, type WordStats } from "./words.ts";
import type { ReviewCard } from "./review.ts";

export type ListWordState = "unseen" | "seen" | "tapped";

export const LEARNED_UNTAPPED_READS = 10;
export const LEARNED_EASY_DAYS = 14;
/** The common-words lists: the first N words of the open dictionary, most common first. */
export const COMMON_LIST_SIZES: readonly number[] = [500, 1000, 2000, 5000];

const DAY = 24 * 60 * 60 * 1000;
const POOL_COLOUR: Record<ReviewCard["pool"], WordColor | null> = { hard: "red", medium: "yellow", easy: "green", skipped: null };
const WORSE: readonly WordColor[] = ["green", "yellow", "red"];

export interface ListWordStatus {
  state: ListWordState;
  colour: WordColor | null;
  learned: boolean;
  skipped: boolean;
}

export function listWordStatus(stats: WordStats | undefined, card: ReviewCard | undefined, now: number): ListWordStatus {
  const tapped = (stats?.reveals ?? 0) > 0 || card != null;
  const state: ListWordState = tapped ? "tapped" : (stats?.encounters ?? 0) > 0 ? "seen" : "unseen";
  let colour: WordColor | null = null;
  if (tapped) {
    const taps = wordColor(stats, now);
    const review = card ? POOL_COLOUR[card.pool] : null;
    colour = [taps, review].filter((c): c is WordColor => c != null).sort((a, b) => WORSE.indexOf(b) - WORSE.indexOf(a))[0] ?? null;
  }
  const readEnough = (stats?.untapped ?? 0) >= LEARNED_UNTAPPED_READS;
  const easyLongEnough = card?.pool === "easy" && card.easySince != null && now - card.easySince >= LEARNED_EASY_DAYS * DAY;
  return { state, colour, learned: readEnough && (!tapped || easyLongEnough), skipped: card?.pool === "skipped" };
}

export interface ListProgress {
  total: number;
  learned: number;
  tapped: number;
  seen: number;
  unseen: number;
}

export function listProgress(words: readonly string[], status: (lemma: string) => ListWordStatus): ListProgress {
  const p: ListProgress = { total: words.length, learned: 0, tapped: 0, seen: 0, unseen: 0 };
  for (const w of words) {
    const s = status(w);
    if (s.learned) p.learned++;
    p[s.state]++;
  }
  return p;
}

/** The largest common-words list learned in full (0, 500, 1,000, 2,000 or 5,000), for the Common words badge. */
export function commonListsLearned(common: readonly string[], learned: (lemma: string) => boolean): number {
  let best = 0;
  let i = 0;
  for (const size of COMMON_LIST_SIZES) {
    if (common.length < size) break;
    for (; i < size; i++) if (!learned(common[i])) return best;
    best = size;
  }
  return best;
}
