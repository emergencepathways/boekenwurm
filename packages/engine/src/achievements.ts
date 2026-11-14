/**
 * Achievements: scout-style badges for reading habits. Most have five tiers, like League of Legends ranks (Bronze to
 * Diamond); a few are one-offs. Each tier reached earns XP.achievement (80 XP). Names are placeholders until the owner
 * names them (docs/DESIGN.md).
 *
 * Pure: the app gathers the reader's stats and passes them in, with the tiers already held, and gets back what is new.
 */
export const TIERS = ["Bronze", "Silver", "Gold", "Platinum", "Diamond"] as const;
export type Tier = (typeof TIERS)[number];

export interface AchievementStats {
  /** Pages read in any book; an EPUB or PDF page without numbers counts as 250 words. */
  pagesRead: number;
  /** Longest run of paragraphs passed in one session. */
  bestStreak: number;
  /** Taps that found a meaning (the word book's reveals). */
  wordsLookedUp: number;
  /** Days in a row, up to today or yesterday, with a review set finished. */
  studyDayRun: number;
  /** Days in a row, up to today or yesterday, with 5 paragraphs or more read. */
  readingDayRun: number;
  /** Books with every page read. */
  booksFinished: number;
  /** Levels (A1–C2) of books a page was read in. */
  levelsRead: readonly string[];
  /** Kinds of book a page was read in: epub, pdf, photo. */
  kindsRead: readonly string[];
  /** A book finished a level or more above the reader's rank at the time. */
  finishedAboveRank: boolean;
  /** A book finished a second time. */
  finishedAgain: boolean;
}

export type Category = "reading" | "streak" | "words" | "study" | "books" | "explorer";

export interface Achievement {
  key: string;
  /** Placeholder until the owner names it. */
  name: string;
  category: Category;
  /** What a tier asks for, in words ("10 pages"). */
  goal: (target: number) => string;
  /** Targets for Bronze … Diamond; a one-off has one target, 1. */
  targets: readonly number[];
  measure: (s: AchievementStats) => number;
}

const n = (x: number) => x.toLocaleString("en-US");

export const ACHIEVEMENTS: readonly Achievement[] = [
  { key: "pages", name: "Pages read", category: "reading", targets: [10, 100, 500, 2500, 10000], goal: (t) => `${n(t)} pages`, measure: (s) => s.pagesRead },
  { key: "streak", name: "Streak", category: "streak", targets: [10, 25, 50, 100, 250], goal: (t) => `${n(t)} paragraphs in a row`, measure: (s) => s.bestStreak },
  { key: "words", name: "Words looked up", category: "words", targets: [100, 1000, 5000, 15000, 50000], goal: (t) => `${n(t)} words`, measure: (s) => s.wordsLookedUp },
  { key: "study-days", name: "Study days in a row", category: "study", targets: [7, 14, 30, 100, 365], goal: (t) => `${n(t)} days`, measure: (s) => s.studyDayRun },
  { key: "reading-days", name: "Reading days in a row", category: "reading", targets: [3, 7, 30, 100, 365], goal: (t) => `${n(t)} days`, measure: (s) => s.readingDayRun },
  { key: "books", name: "Books finished", category: "books", targets: [1, 5, 15, 50, 100], goal: (t) => (t === 1 ? "1 book" : `${n(t)} books`), measure: (s) => s.booksFinished },
  { key: "every-level", name: "Every level", category: "explorer", targets: [1], goal: () => "A page at every level, A1 to C2", measure: (s) => (["A1", "A2", "B1", "B2", "C1", "C2"].every((l) => s.levelsRead.includes(l)) ? 1 : 0) },
  { key: "every-kind", name: "Every kind of book", category: "explorer", targets: [1], goal: () => "A page from an EPUB, a PDF and a photographed book", measure: (s) => (["epub", "pdf", "photo"].every((k) => s.kindsRead.includes(k)) ? 1 : 0) },
  { key: "reach-higher", name: "Reach higher", category: "explorer", targets: [1], goal: () => "A book finished above your rank", measure: (s) => (s.finishedAboveRank ? 1 : 0) },
  { key: "again", name: "Again!", category: "explorer", targets: [1], goal: () => "A book finished a second time", measure: (s) => (s.finishedAgain ? 1 : 0) },
];

export const isOneOff = (a: Achievement): boolean => a.targets.length === 1;

/** Tiers reached (0 = none; 1 = Bronze … 5 = Diamond; a one-off is 0 or 1). */
export function tierReached(a: Achievement, s: AchievementStats): number {
  const v = a.measure(s);
  return a.targets.filter((t) => v >= t).length;
}

/** Progress towards the next tier, for the badge page ("7 of 14 days"); null when every tier is held. */
export function nextGoal(a: Achievement, s: AchievementStats): { tier: number; target: number; value: number } | null {
  const reached = tierReached(a, s);
  if (reached >= a.targets.length) return null;
  return { tier: reached + 1, target: a.targets[reached], value: Math.min(a.measure(s), a.targets[reached]) };
}

export interface Unlock {
  key: string;
  /** 1 = Bronze … 5 = Diamond (1 for a one-off). */
  tier: number;
}

/**
 * Tiers newly reached, one entry per tier (a reader who jumps from none to Silver gets Bronze and Silver, 80 XP
 * each). A tier held stays held even if a day-run measure later drops.
 */
export function newlyReached(s: AchievementStats, held: Readonly<Record<string, number>>): Unlock[] {
  const out: Unlock[] = [];
  for (const a of ACHIEVEMENTS) {
    const have = held[a.key] ?? 0;
    for (let t = have + 1; t <= tierReached(a, s); t++) out.push({ key: a.key, tier: t });
  }
  return out;
}

/** The tier's name: Bronze … Diamond, or "Done" for a one-off. */
export const tierName = (a: Achievement, tier: number): string => (isOneOff(a) ? "Done" : TIERS[tier - 1]);

const DAY_MS = 24 * 60 * 60 * 1000;
/** A local date "YYYY-MM-DD" → a day number, for counting runs of days. */
const dayNumber = (d: string): number => Math.round(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / DAY_MS);

/**
 * Days in a row ending today, or yesterday (today isn't over yet): ["2026-11-11", "2026-11-12"] with today
 * 2026-11-13 is a run of 2.
 */
export function dayRun(days: readonly string[], today: string): number {
  const set = new Set(days.map(dayNumber));
  let d = dayNumber(today);
  if (!set.has(d)) d -= 1;
  let run = 0;
  while (set.has(d)) {
    run++;
    d--;
  }
  return run;
}
