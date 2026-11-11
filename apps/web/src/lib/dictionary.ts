/**
 * The open Dutch dictionary (Wiktionary + wordfreq, CC BY-SA 4.0), built at deploy time by
 * `python -m boekenwurm_ingest dictionary` and served as /dict/nl.json. Loaded in the background on start and
 * kept by the service worker, so meanings work offline after the first visit. Without it (local development
 * before a build), the app still runs: words just have no dictionary meaning.
 */
export interface Dictionary {
  v: 1;
  lang: "nl";
  built: string;
  attribution: string;
  /** lemma -> [English meaning, article or null, part of speech, Zipf frequency × 10] */
  lemmas: Record<string, [string, "de" | "het" | null, string, number]>;
  /** inflected form -> lemma */
  forms: Record<string, string>;
}

export function isDictionary(x: unknown): x is Dictionary {
  const d = x as Dictionary;
  return Boolean(d && d.v === 1 && d.lemmas && typeof d.lemmas === "object" && d.forms && typeof d.forms === "object");
}

export async function loadDictionary(): Promise<Dictionary | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}dict/nl.json`);
    if (!res.ok) return null;
    const data: unknown = await res.json();
    return isDictionary(data) ? data : null;
  } catch {
    return null;
  }
}
