/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  /** The weekly diary reminder's public key (Web Push); public by design. Without it, reminders are hidden. */
  readonly VITE_VAPID_PUBLIC_KEY?: string;
  /** LanguageTool server for diary checks; the free public API when unset. */
  readonly VITE_LANGUAGETOOL_URL?: string;
  /** Google Cloud Translation key, restricted to this site and the Translation API (see lib/translate.ts). */
}
declare const __BUILD_ID__: string;
