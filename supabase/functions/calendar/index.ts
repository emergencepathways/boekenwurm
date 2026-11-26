// Supabase Edge Function entry point (Deno). The logic is in handler.ts. Deployed by .github/workflows/publish.yml
// with --no-verify-jwt: calendar apps fetch it without a sign-in; the secret in the address is the key.
import { handle } from "./handler.ts";

Deno.serve((req) =>
  handle(req, {
    supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
    anonKey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
  }),
);
