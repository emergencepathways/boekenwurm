/**
 * XP, ranks and achievements in the app: the reader and the study screen report what happened, this module works out
 * the XP (packages/engine/src/xp.ts), keeps the play record in the profile's progress (synced), and celebrates a new
 * rank or badge. Every tier reached adds XP.achievement.
 */
import * as E from "@boekenwurm/engine";
import { getState, updateProfile } from "./store.ts";
import { localDay } from "./usage.ts";
import { toast } from "../ui.tsx";
import type { Book } from "./types.ts";

const DEVICE = "boekenwurm-device";
const DAY_PARAS = "boekenwurm-day-paragraphs";
const STUDY_SESSIONS = "boekenwurm-study-sessions";
const READING_DAY_PARAGRAPHS = 5;

/** This device's id: XP is kept per device, so syncing never counts it twice. */
export function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE);
    if (!id) localStorage.setItem(DEVICE, (id = crypto.randomUUID()));
    return id;
  } catch {
    return "this-device";
  }
}

const today = () => localDay(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
export const playOf = (): E.PlayState => ({ ...E.emptyPlay(), ...getState().profile.progress.play });
export const rankNow = () => E.rankOf(getState().profile.progress.play);

/** A rank's title: the level badges' Dutch titles; A0 has its own until the owner names it. */
export const rankTitle = (rank: E.Rank): string => (rank === "A0" ? "Nieuwkomer" : E.BADGES[rank].title);

/** A count kept per day on this device (paragraphs read today, study sessions today). */
function dayCount(key: string, add = 0): number {
  try {
    const t = today();
    const was = JSON.parse(localStorage.getItem(key) ?? "null") as { day: string; n: number } | null;
    const n = (was?.day === t ? was.n : 0) + add;
    if (add) localStorage.setItem(key, JSON.stringify({ day: t, n }));
    return n;
  } catch {
    return add;
  }
}

/** Save a changed record with the XP it adds, then celebrate what's new. */
async function commit(next: E.PlayState, gained: number): Promise<void> {
  const before = rankNow();
  const play = E.addXp(next, deviceId(), gained);
  await updateProfile((p) => ({ ...p, progress: { ...p.progress, play } }));
  const after = rankNow();
  if (after.rank !== before.rank) toast(`New rank: ${after.rank} · ${rankTitle(after.rank)}!`, 5000);
  await checkAchievements();
}

/** The achievements' stats from the record, the word book and the books. */
export function statsNow(): E.AchievementStats {
  const s = getState();
  const pagesWithNumbers = s.books.reduce((n, b) => n + (b.pagesRead?.length ?? 0), 0);
  const wordsLookedUp = Object.values(s.wordbook).reduce((n, w) => n + w.reveals, 0);
  return E.statsOf(playOf(), { today: today(), wordsLookedUp, pagesWithNumbers });
}

/** New tiers: held from now on, 80 XP each, and a toast for each. Safe to call any time. */
export async function checkAchievements(): Promise<void> {
  const play = playOf();
  const fresh = E.newlyReached(statsNow(), play.tiers);
  if (!fresh.length) return;
  const tiers = { ...play.tiers };
  for (const u of fresh) tiers[u.key] = Math.max(tiers[u.key] ?? 0, u.tier);
  const last = fresh[fresh.length - 1];
  const a = E.ACHIEVEMENTS.find((x) => x.key === last.key)!;
  toast(`Badge: ${a.name} · ${E.tierName(a, last.tier)} (+${E.XP.achievement * fresh.length} XP)${fresh.length > 1 ? ` and ${fresh.length - 1} more` : ""}`, 5000);
  await commit({ ...play, tiers }, E.XP.achievement * fresh.length);
}

export interface ParagraphRead {
  book: Book;
  /** The level the text was read at: the book's, or the level Claude matched it to. */
  textLevel: E.CefrLevel | null;
  failed: boolean;
  streak: boolean;
  lookupMode?: boolean;
  /** Words in the paragraph, counted for pages only in books without page numbers. */
  words: number;
  bookHasPages: boolean;
  bestStreak: number;
}

/** A paragraph read (on the page turn). Returns the XP it earned. */
export async function paragraphRead(p: ParagraphRead): Promise<number> {
  const play = playOf();
  const xp = E.paragraphXp({ rank: rankNow().rank, streak: p.streak, failed: p.failed, lookupMode: p.lookupMode, bookLevel: p.textLevel });
  const dev = deviceId();
  const parasToday = dayCount(DAY_PARAS, 1);
  const t = today();
  const next: E.PlayState = {
    ...play,
    words: p.bookHasPages ? play.words : { ...play.words, [dev]: (play.words[dev] ?? 0) + p.words },
    readDays: parasToday >= READING_DAY_PARAGRAPHS && !play.readDays.includes(t) ? [...play.readDays, t] : play.readDays,
    bestStreak: Math.max(play.bestStreak, p.bestStreak),
    levelsRead: p.textLevel && !play.levelsRead.includes(p.textLevel) ? [...play.levelsRead, p.textLevel] : play.levelsRead,
    kindsRead: p.book.source !== "sample" && !play.kindsRead.includes(p.book.source) ? [...play.kindsRead, p.book.source] : play.kindsRead,
  };
  await commit(next, xp);
  return xp;
}

/** A run of 10 paragraphs or more in a session: once per session, never in unlimited lookup mode. */
export async function streakBonus(o: { lookupMode?: boolean } = {}): Promise<number> {
  if (o.lookupMode) return 0;
  toast(`10 paragraphs in a row: +${E.XP.streakBonus} XP!`, 4000);
  await commit(playOf(), E.XP.streakBonus);
  return E.XP.streakBonus;
}

/** Every page of a book read. Returns the XP it earned. */
export async function bookFinished(book: Book): Promise<number> {
  const play = playOf();
  const times = play.finished[book.id] ?? 0;
  const xp = E.bookXp(times);
  const above = E.isAboveRank(book.level as E.CefrLevel | null, rankNow().rank);
  toast(times ? `Finished again: +${xp} XP` : `Book finished: +${xp} XP!`, 5000);
  await commit({ ...play, finished: { ...play.finished, [book.id]: times + 1 }, finishedAboveRank: play.finishedAboveRank || above }, xp);
  return xp;
}

/**
 * A flashcard session ended: 40 XP for 10 cards or more (or the whole set, if smaller), up to 3 sessions a day; and,
 * once a day, the review reward (300 XP) for finishing a whole review set. Returns the XP it earned.
 */
export async function studyFinished(o: { cards: number; dueAtStart: number; completedSet: boolean; afterLookupMode?: boolean }): Promise<number> {
  if (o.cards <= 0) return 0;
  const play = playOf();
  const session = E.studySessionXp({ cards: o.cards, due: o.dueAtStart, sessionsToday: dayCount(STUDY_SESSIONS), afterLookupMode: o.afterLookupMode });
  if (session) dayCount(STUDY_SESSIONS, 1);
  const t = today();
  const daily = o.completedSet && !play.studyDays.includes(t) ? E.XP.dailyReview : 0;
  if (!session && !daily) return 0;
  toast(`Study: +${session + daily} XP${daily ? " (review set finished)" : ""}`, 4000);
  await commit({ ...play, studyDays: daily ? [...play.studyDays, t] : play.studyDays }, session + daily);
  return session + daily;
}
