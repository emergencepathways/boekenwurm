/**
 * From a tapped word to its base form and meaning.
 *
 * Base forms come from packages/dutch: irregular verbs always, regular inflections when a word list knows the
 * result. Meanings come from, in order: the sample story's glossary, the reader's imported word list, and
 * meanings Claude gave for this word earlier. The open Wiktionary dictionary (ARCHITECTURE.md, "Word lists") will
 * slot in as the default list once its build script exists.
 */
import { createLemmatizer, type IrregularData, type Lemmatizer } from "@boekenwurm/dutch";
import irregularJson from "@data/nl/irregular-verbs.json";
import sample from "virtual:sample-story";
import type { Meaning, WordList } from "./types.ts";

const IRREGULAR = irregularJson as unknown as IrregularData;

/** form -> [lemma, English, Dutch explanation] */
const SAMPLE_GLOSSARY = sample.glossary as Record<string, [string, string, string]>;

let lemmatizer: Lemmatizer = createLemmatizer(IRREGULAR);
let list: WordList | null = null;

/** Rebuild the base-form finder when the word list changes (its words make regular forms safe to undo). */
export function setWordList(next: WordList | null): void {
  list = next;
  const lexicon = new Set<string>(next ? Object.keys(next.entries) : []);
  for (const [lemma] of Object.values(SAMPLE_GLOSSARY)) lexicon.add(lemma.toLowerCase());
  lemmatizer = createLemmatizer(IRREGULAR, lexicon);
}
setWordList(null);

export interface Lookup {
  lemma: string;
  meaning: Meaning | null;
}

export function lookup(surface: string, opts: { sample?: boolean; meanings?: Record<string, Meaning> } = {}): Lookup {
  const w = surface.toLowerCase();
  if (opts.sample) {
    const g = SAMPLE_GLOSSARY[w];
    if (g) return { lemma: g[0].toLowerCase(), meaning: { en: g[1], nl: g[2], from: "sample" } };
  }
  const lemma = lemmatizer.lemma(w);
  const e = list?.entries[lemma];
  if (e?.gloss) return { lemma, meaning: { en: e.gloss, nl: null, article: e.article, from: "list" } };
  return { lemma, meaning: opts.meanings?.[lemma] ?? null };
}

/** The meaning for a flashcard's back, from any source. */
export function meaningOf(lemma: string, meanings: Record<string, Meaning>): Meaning | null {
  const e = list?.entries[lemma];
  if (e?.gloss) return { en: e.gloss, nl: null, article: e.article, from: "list" };
  if (meanings[lemma]) return meanings[lemma];
  const g = Object.values(SAMPLE_GLOSSARY).find(([l]) => l.toLowerCase() === lemma);
  return g ? { en: g[1], nl: g[2], from: "sample" } : null;
}

export const listInfo = () => (list ? { name: list.name, size: Object.keys(list.entries).length } : null);

/** The reader's known words: the word list plus words met often and rarely revealed. */
export function listLemmas(): string[] {
  return list ? Object.keys(list.entries) : [];
}

/**
 * Read a word list file. Accepts wordlist.json from the textbook tool (`python -m boekenwurm_ingest textbook`),
 * which stays on the reader's device; nothing from it ships with the app.
 */
export function parseWordList(name: string, raw: string): WordList {
  const data = JSON.parse(raw) as unknown;
  if (!Array.isArray(data) || !data.length || typeof (data[0] as { base?: unknown }).base !== "string")
    throw new Error("This doesn't look like wordlist.json from the textbook tool.");
  const entries: WordList["entries"] = {};
  for (const e of data as Array<Record<string, unknown>>) {
    if (typeof e.base !== "string" || !e.base) continue;
    entries[e.base.toLowerCase()] = {
      gloss: typeof e.gloss === "string" ? e.gloss : null,
      article: e.article === "de" || e.article === "het" ? e.article : null,
      chapter: typeof e.chapter === "number" ? e.chapter : null,
    };
  }
  if (!Object.keys(entries).length) throw new Error("No words found in this file.");
  return { name, entries };
}
