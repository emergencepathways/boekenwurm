/**
 * What Boekenwurm's Edge Functions share: which sites may call them from a browser, the reader's token, and claiming
 * one use of a daily allowance as the reader (the database decides whose count it is and refuses past the limit).
 * Plain TypeScript, no Deno or npm imports, so the functions' tests run under Node.
 */

/** Sites allowed to call the functions from a browser: the app, its preview deploys, and a local dev server. */
const ORIGIN = /^(https:\/\/([a-z0-9-]+\.)?boekenwurm\.pages\.dev|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/;

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

export function replier(req: Request) {
  const headers = cors(req.headers.get("origin"));
  return {
    headers,
    reply: (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { ...headers, "content-type": "application/json", "cache-control": "no-store" } }),
  };
}

/** The reader's "Bearer <token>", or null when there is none. */
export function bearer(req: Request): string | null {
  const auth = req.headers.get("authorization") ?? "";
  return /^Bearer \S+$/.test(auth) ? auth : null;
}

export interface ClaimConfig {
  supabaseUrl: string;
  /** The project's publishable (anon) key, used when the request doesn't carry one. */
  supabaseKey: string;
  /** The service role key, only to give back a use Google couldn't serve (refund_* in migration 0005). */
  serviceKey?: string;
  fetch?: typeof fetch;
}

export type Claim =
  | { ok: true; allowed: boolean; used: number; limit: number; day: string }
  | { ok: false; reason: "signin" | "no-access" | "unavailable" };

/**
 * One use of today's allowance, claimed with `rpc` (a claim_* function in the migrations) as the reader. Postgres
 * errors map to reasons: 28000 no reader (sign in), 42501 no access to the feature.
 */
export async function claim(req: Request, auth: string, rpc: string, tz: string, config: ClaimConfig): Promise<Claim> {
  const http = config.fetch ?? fetch;
  try {
    const r = await http(`${config.supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/${rpc}`, {
      method: "POST",
      headers: { apikey: req.headers.get("apikey") || config.supabaseKey, authorization: auth, "content-type": "application/json" },
      body: JSON.stringify({ p_tz: tz }),
    });
    if (r.status === 401 || r.status === 403) return { ok: false, reason: "signin" };
    const rows = (await r.json().catch(() => null)) as unknown;
    if (!r.ok) {
      const code = (rows as { code?: string } | null)?.code;
      return { ok: false, reason: code === "28000" ? "signin" : code === "42501" ? "no-access" : "unavailable" };
    }
    const row = Array.isArray(rows) ? (rows[0] as { allowed: boolean; used: number; daily_limit: number; day: string } | undefined) : undefined;
    return row ? { ok: true, allowed: row.allowed, used: row.used, limit: row.daily_limit, day: row.day } : { ok: false, reason: "unavailable" };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

/** The reader's id from their token (already accepted by the database when the use was claimed). */
export function readerId(auth: string): string | null {
  try {
    const payload = auth.replace(/^Bearer /, "").split(".")[1] ?? "";
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=")));
    return typeof json.sub === "string" && /^[0-9a-f-]{36}$/i.test(json.sub) ? json.sub : null;
  } catch {
    return null;
  }
}

/**
 * Give back a use Google couldn't serve, with `rpc` (refund_translation or refund_page_read, migration 0005), as the
 * server. Returns whether it was given back; without a service key nothing happens.
 */
export async function refund(auth: string, rpc: string, day: string, config: ClaimConfig): Promise<boolean> {
  const user = readerId(auth);
  if (!config.serviceKey || !user) return false;
  try {
    const r = await (config.fetch ?? fetch)(`${config.supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/${rpc}`, {
      method: "POST",
      headers: { apikey: config.serviceKey, authorization: `Bearer ${config.serviceKey}`, "content-type": "application/json" },
      body: JSON.stringify({ p_user: user, p_day: day }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Why Google refused, in Google's words ("Cloud Vision API has not been used in project … or it is disabled"), for the
 * reader and the function's logs. Never contains the key: Google's messages name the project and API, not the key.
 */
export async function googleError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: string; status?: string } } | null;
  const msg = body?.error?.message || body?.error?.status || `HTTP ${res.status}`;
  return msg.replace(/key=[\w-]+/g, "key=…").slice(0, 300);
}

export const timeZone = (tz: unknown): string => (typeof tz === "string" && tz.length > 0 && tz.length <= 64 ? tz : "UTC");
