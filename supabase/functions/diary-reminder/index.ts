// Supabase Edge Function entry point (Deno). The logic is in handler.ts. Deployed by .github/workflows/publish.yml
// with --no-verify-jwt: it is called by the weekly workflow with the cron secret, never by readers.
import webpush from "npm:web-push@3.6.7";
import { handle, type Subscription } from "./handler.ts";

const subject = Deno.env.get("VAPID_SUBJECT") || "mailto:privacy@boekenwurm.app";
webpush.setVapidDetails(subject, Deno.env.get("VAPID_PUBLIC_KEY") ?? "", Deno.env.get("VAPID_PRIVATE_KEY") ?? "");

async function send(s: Subscription, payload: string): Promise<number> {
  try {
    const r = await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 2 * 24 * 3600, urgency: "low" });
    return r.statusCode;
  } catch (e) {
    return (e as { statusCode?: number }).statusCode ?? 500;
  }
}

Deno.serve((req) =>
  handle(req, {
    supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
    serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    cronSecret: Deno.env.get("CRON_SECRET") ?? "",
    send,
  }),
);
