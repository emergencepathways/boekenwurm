/**
 * A daily reading goal the reader sets for themselves (Account → Reading), for example to match what a study app such
 * as Poortwachter asks for: "5 pages a day, at or above my level". Boekenwurm says so when today's reading meets it.
 * Counted the same way as pages everywhere else: a printed page once per book, and 250 countable words = 1 page in
 * books without page numbers. What was read today stays on the device. Pure: the day and the reads are passed in.
 */
import { RANKS, type Rank } from "./xp.ts";
import { WORDS_PER_PAGE } from "./play.ts";
import type { CefrLevel } from "./definitions.ts";

export interface ReadingGoal {
  /** Pages a day; 0 = no goal. */
  pages: number;
  /** Count only reading at or above the reader's rank (a book without a level never counts then). */
  atLevel: boolean;
  /** The goal's day starts at this hour (0, 2 or 4): 2 matches Poortwachter's 02:00. */
  dayStartHour: number;
}

export const NO_GOAL: ReadingGoal = { pages: 0, atLevel: true, dayStartHour: 0 };

export interface PageRead {
  /** The paragraph, unique per book ("<book>:<ord>"): reading it twice counts once. */
  key: string;
  book: string;
  /** Printed page, when the book has page numbers. */
  page: number | null;
  countable: number;
  atLevel: boolean;
}

/** Is a text at or above the reader's rank? A text without a level never is; every set level is for an A0 reader. */
export function isAtOrAboveRank(textLevel: CefrLevel | null | undefined, rank: Rank): boolean {
  return textLevel != null && RANKS.indexOf(textLevel) >= RANKS.indexOf(rank);
}

/** Pages read: distinct printed pages per book, plus every 250 countable words in books without page numbers. */
export function pagesOf(reads: readonly PageRead[], atLevelOnly: boolean): number {
  const seen = new Map<string, PageRead>();
  for (const r of reads) if (!atLevelOnly || r.atLevel) seen.set(r.key, r);
  const printed = new Set<string>();
  let words = 0;
  for (const r of seen.values()) {
    if (r.page != null) printed.add(`${r.book}:${r.page}`);
    else words += r.countable;
  }
  return printed.size + Math.floor(words / WORDS_PER_PAGE);
}

export interface GoalProgress {
  pages: number;
  target: number;
  reached: boolean;
}

export function goalProgress(reads: readonly PageRead[], goal: ReadingGoal): GoalProgress | null {
  if (!goal.pages || goal.pages <= 0) return null;
  const pages = pagesOf(reads, goal.atLevel);
  return { pages, target: goal.pages, reached: pages >= goal.pages };
}

/** The goal's day for a moment: the local date, shifted back by the day's start hour. `localDate` formats a time. */
export function goalDay(now: number, goal: ReadingGoal, localDate: (t: number) => string): string {
  return localDate(now - Math.max(0, Math.min(6, goal.dayStartHour)) * 3_600_000);
}
