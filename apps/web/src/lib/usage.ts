/**
 * The daily Google Translate allowance: 200 words per reader per day, the day turning at the reader's midnight.
 * Signed in, the count is kept in the reader's account (claim_translation in migration 0003), so it holds across
 * devices and the reader can't reset it. Signed out, it is kept on the device. No aliases, so the rule is tested in
 * Node (test/usage.test.ts).
 */

/** Words a reader may look up with Google Translate per day. Keep in step with claim_translation (0003). */
export const DAILY_TRANSLATIONS = 200;

/** The reader's local date as YYYY-MM-DD. */
export function localDay(now: Date = new Date(), timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export interface DayCount {
  day: string;
  words: number;
}

export interface Claim {
  allowed: boolean;
  used: number;
  limit: number;
}

/** One lookup against a count kept on the device: a new day starts from zero; at the limit nothing is added. */
export function claimOnDevice(state: DayCount | null, today: string, limit = DAILY_TRANSLATIONS): { claim: Claim; state: DayCount } {
  const words = state && state.day === today ? state.words : 0;
  if (words >= limit) return { claim: { allowed: false, used: words, limit }, state: { day: today, words } };
  return { claim: { allowed: true, used: words + 1, limit }, state: { day: today, words: words + 1 } };
}
