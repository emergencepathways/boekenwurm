// Supabase Edge Function entry point (Deno). The logic is in handler.ts.
// Deployed by .github/workflows/publish.yml with --no-verify-jwt: the reader's token is checked by the database when
// claim_translation runs as them (handler.ts), which works with Supabase's new JWT signing keys.
import { handle } from "./handler.ts";

Deno.serve((req) =>
  handle(req, {
    supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
    supabaseKey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    googleKey: Deno.env.get("GOOGLE_TRANSLATE_KEY") ?? "",
  }),
);
