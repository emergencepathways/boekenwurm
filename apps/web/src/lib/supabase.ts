/**
 * The Supabase client. Both values are public by design (they ship to every browser); row-level security is what
 * keeps each reader's rows and files private. They come from apps/web/.env.local locally and from the repository's
 * Actions secrets in the Pages build. Without them the app still runs, on this device only.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

export const supabase: SupabaseClient | null =
  url && key
    ? createClient(url, key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" },
      })
    : null;

export const supabaseHost = url ? new URL(url).host : null;

/** Where the sign-in link brings the reader back: the app's own address. */
export const appUrl = (): string => new URL(import.meta.env.BASE_URL, location.origin).href;
