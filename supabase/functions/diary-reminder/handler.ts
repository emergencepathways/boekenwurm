/**
 * The weekly diary reminder (Web Push). Called once a week by .github/workflows/diary-reminder.yml with the cron
 * secret; never by readers. For each reminder address (push_subscriptions, migration 0011) it checks the reader's
 * diary record (in their synced progress: prompt numbers and days, never the text) and sends a reminder when the
 * week's entry is still to write. Addresses the push service says are gone (404, 410) are removed.
 *
 * Plain TypeScript, tested under Node (handler.test.ts); index.ts is the Deno entry with the Web Push library.
 */
import { timeZone } from "../_shared/common.ts";

export interface Subscription {
  endpoint: string;
  user_id: string;
  p256dh: string;
  auth: string;
  time_zone: string;
}

export interface Config {
  supabaseUrl: string;
  serviceKey: string;
  cronSecret: string;
  /** Sends one push; returns the push service's HTTP status. */
  send: (sub: Subscription, payload: string) => Promise<number>;
  now?: Date;
  fetch?: typeof fetch;
}

export const PROMPTS = 20;

export const PAYLOAD = JSON.stringify({
  title: "Je wekelijkse dagboek",
  body: "Schrijf een paar zinnen in het Nederlands: er wacht een nieuwe vraag op je.",
});

/** "YYYY-MM-DD" in a time zone. */
export const localDay = (now: Date, tz: string): string => {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timeZone(tz), year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
};

const dayNumber = (d: string) => Math.round(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86400000);
const weekStart = (d: string) => {
  const n = dayNumber(d);
  return n - ((n + 3) % 7);
};

/**
 * The same rule as weeklyDue in packages/engine/src/diary.ts (the test checks they agree): due when prompts are left
 * and no entry counted this week, Monday to Sunday.
 */
export function due(play: { diaryDone?: number[]; diaryDays?: string[] } | undefined, today: string): boolean {
  if ((play?.diaryDone?.length ?? 0) >= PROMPTS) return false;
  return !(play?.diaryDays ?? []).some((d) => weekStart(d) === weekStart(today));
}

/** Compare secrets in constant time. */
function same(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

export async function handle(req: Request, c: Config): Promise<Response> {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!same(req.headers.get("x-cron-secret") ?? "", c.cronSecret)) return new Response("Forbidden", { status: 403 });
  const f = c.fetch ?? fetch;
  const headers = { apikey: c.serviceKey, authorization: `Bearer ${c.serviceKey}` };
  const rest = `${c.supabaseUrl}/rest/v1`;

  const subsRes = await f(`${rest}/push_subscriptions?select=endpoint,user_id,p256dh,auth,time_zone`, { headers });
  if (!subsRes.ok) return Response.json({ error: "Couldn't read reminder addresses" }, { status: 502 });
  const subs = (await subsRes.json()) as Subscription[];
  if (!subs.length) return Response.json({ sent: 0, skipped: 0, removed: 0 });

  const users = [...new Set(subs.map((s) => s.user_id))];
  const profRes = await f(`${rest}/profiles?select=user_id,progress&user_id=in.(${users.join(",")})`, { headers });
  if (!profRes.ok) return Response.json({ error: "Couldn't read diary records" }, { status: 502 });
  const play = new Map(((await profRes.json()) as Array<{ user_id: string; progress?: { play?: { diaryDone?: number[]; diaryDays?: string[] } } }>).map((p) => [p.user_id, p.progress?.play]));

  const now = c.now ?? new Date();
  let sent = 0, skipped = 0, removed = 0;
  for (const s of subs) {
    if (!due(play.get(s.user_id), localDay(now, s.time_zone))) {
      skipped++;
      continue;
    }
    const status = await c.send(s, PAYLOAD);
    if (status === 404 || status === 410) {
      await f(`${rest}/push_subscriptions?endpoint=eq.${encodeURIComponent(s.endpoint)}`, { method: "DELETE", headers });
      removed++;
    } else if (status >= 200 && status < 300) {
      await f(`${rest}/push_subscriptions?endpoint=eq.${encodeURIComponent(s.endpoint)}`, {
        method: "PATCH", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ last_sent: now.toISOString() }),
      });
      sent++;
    } else skipped++;
  }
  return Response.json({ sent, skipped, removed });
}
