/**
 * Experience points and ranks: reading and studying earn XP, and the reader's rank (A0 to C2) rises by itself as XP
 * adds up. The rank is a status symbol, not a gate: readers choose books and AI targets at any level.
 *
 * The owner's rules (docs/DESIGN.md, "Levels and XP"):
 * - a paragraph read is 20 XP, 40 on a streak, 5 when it ends a run or in unlimited lookup mode;
 * - reading XP grows with rank (× 1 to × 1.4) and is × 1.5 in a book a level or more above the reader's rank;
 * - a book finished is 1,000 XP (500 when read again); a flashcard session 40 (80 after a lookup-mode session); all
 *   due cards reviewed for the day 300; an achievement tier 80; a run of 10 paragraphs or more in a session 200;
 * - A0 → A1 takes 600 XP (one sitting); after that, level n costs 30,000 × n^2.2, rounded to 5,000.
 */
import type { CefrLevel } from "./definitions.ts";
import { LEVELS } from "./progress.ts";

export type Rank = "A0" | CefrLevel;
export const RANKS: readonly Rank[] = ["A0", ...LEVELS];

export const XP = {
  paragraph: 20,
  streakParagraph: 40,
  /** A paragraph that ends a run (out of strikes), or one read in unlimited lookup mode: a quarter. */
  quarterParagraph: 5,
  aboveRank: 1.5,
  book: 1000,
  bookAgain: 500,
  studySession: 40,
  studyAfterLookupMode: 80,
  dailyReview: 300,
  achievement: 80,
  /** A run of 10 paragraphs or more in a session (the old streak token), once per session; not in lookup mode. */
  streakBonus: 200,
  /** A flashcard session earns XP from this many cards (or every card due, if fewer). */
  studySessionMinCards: 10,
  studySessionsPerDay: 3,
} as const;

/** Reading XP grows with rank, so the higher levels feel less steep without changing the thresholds. */
export const RANK_MULTIPLIER: Readonly<Record<Rank, number>> = { A0: 1, A1: 1, A2: 1.1, B1: 1.2, B2: 1.3, C1: 1.4, C2: 1.4 };

/** XP needed to go from RANKS[i] to RANKS[i + 1]: 600 for A0 → A1, then 30,000 × n^2.2 rounded to 5,000. */
export function stepXp(i: number): number {
  if (i <= 0) return 600;
  return Math.round((30000 * i ** 2.2) / 5000) * 5000;
}

/** Total XP at which each rank starts. */
export const RANK_STARTS: readonly number[] = RANKS.map((_, i) => Array.from({ length: i }, (_, k) => stepXp(k)).reduce((a, b) => a + b, 0));

export interface RankStatus {
  rank: Rank;
  /** The rank after this one, or null at C2. */
  next: Rank | null;
  /** XP earned since this rank started. */
  into: number;
  /** XP this rank takes in all (0 at C2). */
  span: number;
  /** 0–1 along the bar (1 at C2). */
  share: number;
}

export function rankFor(totalXp: number): RankStatus {
  const xp = Math.max(0, Math.floor(totalXp));
  let i = 0;
  while (i + 1 < RANKS.length && xp >= RANK_STARTS[i + 1]) i++;
  const next = i + 1 < RANKS.length ? RANKS[i + 1] : null;
  const span = next ? stepXp(i) : 0;
  const into = xp - RANK_STARTS[i];
  return { rank: RANKS[i], next, into, span, share: next ? into / span : 1 };
}

/** Is a book's level a level or more above the reader's rank? A0 counts as below A1. */
export function isAboveRank(bookLevel: CefrLevel | null | undefined, rank: Rank): boolean {
  return bookLevel != null && RANKS.indexOf(bookLevel) > RANKS.indexOf(rank);
}

export interface ParagraphXpInput {
  /** The reader was on a streak when the paragraph was turned (a pass). */
  streak: boolean;
  /** The paragraph used the last strike and ended the run. */
  failed: boolean;
  lookupMode?: boolean;
  bookLevel?: CefrLevel | null;
  rank: Rank;
}

/** XP for one paragraph read. */
export function paragraphXp(p: ParagraphXpInput): number {
  const base = p.failed || p.lookupMode ? XP.quarterParagraph : p.streak ? XP.streakParagraph : XP.paragraph;
  const above = isAboveRank(p.bookLevel, p.rank) ? XP.aboveRank : 1;
  return Math.round(base * RANK_MULTIPLIER[p.rank] * above);
}

/** XP for finishing a book: the first time, or again. */
export const bookXp = (timesFinishedBefore: number): number => (timesFinishedBefore > 0 ? XP.bookAgain : XP.book);

/** XP for a flashcard session, or 0 when it is too small to count or today's sessions are used up. */
export function studySessionXp(o: { cards: number; due: number; sessionsToday: number; afterLookupMode?: boolean }): number {
  if (o.sessionsToday >= XP.studySessionsPerDay) return 0;
  if (o.cards < Math.min(XP.studySessionMinCards, Math.max(1, o.due))) return 0;
  return o.afterLookupMode ? XP.studyAfterLookupMode : XP.studySession;
}
