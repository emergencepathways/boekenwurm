// Supabase Edge Function entry point (Deno). The logic is in handler.ts. Deployed by .github/workflows/publish.yml
// with --no-verify-jwt. The VAPID key pair is generated once by that workflow straight into the project's secrets.
import { sendPush } from "../_shared/webpush.ts";
import { handle } from "./handler.ts";

Deno.serve((req) =>
  handle(req, {
    supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
    serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    cronSecret: Deno.env.get("CRON_SECRET") ?? "",
    publicKey: Deno.env.get("VAPID_PUBLIC_KEY") ?? "",
    send: (s, payload) => sendPush(s, payload),
  }),
);
