/**
 * Google Translate for single tapped words the dictionary doesn't know, through Boekenwurm's translate function
 * (supabase/functions/translate). The Google key lives only in that function, so the daily allowance of 200 words
 * per reader (claim_translation, migration 0003) can't be skipped. Lookups need a signed-in reader: the count
 * belongs to their account. Only the one word is sent, never the sentence or the book.
 *
 * Words already looked up are saved to the reader's meanings (store.saveMeaning) and never asked again.
 */
import { isUsefulTranslation } from "./meaning.ts";
import { DAILY_TRANSLATIONS, localDay } from "./usage.ts";
import { supabase } from "./supabase.ts";
import { getState, setState } from "./store.ts";

export type TranslateResult = { ok: true; text: string; shared: boolean } | { ok: false; reason: "none" | "offline" | "unavailable" | "limit" | "signin" };

const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const FUNCTION_URL = `${(import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/$/, "")}/functions/v1/translate`;

function counted(used: number | undefined, limit: number | undefined) {
  if (typeof used !== "number") return;
  setState({ translations: { day: localDay(new Date(), timeZone()), used, limit: limit ?? DAILY_TRANSLATIONS } });
}

/** Today's lookups so far, for Me (without using one). Signed out: none, since lookups need an account. */
/**
 * Report a shared Google translation as wrong, with the meaning the reader thinks is right (migration 0006). Three
 * different readers hide it from everyone until the owner reviews it. Returns false when it couldn't be sent.
 */
export async function reportTranslation(word: string, suggestion: string): Promise<boolean> {
  if (!supabase || !getState().user) return false;
  const { error } = await supabase.rpc("report_shared_word", { p_word: word.toLowerCase(), p_suggestion: suggestion.trim().slice(0, 300) || null });
  return !error;
}

export async function lookupsToday(): Promise<{ used: number; limit: number }> {
  const today = localDay(new Date(), timeZone());
  const kept = getState().translations;
  let used = kept && kept.day === today ? kept.used : 0;
  if (supabase && getState().user) {
    const { data } = await supabase.from("translation_usage").select("words").eq("day", today).maybeSingle();
    if (data) used = Math.max(used, (data as { words: number }).words);
  }
  setState({ translations: { day: today, used, limit: DAILY_TRANSLATIONS } });
  return { used, limit: DAILY_TRANSLATIONS };
}

/** "fietsenstalling" -> "bicycle parking". Results that only hand the word back count as no meaning. */
export async function translateWord(word: string, signal?: AbortSignal): Promise<TranslateResult> {
  if (!supabase) return { ok: false, reason: "unavailable" };
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  if (!token) return { ok: false, reason: "signin" };
  if (!navigator.onLine) return { ok: false, reason: "offline" };
  let res: Response;
  try {
    res = await fetch(FUNCTION_URL, {
      method: "POST",
      signal,
      headers: {
        authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "",
        "content-type": "application/json",
      },
      body: JSON.stringify({ word, tz: timeZone() }),
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    return { ok: false, reason: "offline" };
  }
  const body = (await res.json().catch(() => null)) as { ok?: boolean; text?: string; reason?: string; used?: number; limit?: number; shared?: boolean } | null;
  counted(body?.used, body?.limit);
  if (res.status === 429) return { ok: false, reason: "limit" };
  if (res.status === 401) return { ok: false, reason: "signin" };
  if (!res.ok || !body?.ok) return { ok: false, reason: res.status === 400 ? "none" : "unavailable" }; // the tap stays free
  const text = (body.text ?? "").trim();
  return isUsefulTranslation(word, text) ? { ok: true, text, shared: body.shared === true } : { ok: false, reason: "none" };
}
