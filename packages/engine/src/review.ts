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
  /** When the card last became Easy (null while Hard, Medium or Skipped): a word list word counts as learned after 2 weeks. */
  easySince?: number | null;
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

/**
 * The pool in review order. Words on the reader's word list that are Hard or Medium come first (Hard before Medium),
 * then every other Hard, then Medium, then Easy check-backs (list words first); oldest first within each.
 */
export function reviewOrder(cards: readonly ReviewCard[], now: number, onList: (lemma: string) => boolean = () => false): ReviewCard[] {
  const listFlagged = (c: ReviewCard) => (onList(c.lemma) && (c.pool === "hard" || c.pool === "medium") ? 0 : 1);
  const list = (c: ReviewCard) => (onList(c.lemma) ? 0 : 1);
  return cards
    .filter((c) => inPool(c, now))
    .sort((a, b) => listFlagged(a) - listFlagged(b) || PRIORITY[a.pool] - PRIORITY[b.pool] || list(a) - list(b) || a.due - b.due || a.lemma.localeCompare(b.lemma));
}

/** The next review set: up to `size` cards from the pool, in review order. */
export const reviewSet = (cards: readonly ReviewCard[], now: number, size: number, onList?: (lemma: string) => boolean): ReviewCard[] =>
  reviewOrder(cards, now, onList).slice(0, clampSetSize(size));

/** The card after an answer. */
export function answer(c: ReviewCard, a: Answer, now: number): ReviewCard {
  const base = { ...c, reps: c.reps + 1, lastReview: now };
  if (a === "skip") return { ...base, pool: "skipped", easySince: null };
  if (a === "easy") {
    // A check-back passed (it was Easy and due): the next gap is longer. Otherwise it starts at the first gap.
    const step = c.pool === "easy" ? Math.min(c.easyStep + 1, EASY_GAPS_DAYS.length - 1) : 0;
    return { ...base, pool: "easy", easyStep: step, due: now + EASY_GAPS_DAYS[step] * DAY, easySince: c.pool === "easy" ? (c.easySince ?? now) : now };
  }
  // Hard or Medium: back in the pool. An Easy card forgotten at its check-back is a lapse.
  return { ...base, pool: a, easyStep: 0, easySince: null, lapses: c.pool === "easy" ? c.lapses + 1 : c.lapses, due: c.pool === a ? c.due : now };
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

// ---------------------------------------------------------------- the day's reviews (the owner's numbers, not settings)

/**
 * How a day of reviews is shaped (docs/DESIGN.md "Flashcards"). Not reader settings: the owner tunes them.
 * - At most 90 cards are due in a day; the rest wait in the review pool for the days after.
 * - Every set brings in new words from the common-words list (most common first): 5 per 30 cards, at most 15 a day.
 * - The reader's list words rated Hard or Medium take up to 40% of a set, up to 80% when they were read and tapped
 *   in the last 2 days (those come first).
 * - Whatever is left is filled from the pool in review order.
 */
export const REVIEW_DAY = { maxDue: 90, newPer30: 5, listShare: 0.4, recentListShare: 0.8, recentDays: 2 } as const;

/** New words a day may bring in: 5 per 30 of the day's 90, so 15. */
export const NEW_PER_DAY = Math.round((REVIEW_DAY.maxDue * REVIEW_DAY.newPer30) / 30);

export interface DayInput {
  cards: readonly ReviewCard[];
  now: number;
  /** Different cards already answered in review sets today. */
  reviewedToday: number;
  /** Of those, new words brought in today. */
  newToday: number;
  /** Words on the common-words list with no card yet and not learned, most common first. */
  newWords?: readonly string[];
  onList?: (lemma: string) => boolean;
  /** Read and tapped in the last 2 days (REVIEW_DAY.recentDays). */
  tappedRecently?: (lemma: string) => boolean;
}

const leftToday = (d: DayInput) => Math.max(0, REVIEW_DAY.maxDue - d.reviewedToday);
const newLeft = (d: DayInput) => Math.max(0, Math.min(NEW_PER_DAY - d.newToday, d.newWords?.length ?? 0));

/** Cards due today, for Home and the Study tab: the pool and today's new words, at most 90 less those already reviewed. */
export function dueToday(d: DayInput): number {
  const pool = d.cards.filter((c) => inPool(c, d.now)).length;
  return Math.min(leftToday(d), pool + newLeft(d));
}

/** Cards in the pool beyond today's 90: they wait for the days after. */
export function waitingAfterToday(d: DayInput): number {
  const pool = d.cards.filter((c) => inPool(c, d.now)).length;
  return Math.max(0, pool - Math.max(0, leftToday(d) - newLeft(d)));
}

export interface ReviewPlan {
  /** The set, in the order it is shown. */
  lemmas: string[];
  /** The new words in it (no card yet: one is made when the word is first rated). */
  fresh: string[];
}

/**
 * The next review set of `size` cards (the reader's 20–50, or what is left of today's 90): the reader's list words
 * rated Hard or Medium (tapped in the last 2 days first, up to 80% of the set; others up to 40% in all), new
 * common words (5 per 30), then the pool in review order.
 */
export function planSet(d: DayInput, size: number): ReviewPlan {
  const onList = d.onList ?? (() => false);
  const recent = d.tappedRecently ?? (() => false);
  const n = Math.min(clampSetSize(size), leftToday(d));
  if (n <= 0) return { lemmas: [], fresh: [] };
  const order = reviewOrder(d.cards, d.now, onList);
  const fresh = (d.newWords ?? []).slice(0, Math.min(newLeft(d), Math.round((n * REVIEW_DAY.newPer30) / 30)));
  const room = n - fresh.length;
  const flagged = order.filter((c) => onList(c.lemma) && (c.pool === "hard" || c.pool === "medium"));
  const list: string[] = [];
  for (const c of flagged.filter((c) => recent(c.lemma)))
    if (list.length < Math.min(room, Math.floor(n * REVIEW_DAY.recentListShare))) list.push(c.lemma);
  for (const c of flagged.filter((c) => !recent(c.lemma)))
    if (list.length < Math.min(room, Math.floor(n * REVIEW_DAY.listShare))) list.push(c.lemma);
  // The rest of the pool; flagged list words past their share wait for the next set, unless nothing else is left.
  const taken = new Set(list);
  const isFlagged = new Set(flagged.map((c) => c.lemma));
  const rest = order.filter((c) => !taken.has(c.lemma));
  const fill = [...rest.filter((c) => !isFlagged.has(c.lemma)), ...rest.filter((c) => isFlagged.has(c.lemma))].slice(0, room - list.length).map((c) => c.lemma);
  return { lemmas: [...list, ...fresh, ...fill], fresh };
}
