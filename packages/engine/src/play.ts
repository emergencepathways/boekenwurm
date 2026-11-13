/**
 * The reader's play record: XP, what the achievements count, and the tiers held. It lives in Progress (synced as the
 * profile's progress), so it follows the reader to every device.
 *
 * Merging two devices' copies must never count anything twice or lose anything: totals are kept per device (a device
 * only ever raises its own), sets are unions, best values are maxima.
 */
import { dayRun, type AchievementStats } from "./achievements.ts";
import { rankFor } from "./xp.ts";

export interface PlayState {
  /** XP earned on each device (device id → XP). */
  xp: Record<string, number>;
  /** Words read on each device in books without page numbers (250 words make a page). */
  words: Record<string, number>;
  /** Days ("YYYY-MM-DD") with 5 paragraphs or more read. */
  readDays: string[];
  /** Days with every due card reviewed. */
  studyDays: string[];
  bestStreak: number;
  levelsRead: string[];
  kindsRead: string[];
  /** Book id → times finished. */
  finished: Record<string, number>;
  finishedAboveRank: boolean;
  /** Achievement key → tier held (1 = Bronze …). */
  tiers: Record<string, number>;
}

export const WORDS_PER_PAGE = 250;
const KEEP_DAYS = 400;

export const emptyPlay = (): PlayState => ({
  xp: {}, words: {}, readDays: [], studyDays: [], bestStreak: 0, levelsRead: [], kindsRead: [], finished: {}, finishedAboveRank: false, tiers: {},
});

const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);
export const totalXp = (p: PlayState): number => sum(p.xp);

const maxBy = (a: Record<string, number>, b: Record<string, number>) => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = Math.max(out[k] ?? 0, v);
  return out;
};
const union = (a: readonly string[], b: readonly string[]) => [...new Set([...a, ...b])].sort();

/** Two copies of the play record, from two devices or the server: nothing counted twice, nothing lost. */
export function mergePlay(a: PlayState | undefined, b: PlayState | undefined): PlayState {
  const x = { ...emptyPlay(), ...a }, y = { ...emptyPlay(), ...b };
  return {
    xp: maxBy(x.xp, y.xp),
    words: maxBy(x.words, y.words),
    readDays: union(x.readDays, y.readDays).slice(-KEEP_DAYS),
    studyDays: union(x.studyDays, y.studyDays).slice(-KEEP_DAYS),
    bestStreak: Math.max(x.bestStreak, y.bestStreak),
    levelsRead: union(x.levelsRead, y.levelsRead),
    kindsRead: union(x.kindsRead, y.kindsRead),
    finished: maxBy(x.finished, y.finished),
    finishedAboveRank: x.finishedAboveRank || y.finishedAboveRank,
    tiers: maxBy(x.tiers, y.tiers),
  };
}

/** Add XP earned on this device. */
export const addXp = (p: PlayState, device: string, xp: number): PlayState => ({ ...p, xp: { ...p.xp, [device]: (p.xp[device] ?? 0) + Math.max(0, xp) } });

/** The achievements' view of the record. `pagesWithNumbers` = pages read in books that have page numbers. */
export function statsOf(p: PlayState, o: { today: string; wordsLookedUp: number; pagesWithNumbers: number }): AchievementStats {
  return {
    pagesRead: o.pagesWithNumbers + Math.floor(sum(p.words) / WORDS_PER_PAGE),
    bestStreak: p.bestStreak,
    wordsLookedUp: o.wordsLookedUp,
    studyDayRun: dayRun(p.studyDays, o.today),
    readingDayRun: dayRun(p.readDays, o.today),
    booksFinished: Object.values(p.finished).filter((n) => n > 0).length,
    levelsRead: p.levelsRead,
    kindsRead: p.kindsRead,
    finishedAboveRank: p.finishedAboveRank,
    finishedAgain: Object.values(p.finished).some((n) => n > 1),
  };
}

/** The reader's rank from their record. */
export const rankOf = (p: PlayState | undefined) => rankFor(p ? totalXp(p) : 0);
