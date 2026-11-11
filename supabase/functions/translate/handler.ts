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

export interface Config {
  supabaseUrl: string;
  /** The project's publishable (anon) key, used when the request doesn't carry one. */
  supabaseKey: string;
  googleKey: string;
  fetch?: typeof fetch;
}

export type Answer =
  | { ok: true; text: string; used: number; limit: number }
  | { ok: false; reason: "signin" | "limit" | "unavailable" | "bad-word" | "method"; used?: number; limit?: number };

/** Sites allowed to call the function from a browser: the app, its preview deploys, and a local dev server. */
const ORIGIN = /^(https:\/\/([a-z0-9-]+\.)?boekenwurm\.pages\.dev|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/;

/** One word: letters, with an inner apostrophe or hyphen ("zo'n", "e-mail"); at most 40 characters. */
export const WORD = /^\p{L}+(?:['’-]\p{L}+)*$/u;

export function cors(origin: string | null): Record<string, string> {
  const h: Record<string, string> = {
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
    "access-control-max-age": "86400",
    vary: "origin",
  };
  if (origin && ORIGIN.test(origin)) h["access-control-allow-origin"] = origin;
  return h;
}

export async function handle(req: Request, config: Config): Promise<Response> {
  const headers = cors(req.headers.get("origin"));
  const reply = (status: number, body: Answer) =>
    new Response(JSON.stringify(body), { status, headers: { ...headers, "content-type": "application/json", "cache-control": "no-store" } });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return reply(405, { ok: false, reason: "method" });

  const auth = req.headers.get("authorization") ?? "";
  if (!/^Bearer \S+$/.test(auth)) return reply(401, { ok: false, reason: "signin" });

  const body = (await req.json().catch(() => null)) as { word?: unknown; tz?: unknown } | null;
  const word = typeof body?.word === "string" ? body.word.trim() : "";
  if (!word || word.length > 40 || !WORD.test(word)) return reply(400, { ok: false, reason: "bad-word" });
  const tz = typeof body?.tz === "string" && body.tz.length <= 64 ? body.tz : "UTC";

  const http = config.fetch ?? fetch;
  if (!config.supabaseUrl || !config.googleKey) return reply(503, { ok: false, reason: "unavailable" });

  // 2. One lookup from today's allowance, claimed as the reader (their token decides whose count it is).
  let claim: { allowed: boolean; used: number; daily_limit: number } | undefined;
  try {
    const r = await http(`${config.supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/claim_translation`, {
      method: "POST",
      headers: { apikey: req.headers.get("apikey") || config.supabaseKey, authorization: auth, "content-type": "application/json" },
      body: JSON.stringify({ p_tz: tz }),
    });
    if (r.status === 401 || r.status === 403) return reply(401, { ok: false, reason: "signin" });
    const rows = (await r.json().catch(() => null)) as unknown;
    if (!r.ok) {
      // A token without a user (the publishable key alone) is refused by claim_translation itself (errcode 28000).
      const signin = (rows as { code?: string } | null)?.code === "28000";
      return reply(signin ? 401 : 503, { ok: false, reason: signin ? "signin" : "unavailable" });
    }
    claim = Array.isArray(rows) ? (rows[0] as typeof claim) : undefined;
  } catch {
    return reply(503, { ok: false, reason: "unavailable" });
  }
  if (!claim) return reply(503, { ok: false, reason: "unavailable" });
  const counts = { used: claim.used, limit: claim.daily_limit };
  if (!claim.allowed) return reply(429, { ok: false, reason: "limit", ...counts });

  // 3. Only the word goes to Google.
  try {
    const g = await http(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(config.googleKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ q: word, source: "nl", target: "en", format: "text" }),
    });
    if (!g.ok) return reply(502, { ok: false, reason: "unavailable", ...counts });
    const out = (await g.json().catch(() => null)) as { data?: { translations?: Array<{ translatedText?: string }> } } | null;
    return reply(200, { ok: true, text: decodeEntities(out?.data?.translations?.[0]?.translatedText ?? "").trim(), ...counts });
  } catch {
    return reply(502, { ok: false, reason: "unavailable", ...counts });
  }
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#39|quot|amp|lt|gt);/g, (_, e: string) => ({ "#39": "'", quot: '"', amp: "&", lt: "<", gt: ">" })[e]!);
}
