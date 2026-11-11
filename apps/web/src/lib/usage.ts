/**
 * The daily Google Translate allowance: 200 words per reader per day, the day turning at the reader's midnight.
 * The count is kept in the reader's account and claimed by the translate function (claim_translation in migration
 * 0003; supabase/functions/translate), so it holds across devices and can't be reset or skipped from the app.
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
