/**
 * The owner's usage alert: when a reader's Google page reading reaches 200 pages in a calendar month (a soft limit;
 * the hard limit is 20 pages a day), the owner is told once, by email and with a notification on her phone.
 *
 * - The month's count and the once-a-month rule live in the database (page_reads_month_alert, migration 0012).
 * - Email goes through Resend (RESEND_API_KEY) to ALERT_EMAIL (contact@emergencepathways.org by default) and names the
 *   reader's account email, so the owner can contact them. Without a Resend key, no email is sent.
 * - The phone notification goes to every device where an admin account turned on notifications (push_subscriptions,
 *   migration 0011). It carries no reader details: Web Push passes through Apple, Google or Mozilla.
 *
 * Plain TypeScript, tested under Node; the Web Push sender is passed in by the Deno entry (index.ts).
 */
export const MONTH_SOFT_LIMIT = 200;
export const DEFAULT_ALERT_EMAIL = "contact@emergencepathways.org";
/** Resend's shared sender works for mail to the Resend account's own address; set ALERT_FROM once a domain is verified. */
export const DEFAULT_ALERT_FROM = "Boekenwurm <onboarding@resend.dev>";

export interface PushSub { endpoint: string; user_id: string; p256dh: string; auth: string }

export interface AlertConfig {
  supabaseUrl: string;
  serviceKey?: string;
  resendKey?: string;
  alertTo?: string;
  alertFrom?: string;
  /** Sends one Web Push; returns the push service's HTTP status. Absent: no phone notification. */
  sendPush?: (sub: PushSub, payload: string) => Promise<number>;
  fetch?: typeof fetch;
}

export interface AlertResult { pages: number; alerted: boolean; emailed: boolean; pushed: number }

const monthName = (day: string) =>
  new Date(`${day.slice(0, 7)}-01T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

/** After a page was read for `userId` on `day` ("YYYY-MM-DD"): alert the owner if this page made 200 this month. */
export async function pageReadsAlert(userId: string, day: string, c: AlertConfig): Promise<AlertResult> {
  const none: AlertResult = { pages: 0, alerted: false, emailed: false, pushed: 0 };
  if (!c.serviceKey || !c.supabaseUrl) return none;
  const f = c.fetch ?? fetch;
  const base = c.supabaseUrl.replace(/\/$/, "");
  const headers = { apikey: c.serviceKey, authorization: `Bearer ${c.serviceKey}`, "content-type": "application/json" };

  const r = await f(`${base}/rest/v1/rpc/page_reads_month_alert`, {
    method: "POST", headers, body: JSON.stringify({ p_user: userId, p_day: day, p_threshold: MONTH_SOFT_LIMIT }),
  });
  if (!r.ok) return none;
  const row = ((await r.json().catch(() => null)) as Array<{ pages: number; alert: boolean }> | null)?.[0];
  if (!row?.alert) return { ...none, pages: row?.pages ?? 0 };

  const month = monthName(day);
  let emailed = false;
  if (c.resendKey) {
    const u = await f(`${base}/auth/v1/admin/users/${encodeURIComponent(userId)}`, { headers }).catch(() => null);
    const email = u?.ok ? ((await u.json().catch(() => null)) as { email?: string } | null)?.email ?? "(no email)" : "(couldn't look up)";
    const text = [
      `A Boekenwurm reader has reached ${row.pages} Google page readings in ${month}, the monthly soft limit of ${MONTH_SOFT_LIMIT}.`,
      "",
      `Reader: ${email}`,
      `Account id: ${userId}`,
      "",
      "Nothing has been blocked: the hard limit stays 20 pages a day. This is the only alert for this reader this month.",
      "In Supabase: select * from usage_alerts order by sent_at desc;",
    ].join("\n");
    const e = await f("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${c.resendKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: c.alertFrom || DEFAULT_ALERT_FROM, to: [c.alertTo || DEFAULT_ALERT_EMAIL], subject: `Boekenwurm: a reader reached ${MONTH_SOFT_LIMIT} pages in ${month}`, text }),
    }).catch(() => null);
    emailed = Boolean(e?.ok);
    if (!emailed) console.error(`usage alert: email not sent (${e ? `${e.status} ${(await e.text().catch(() => "")).slice(0, 200)}` : "network"})`);
  }

  let pushed = 0;
  if (c.sendPush) {
    const admins = await f(`${base}/rest/v1/feature_access?feature=eq.admin&select=user_id`, { headers }).catch(() => null);
    const ids = admins?.ok ? ((await admins.json().catch(() => [])) as Array<{ user_id: string }>).map((a) => a.user_id) : [];
    if (ids.length) {
      const s = await f(`${base}/rest/v1/push_subscriptions?select=endpoint,user_id,p256dh,auth&user_id=in.(${ids.join(",")})`, { headers }).catch(() => null);
      const subs = s?.ok ? ((await s.json().catch(() => [])) as PushSub[]) : [];
      const payload = JSON.stringify({ title: "Boekenwurm: 200 pages", body: `A reader reached ${MONTH_SOFT_LIMIT} page readings in ${month}. Details by email.`, tag: "usage-alert", path: "" });
      for (const sub of subs) {
        const status = await c.sendPush(sub, payload).catch(() => 500);
        if (status >= 200 && status < 300) pushed++;
      }
    }
  }
  return { pages: row.pages, alerted: true, emailed, pushed };
}
