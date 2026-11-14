/**
 * Flashcards (the owner's rules, docs/DESIGN.md "Flashcards"). Every word revealed while reading becomes a card in a
 * review pool, rated Hard, Medium, Easy or Skip:
 *
 * - Hard and Medium put a card in the pool to review, Hard first. Easy takes it out, and it comes back for a quick check
 *   after a growing gap (3 days, 1 week, 3 weeks, then every 2 months), after the hard and medium cards. Forgetting it
 *   then (Hard or Medium) puts it back in the pool. Skip drops a word that isn't worth learning (a fantasy name, a
 *   rare word); it can be brought back.
 * - A review takes a set from the pool (20–50 cards, 30 by default). A card rated Hard or Medium comes round again in
 *   the same set, Hard sooner; the set is done when every card has been rated Easy.
 * - After a reading session, its words are rated once each (the recap), with no repeats.
 *
 * Pure: times are passed in.
 */
export type Pool = "hard" | "medium" | "easy" | "skipped";
export type Answer = "hard" | "medium" | "easy" | "skip";

export interface ReviewCard {
  lemma: string;
  pool: Pool;
  /** When an Easy card comes back for a check; for Hard and Medium, when it entered the pool. */
  due: number;
  /** How many check-backs in a row it passed (index into EASY_GAPS_DAYS). */
  easyStep: number;
  /** Answers given. */
  reps: number;
  /** Times an Easy card was forgotten at a check-back. */
  lapses: number;
  lastReview: number | null;
}

const DAY = 24 * 60 * 60 * 1000;
/** Gaps before an Easy card's check-backs; the last one repeats. */
export const EASY_GAPS_DAYS: readonly number[] = [3, 7, 21, 60];

export const SET_SIZE = { min: 20, max: 50, default: 30 } as const;
export const clampSetSize = (n: number | null | undefined): number =>
  Number.isFinite(n) ? Math.min(SET_SIZE.max, Math.max(SET_SIZE.min, Math.round(n!))) : SET_SIZE.default;

/** A word revealed for the first time: in the pool as Medium until it is rated. */
export const newReviewCard = (lemma: string, now: number): ReviewCard => ({ lemma, pool: "medium", due: now, easyStep: 0, reps: 0, lapses: 0, lastReview: null });

/** Is the card in today's pool: Hard and Medium always, Easy once its check-back is due, Skipped never. */
export const inPool = (c: ReviewCard, now: number): boolean => c.pool === "hard" || c.pool === "medium" || (c.pool === "easy" && c.due <= now);

const PRIORITY: Record<Pool, number> = { hard: 0, medium: 1, easy: 2, skipped: 3 };

/** The pool in review order: Hard, then Medium, then Easy check-backs; oldest first within each. */
export function reviewOrder(cards: readonly ReviewCard[], now: number): ReviewCard[] {
  return cards.filter((c) => inPool(c, now)).sort((a, b) => PRIORITY[a.pool] - PRIORITY[b.pool] || a.due - b.due || a.lemma.localeCompare(b.lemma));
}

/** The next review set: up to `size` cards from the pool, in review order. */
export const reviewSet = (cards: readonly ReviewCard[], now: number, size: number): ReviewCard[] => reviewOrder(cards, now).slice(0, clampSetSize(size));

/** The card after an answer. */
export function answer(c: ReviewCard, a: Answer, now: number): ReviewCard {
  const base = { ...c, reps: c.reps + 1, lastReview: now };
  if (a === "skip") return { ...base, pool: "skipped" };
  if (a === "easy") {
    // A check-back passed (it was Easy and due): the next gap is longer. Otherwise it starts at the first gap.
    const step = c.pool === "easy" ? Math.min(c.easyStep + 1, EASY_GAPS_DAYS.length - 1) : 0;
    return { ...base, pool: "easy", easyStep: step, due: now + EASY_GAPS_DAYS[step] * DAY };
  }
  // Hard or Medium: back in the pool. An Easy card forgotten at its check-back is a lapse.
  return { ...base, pool: a, easyStep: 0, lapses: c.pool === "easy" ? c.lapses + 1 : c.lapses, due: c.pool === a ? c.due : now };
}

/** A skipped word brought back: in the pool as Medium. */
export const unskip = (c: ReviewCard, now: number): ReviewCard => ({ ...c, pool: "medium", due: now, easyStep: 0 });

/** In a review set, how many cards later a card comes round again: Hard sooner than Medium. */
export const AGAIN_AFTER: Readonly<Record<"hard" | "medium", number>> = { hard: 3, medium: 6 };

/**
 * The set's queue after the front card is answered. Easy and Skip take it out of the set; Hard and Medium put it back
 * a few cards later (or last, when fewer are left).
 */
export function requeue(queue: readonly string[], a: Answer): string[] {
  const [front, ...rest] = queue;
  if (front == null) return [];
  if (a === "easy" || a === "skip") return rest;
  const at = Math.min(AGAIN_AFTER[a], rest.length);
  return [...rest.slice(0, at), front, ...rest.slice(at)];
}
