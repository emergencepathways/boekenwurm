/**
 * Google Cloud Translation (Basic, v2) for single tapped words the dictionary doesn't know.
 *
 * The key (VITE_GOOGLE_TRANSLATE_KEY) ships in the app, so in Google Cloud it is restricted to this site (HTTP
 * referrer boekenwurm.pages.dev) and to the Translation API, with a daily quota inside the free 500,000 characters a
 * month. Only the one word is sent, never the sentence or the book. The page's referrer policy is "no-referrer", so
 * these requests send the site's origin explicitly, which is what the key restriction checks.
 */
import { isUsefulTranslation } from "./meaning.ts";

const KEY = import.meta.env.VITE_GOOGLE_TRANSLATE_KEY?.trim() || "";

export const canTranslate = (): boolean => Boolean(KEY);

export type TranslateResult = { ok: true; text: string } | { ok: false; reason: "none" | "offline" | "unavailable" };

/** "fietsenstalling" -> "bicycle shed". Results that only hand the word back count as no meaning. */
export async function translateWord(word: string, signal?: AbortSignal): Promise<TranslateResult> {
  if (!KEY) return { ok: false, reason: "unavailable" };
  if (!navigator.onLine) return { ok: false, reason: "offline" };
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
