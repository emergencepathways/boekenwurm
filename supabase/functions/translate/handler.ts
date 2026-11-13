/**
 * The translate function: one tapped Dutch word → English with Google Cloud Translation, at most 200 words per
 * reader per day.
 *
 * The Google key lives only here (a Supabase secret), never in the app, so the daily count can't be skipped by
 * calling Google directly. Each request:
 *   1. must come from a signed-in reader (their Supabase access token);
 *   2. is answered from the shared store when another reader already had the word translated (migration 0006):
 *      no Google call, and none of the reader's lookups used;
 *   3. otherwise claims one lookup from their daily allowance with claim_translation (migration 0003), called as the
 *      reader so the database decides who they are and refuses the 201st word;
 *   4. sends only the one word to Google, never the sentence or the book;
 *   5. saves Google's answer to the shared store, as the server, for the next reader.
 *
 * Kept free of Deno and npm imports so the same code runs under Node for the tests (handler.test.ts); index.ts is
 * the Deno entry point.
 */
import { bearer, claim, cors, googleError, refund, replier, timeZone, type ClaimConfig } from "../_shared/common.ts";

export interface Config extends ClaimConfig {
  googleKey: string;
}

export type Answer =
  | { ok: true; text: string; used: number; limit: number; shared?: false }
  /** From the shared store (migration 0006): no Google call, and none of the reader's lookups used. */
  | { ok: true; text: string; shared: true }
  | { ok: false; reason: "signin" | "limit" | "unavailable" | "bad-word" | "method"; used?: number; limit?: number; detail?: string };

/** One word: letters, with an inner apostrophe or hyphen ("zo'n", "e-mail"); at most 40 characters. */
export const WORD = /^\p{L}+(?:['’-]\p{L}+)*$/u;

export { cors };

export async function handle(req: Request, config: Config): Promise<Response> {
  const { headers, reply } = replier(req);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return reply(405, { ok: false, reason: "method" } satisfies Answer);

  const auth = bearer(req);
  if (!auth) return reply(401, { ok: false, reason: "signin" } satisfies Answer);

  const body = (await req.json().catch(() => null)) as { word?: unknown; tz?: unknown } | null;
  const word = typeof body?.word === "string" ? body.word.trim() : "";
  if (!word || word.length > 40 || !WORD.test(word)) return reply(400, { ok: false, reason: "bad-word" } satisfies Answer);
  if (!config.supabaseUrl || !config.googleKey) return reply(503, { ok: false, reason: "unavailable" } satisfies Answer);

  const http = config.fetch ?? fetch;
  const base = config.supabaseUrl.replace(/\/$/, "");
  const key = word.toLowerCase();

  // 2. Another reader already had this word translated: serve it, without Google and without using a lookup. Read
  //    with the reader's own token, so only signed-in readers see the shared store (and never hidden words).
  try {
    const r = await http(`${base}/rest/v1/shared_words?word=eq.${encodeURIComponent(key)}&select=meaning`, {
      headers: { apikey: req.headers.get("apikey") || config.supabaseKey, authorization: auth },
    });
    if (r.status === 401) return reply(401, { ok: false, reason: "signin" } satisfies Answer);
    const rows = r.ok ? ((await r.json().catch(() => [])) as Array<{ meaning?: string }>) : [];
    if (rows[0]?.meaning) return reply(200, { ok: true, text: rows[0].meaning, shared: true } satisfies Answer);
  } catch {
    /* the shared store is a shortcut: without it, ask Google */
  }

  // 3. One lookup from today's allowance, claimed as the reader (their token decides whose count it is).
  const c = await claim(req, auth, "claim_translation", timeZone(body?.tz), config);
  if (!c.ok) return reply(c.reason === "signin" ? 401 : 503, { ok: false, reason: c.reason === "signin" ? "signin" : "unavailable" } satisfies Answer);
  const counts = { used: c.used, limit: c.limit };
  if (!c.allowed) return reply(429, { ok: false, reason: "limit", ...counts } satisfies Answer);

  // 4. Only the word goes to Google. If Google fails, the lookup is given back.
  const failed = async (detail: string) => {
    console.error(`translate: Google Translate failed: ${detail}`);
    const back = await refund(auth, "refund_translation", c.day, config);
    return reply(502, { ok: false, reason: "unavailable", detail, used: back ? Math.max(0, c.used - 1) : c.used, limit: c.limit } satisfies Answer);
  };
  try {
    const g = await http(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(config.googleKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ q: word, source: "nl", target: "en", format: "text" }),
    });
    if (!g.ok) return await failed(await googleError(g));
    const out = (await g.json().catch(() => null)) as { data?: { translations?: Array<{ translatedText?: string }> } } | null;
    const text = decodeEntities(out?.data?.translations?.[0]?.translatedText ?? "").trim();
    // 5. Saved for every reader, by the server only. A word Google hands back unchanged (a name, a typo) isn't saved.
    if (text && text.toLowerCase() !== key && config.serviceKey) await share(http, base, config.serviceKey, key, text);
    return reply(200, { ok: true, text, ...counts } satisfies Answer);
  } catch (e) {
    return await failed(`Couldn't reach Google (${(e as Error).message || "network"}).`);
  }
}

/** Save a translation to the shared store (0006). The first one stays: a hidden or owner-fixed word isn't overwritten. */
async function share(http: typeof fetch, base: string, serviceKey: string, word: string, meaning: string): Promise<void> {
  try {
    await http(`${base}/rest/v1/shared_words`, {
      method: "POST",
      headers: {
        apikey: serviceKey, authorization: `Bearer ${serviceKey}`, "content-type": "application/json",
        prefer: "resolution=ignore-duplicates,return=minimal",
      },
      body: JSON.stringify({ word, meaning: meaning.slice(0, 300) }),
    });
  } catch {
    /* not shared this time; the reader still has their meaning */
  }
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#39|quot|amp|lt|gt);/g, (_, e: string) => ({ "#39": "'", quot: '"', amp: "&", lt: "<", gt: ">" })[e]!);
}
