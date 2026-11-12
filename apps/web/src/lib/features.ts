/**
 * Features behind an access code (migration 0004). For now one: Google page reading, a test of a future paid
 * feature, where page photos are read by Google Cloud Vision through the read-page function (20 pages a day) instead
 * of on the device. Readers without it keep the free reader on their device.
 */
import { pageFromVision, type VisionPage } from "@boekenwurm/books";
import { supabase } from "./supabase.ts";
import { getState, setState } from "./store.ts";
import { toBase64 } from "./images.ts";
import { localDay } from "./usage.ts";

export const GOOGLE_PAGES = "google_page_reading";
export const PAGE_READS_PER_DAY = 20;

export const hasFeature = (f: string): boolean => getState().features.includes(f);
const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/** The signed-in reader's features, from their account. Signed out: none. */
export async function loadFeatures(): Promise<void> {
  if (!supabase || !getState().user) return setState({ features: [] });
  const { data, error } = await supabase.from("feature_access").select("feature");
  if (!error) setState({ features: (data as Array<{ feature: string }>).map((r) => r.feature) });
}

/** Enter an access code: returns the feature it opened, or throws with a message for the reader. */
export async function redeemCode(code: string): Promise<string> {
  if (!supabase || !getState().user) throw new Error("Sign in first: a code is added to your account.");
  const { data, error } = await supabase.rpc("redeem_code", { p_code: code.trim() });
  if (error) {
    if (/redeem_code|could not find the function/i.test(error.message)) throw new Error("Codes aren't set up yet (the database needs migration 0004).");
    throw new Error(/isn't valid|already been used/i.test(error.message) ? error.message : "That code couldn't be checked. Try again.");
  }
  await loadFeatures();
  return String(data);
}

/** Today's Google page readings so far, for Me. */
export async function pageReadsToday(): Promise<number> {
  if (!supabase || !getState().user) return 0;
  const today = localDay(new Date(), timeZone());
  const { data } = await supabase.from("page_read_usage").select("pages").eq("day", today).maybeSingle();
  const used = (data as { pages: number } | null)?.pages ?? 0;
  setState({ pageReads: { day: today, used, limit: PAGE_READS_PER_DAY } });
  return used;
}

export type GoogleRead = { ok: true; page: ReturnType<typeof pageFromVision> } | { ok: false; reason: "limit" | "unavailable" | "no-access" | "signin" | "offline" };

/** One page photo read by Google (Cloud Vision), through Boekenwurm's read-page function. */
export async function readPageWithGoogle(photo: Blob, seq: number, range: { lastPage?: number | null } = {}): Promise<GoogleRead> {
  if (!supabase) return { ok: false, reason: "unavailable" };
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  if (!token) return { ok: false, reason: "signin" };
  if (!navigator.onLine) return { ok: false, reason: "offline" };
  let res: Response;
  try {
    res = await fetch(`${(import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/$/, "")}/functions/v1/read-page`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "", "content-type": "application/json" },
      body: JSON.stringify({ image: await toBase64(photo), tz: timeZone() }),
    });
  } catch {
    return { ok: false, reason: "offline" };
  }
  const body = (await res.json().catch(() => null)) as ({ ok?: boolean; used?: number; limit?: number } & Partial<VisionPage>) | null;
  if (typeof body?.used === "number") setState({ pageReads: { day: localDay(new Date(), timeZone()), used: body.used, limit: body.limit ?? PAGE_READS_PER_DAY } });
  if (res.status === 429) return { ok: false, reason: "limit" };
  if (res.status === 403) return { ok: false, reason: "no-access" };
  if (res.status === 401) return { ok: false, reason: "signin" };
  if (!res.ok || !body?.ok || !Array.isArray(body.paragraphs)) return { ok: false, reason: "unavailable" };
  return { ok: true, page: pageFromVision({ width: body.width ?? 0, height: body.height ?? 0, paragraphs: body.paragraphs }, seq, range) };
}
