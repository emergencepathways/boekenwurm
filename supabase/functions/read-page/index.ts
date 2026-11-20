// Supabase Edge Function entry point (Deno). The logic is in handler.ts.
// Deployed by .github/workflows/publish.yml with --no-verify-jwt: the reader's token is checked by the database when
// claim_page_read runs as them (handler.ts).
import { sendPush, vapidReady } from "../_shared/webpush.ts";
import { handle } from "./handler.ts";

Deno.serve((req) =>
  handle(req, {
    supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
    supabaseKey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    // Provided to every Edge Function by Supabase; used only to give back a page Google couldn't read.
    serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    // A separate key for Vision if set; otherwise the Translate key, with the Cloud Vision API added to its restrictions.
    visionKey: Deno.env.get("GOOGLE_VISION_KEY") || Deno.env.get("GOOGLE_TRANSLATE_KEY") || "",
    // The owner's 200-pages-a-month alert (_shared/alerts.ts): email via Resend if its key is set, and a notification
    // on the owner's phone.
    resendKey: Deno.env.get("RESEND_API_KEY") ?? "",
    alertTo: Deno.env.get("ALERT_EMAIL") ?? "",
    alertFrom: Deno.env.get("ALERT_FROM") ?? "",
    sendPush: vapidReady ? (s, payload) => sendPush(s, payload, "normal") : undefined,
  }),
);
