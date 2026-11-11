/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  /** Google Cloud Translation key, restricted to this site and the Translation API (see lib/translate.ts). */
  readonly VITE_GOOGLE_TRANSLATE_KEY?: string;
}
declare const __BUILD_ID__: string;
