/**
 * Google Cloud Translation (Basic, v2) for single tapped words the dictionary doesn't know.
 *
 * The key (VITE_GOOGLE_TRANSLATE_KEY) ships in the app, so in Google Cloud it is restricted to this site (HTTP
 * referrer boekenwurm.pages.dev) and to the Translation API, with a daily quota inside the free 500,000 characters a
 * month. Only the one word is sent, never the sentence or the book. The page's referrer policy is "no-referrer", so
 * these requests send the site's origin explicitly, which is what the key restriction checks.
 *
 * Each reader may look up 200 words a day (lib/usage.ts); words already looked up are saved and never asked again.
 */
import { isUsefulTranslation } from "./meaning.ts";
import { claimOnDevice, DAILY_TRANSLATIONS, localDay, type Claim, type DayCount } from "./usage.ts";
import { supabase } from "./supabase.ts";
import { getState, setState } from "./store.ts";

const KEY = import.meta.env.VITE_GOOGLE_TRANSLATE_KEY?.trim() || "";

export const canTranslate = (): boolean => Boolean(KEY);

export type TranslateResult = { ok: true; text: string } | { ok: false; reason: "none" | "offline" | "unavailable" | "limit" };

const DEVICE_COUNT = "boekenwurm-translations";
const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

function deviceCount(): DayCount | null {
  try {
    return JSON.parse(localStorage.getItem(DEVICE_COUNT) ?? "null") as DayCount | null;
  } catch {
    return null;
  }
}

/**
 * One lookup from today's allowance. Signed in, the account's count decides (it holds across devices and can't be
 * reset from the app); signed out, or if the account can't be reached, the device's count does.
 */
export async function claimLookup(): Promise<Claim> {
  const today = localDay(new Date(), timeZone());
  const onDevice = claimOnDevice(deviceCount(), today);
  let claim: Claim = onDevice.claim;
  if (supabase && getState().user) {
    const { data, error } = await supabase.rpc("claim_translation", { p_tz: timeZone() });
    const row = Array.isArray(data) ? (data[0] as { allowed: boolean; used: number; daily_limit: number } | undefined) : undefined;
    if (!error && row) claim = { allowed: row.allowed, used: row.used, limit: row.daily_limit };
  }
  // The device keeps its own tally too, so the count shows (and holds) offline.
  try {
    localStorage.setItem(DEVICE_COUNT, JSON.stringify({ day: today, words: Math.max(onDevice.state.words, claim.used) }));
  } catch {
    /* storage blocked */
  }
  setState({ translations: { day: today, used: claim.used, limit: claim.limit } });
  return claim;
}

/** Today's lookups so far, for Me (without using one). */
export async function lookupsToday(): Promise<{ used: number; limit: number }> {
  const today = localDay(new Date(), timeZone());
  const c = deviceCount();
  let used = c && c.day === today ? c.words : 0;
  if (supabase && getState().user) {
    const { data } = await supabase.from("translation_usage").select("words").eq("day", today).maybeSingle();
    if (data) used = Math.max(used, (data as { words: number }).words);
  }
  setState({ translations: { day: today, used, limit: DAILY_TRANSLATIONS } });
  return { used, limit: DAILY_TRANSLATIONS };
}

/** "fietsenstalling" -> "bicycle shed". Results that only hand the word back count as no meaning. */
export async function translateWord(word: string, signal?: AbortSignal): Promise<TranslateResult> {
  if (!KEY) return { ok: false, reason: "unavailable" };
  if (!navigator.onLine) return { ok: false, reason: "offline" };
  if (!(await claimLookup()).allowed) return { ok: false, reason: "limit" };
  let res: Response;
  try {
    res = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(KEY)}`, {
      method: "POST",
      signal,
      referrerPolicy: "strict-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ q: word, source: "nl", target: "en", format: "text" }),
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    return { ok: false, reason: "offline" };
  }
  if (!res.ok) return { ok: false, reason: "unavailable" }; // a refused key or a spent quota: the tap stays free
  const body = (await res.json().catch(() => null)) as { data?: { translations?: Array<{ translatedText?: string }> } } | null;
  const text = decodeEntities(body?.data?.translations?.[0]?.translatedText ?? "").trim();
  return isUsefulTranslation(word, text) ? { ok: true, text } : { ok: false, reason: "none" };
}

function decodeEntities(s: string): string {
  return s.replace(/&(#39|quot|amp|lt|gt);/g, (_, e: string) => ({ "#39": "'", quot: '"', amp: "&", lt: "<", gt: ">" })[e]!);
}
