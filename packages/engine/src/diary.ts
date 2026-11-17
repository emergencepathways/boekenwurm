/**
 * The diary (the owner's rules, docs/DESIGN.md "Diary"). Twenty prompts in Dutch come up in random order; a weekly
 * reminder asks for one until all twenty are written. The week's first entry earns the weekly reward (600 XP), each
 * further entry that week 30 XP, and writing the twentieth prompt a one-time 2,000 XP. Then free writing opens:
 * anything, or any prompt again, on the same weekly rewards. A prompt can be skipped (another one comes instead).
 *
 * Only what the entry earned is recorded (prompt numbers and days). The text itself stays on the reader's device and
 * is never part of this record or the server (docs/ARCHITECTURE.md, privacy).
 *
 * Pure: the day and any randomness are passed in.
 */

export interface DiaryPrompt {
  id: number;
  nl: string;
  en: string;
}

/** Written for A2 learners: informal "je", short questions whose words can be reused in the answer. */
export const DIARY_PROMPTS: readonly DiaryPrompt[] = [
  { id: 1, nl: "Hoe was je dag?", en: "How was your day?" },
  { id: 2, nl: "Vertel over je favoriete personage in het boek dat je nu leest.", en: "Tell me about your favourite character in the book you are reading." },
  { id: 3, nl: "Vertel over het laatste boek dat je hebt gelezen.", en: "Tell me about the last book you read." },
  { id: 4, nl: "Wat voor weer is het vandaag?", en: "What is the weather like today?" },
  { id: 5, nl: "Wie is je favoriete muzikant?", en: "Who is your favourite musician?" },
  { id: 6, nl: "Wat bestel je graag in een café?", en: "What do you like to order in a café?" },
  { id: 7, nl: "Hoe breng je het liefst een regenachtige dag door?", en: "How do you like to spend a rainy day?" },
  { id: 8, nl: "Welke plek bezoek je het liefst?", en: "What is your favourite place to visit?" },
  { id: 9, nl: "Beschrijf je favoriete hobby.", en: "Describe your favourite hobby." },
  { id: 10, nl: "Hoe voel je je vandaag?", en: "How are you feeling today?" },
  { id: 11, nl: "Wat was iets positiefs aan je dag?", en: "What was something positive about your day?" },
  { id: 12, nl: "Wat koop je in de supermarkt?", en: "What do you buy at the supermarket?" },
  { id: 13, nl: "Wat doe je overdag?", en: "What do you do during the day?" },
  { id: 14, nl: "Waar kom je vandaan?", en: "Where do you come from?" },
  { id: 15, nl: "Welke traditie vind je leuk?", en: "Which tradition do you like?" },
  { id: 16, nl: "Als je één personage uit een boek kon zijn, wie zou je dan zijn en waarom?", en: "If you could be one character from a book, who would you be and why?" },
  { id: 17, nl: "Als je terug in de tijd kon reizen, welke periode zou je bezoeken?", en: "If you could travel back in time, which period would you visit?" },
  { id: 18, nl: "Wat is jouw superkracht?", en: "What is your superpower?" },
  { id: 19, nl: "Welke musea vond je leuk om te bezoeken?", en: "Which museums did you enjoy visiting?" },
  { id: 20, nl: "Wat vind je van de Nederlandse taal?", en: "What do you think of the Dutch language?" },
];

export const DIARY = {
  /** XP for the week's first entry (weeks run Monday to Sunday). */
  weekXp: 600,
  /** XP for each further entry in the same week. */
  extraXp: 30,
  /** XP, once, for writing all twenty prompts. */
  allPromptsXp: 2000,
  /** Words an entry needs to count. */
  minWordsPrompt: 25,
  minWordsFree: 40,
} as const;

export interface DiaryRecord {
  /** Prompts written (ids). */
  done: readonly number[];
  /** Days ("YYYY-MM-DD") with an entry that counted. */
  days: readonly string[];
}

export const countWords = (text: string): number => (text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []).length;

/** Free writing opens once every prompt has been written. */
export const freeWritingOpen = (r: DiaryRecord): boolean => DIARY_PROMPTS.every((p) => r.done.includes(p.id));

/** An entry counted today already. */
export const wroteToday = (r: DiaryRecord, today: string): boolean => r.days.includes(today);

const DAY_MS = 86400000;
const dayNumber = (d: string) => Math.round(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / DAY_MS);
/** Monday of the day's week, as a day number (weeks run Monday to Sunday). */
const weekStart = (d: string) => {
  const n = dayNumber(d);
  return n - ((n + 3) % 7); // 1970-01-01 was a Thursday
};

/**
 * The weekly reminder is due when no entry counted this week (Monday–Sunday) and prompts are left. Once free writing
 * is open, writing is the reader's choice and the reminder stops.
 */
export const weeklyDue = (r: DiaryRecord, today: string): boolean =>
  !freeWritingOpen(r) && !r.days.some((d) => weekStart(d) === weekStart(today));

/**
 * The next prompt: a random one of those not written yet (`random` in [0, 1)), leaving out those skipped this visit
 * unless nothing else is left. After all twenty, any prompt can come up again.
 */
export function nextPrompt(r: DiaryRecord, random: number, skipped: readonly number[] = []): DiaryPrompt {
  const open = freeWritingOpen(r) ? DIARY_PROMPTS : DIARY_PROMPTS.filter((p) => !r.done.includes(p.id));
  const fresh = open.filter((p) => !skipped.includes(p.id));
  const pool = fresh.length ? fresh : open;
  return pool[Math.min(pool.length - 1, Math.floor(Math.max(0, random) * pool.length))];
}

export interface EntryResult {
  record: DiaryRecord;
  xp: number;
  counted: boolean;
  /** The week's first entry (600 XP) rather than a further one (30 XP). */
  firstThisWeek?: boolean;
  /** This entry wrote the twentieth prompt (+2,000 XP, once). */
  allPrompts?: boolean;
  /** Why it didn't count, if it didn't. */
  reason?: "too-short" | "not-open";
}

/**
 * An entry saved: does it count, and for how much? A prompt's entry needs 25 words; free writing (open after all
 * twenty) 40. The week's first entry earns 600 XP, each further one that week 30; writing the twentieth prompt adds
 * 2,000 XP once. Any number of entries a day count.
 */
export function saveEntry(r: DiaryRecord, e: { promptId: number | null; words: number; today: string }): EntryResult {
  const open = freeWritingOpen(r);
  if (!open && e.promptId == null) return { record: r, xp: 0, counted: false, reason: "not-open" };
  const free = open || e.promptId == null;
  if (e.words < (free ? DIARY.minWordsFree : DIARY.minWordsPrompt)) return { record: r, xp: 0, counted: false, reason: "too-short" };
  const firstThisWeek = !r.days.some((d) => weekStart(d) === weekStart(e.today));
  const done = e.promptId != null && !r.done.includes(e.promptId) ? [...r.done, e.promptId].sort((a, b) => a - b) : [...r.done];
  const allPrompts = !open && DIARY_PROMPTS.every((p) => done.includes(p.id));
  const days = r.days.includes(e.today) ? [...r.days] : [...r.days, e.today].sort();
  const xp = (firstThisWeek ? DIARY.weekXp : DIARY.extraXp) + (allPrompts ? DIARY.allPromptsXp : 0);
  return { record: { done, days }, xp, counted: true, firstThisWeek, allPrompts };
}
