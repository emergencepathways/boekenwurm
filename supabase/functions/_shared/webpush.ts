// Web Push for the Deno entries (index.ts), with the VAPID key pair the deploy workflow generated into the project's
// secrets. Not imported by the handlers, which stay plain TypeScript tested under Node.
import webpush from "npm:web-push@3.6.7";

const subject = Deno.env.get("VAPID_SUBJECT") || "mailto:contact@emergencepathways.org";
webpush.setVapidDetails(subject, Deno.env.get("VAPID_PUBLIC_KEY") ?? "", Deno.env.get("VAPID_PRIVATE_KEY") ?? "");

export const vapidReady = Boolean(Deno.env.get("VAPID_PUBLIC_KEY") && Deno.env.get("VAPID_PRIVATE_KEY"));

/** Send one push; returns the push service's HTTP status (404/410: the address is gone). */
export async function sendPush(s: { endpoint: string; p256dh: string; auth: string }, payload: string, urgency: "low" | "normal" = "low"): Promise<number> {
  try {
    const r = await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 2 * 24 * 3600, urgency });
    return r.statusCode;
  } catch (e) {
    return (e as { statusCode?: number }).statusCode ?? 500;
  }
}
