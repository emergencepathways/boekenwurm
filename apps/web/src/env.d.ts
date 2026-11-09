/// <reference types="vite/client" />

declare module "virtual:sample-story" {
  const sample: {
    title: string;
    level: string;
    names: string[];
    /** form -> [lemma, English, Dutch explanation] */
    glossary: Record<string, [string, string, string]>;
    paragraphs: string[];
  };
  export default sample;
}

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}
