/**
 * The translate function: one tapped Dutch word → English with Google Cloud Translation, at most 200 words per
 * reader per day.
 *
 * The Google key lives only here (a Supabase secret), never in the app, so the daily count can't be skipped by
 * calling Google directly. Each request:
 *   1. must come from a signed-in reader (their Supabase access token);
 *   2. claims one lookup from their daily allowance with claim_translation (migration 0003), called as the reader
 *      so the database decides who they are and refuses the 201st word;
 *   3. sends only the one word to Google, never the sentence or the book.
 *
 * Kept free of Deno and npm imports so the same code runs under Node for the tests (handler.test.ts); index.ts is
 * the Deno entry point.
 */
import { bearer, claim, cors, replier, timeZone, type ClaimConfig } from "../_shared/common.ts";

export interface Config extends ClaimConfig {
  googleKey: string;
}

export type Answer =
  | { ok: true; text: string; used: number; limit: number }
  | { ok: false; reason: "signin" | "limit" | "unavailable" | "bad-word" | "method"; used?: number; limit?: number };

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

  // 2. One lookup from today's allowance, claimed as the reader (their token decides whose count it is).
  const c = await claim(req, auth, "claim_translation", timeZone(body?.tz), config);
  if (!c.ok) return reply(c.reason === "signin" ? 401 : 503, { ok: false, reason: c.reason === "signin" ? "signin" : "unavailable" } satisfies Answer);
  const counts = { used: c.used, limit: c.limit };
  if (!c.allowed) return reply(429, { ok: false, reason: "limit", ...counts } satisfies Answer);

  // 3. Only the word goes to Google.
  const http = config.fetch ?? fetch;
  try {
    const g = await http(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(config.googleKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ q: word, source: "nl", target: "en", format: "text" }),
    });
    if (!g.ok) return reply(502, { ok: false, reason: "unavailable", ...counts } satisfies Answer);
    const out = (await g.json().catch(() => null)) as { data?: { translations?: Array<{ translatedText?: string }> } } | null;
    return reply(200, { ok: true, text: decodeEntities(out?.data?.translations?.[0]?.translatedText ?? "").trim(), ...counts } satisfies Answer);
  } catch {
    return reply(502, { ok: false, reason: "unavailable", ...counts } satisfies Answer);
  }
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#39|quot|amp|lt|gt);/g, (_, e: string) => ({ "#39": "'", quot: '"', amp: "&", lt: "<", gt: ">" })[e]!);
}
