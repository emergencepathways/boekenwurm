/**
 * From a tapped word to its base form and meaning.
 *
 * Base forms, in order: the open dictionary's form table (Wiktionary: liep -> lopen, huizen -> huis), then
 * packages/dutch (irregular verbs always, regular inflections when a known word results). Meanings, in order: the
 * reader's own imported word list (their textbook), the open dictionary, and meanings Claude gave for this word
 * in a sentence earlier.
 */
import { createLemmatizer, type IrregularData, type Lemmatizer } from "@boekenwurm/dutch";
import irregularJson from "@data/nl/irregular-verbs.json";
import type { Dictionary } from "./dictionary.ts";
import { splitCompound } from "./meaning.ts";
import type { Meaning, WordList } from "./types.ts";

const IRREGULAR = irregularJson as unknown as IrregularData;

let lemmatizer: Lemmatizer = createLemmatizer(IRREGULAR);
let lists: WordList[] = [];
/** Every imported list's entries in one map (the first list to have a word gives its meaning). */
let entries: WordList["entries"] = {};
let dict: Dictionary | null = null;
/** The common-words list: the open dictionary's words, most common first (wordfreq), up to 5,000. */
export const COMMON_WORDS = 5000;
let common: string[] = [];
let commonSet = new Set<string>();

function rebuild(): void {
  const lexicon = new Set<string>(Object.keys(entries));
  if (dict) for (const w of Object.keys(dict.lemmas)) lexicon.add(w);
  lemmatizer = createLemmatizer(IRREGULAR, lexicon);
}

/** The reader's imported word lists changed (their words make regular forms safe to undo). */
export function setWordLists(next: WordList[]): void {
  lists = next;
  entries = {};
  for (const l of lists) for (const [w, e] of Object.entries(l.entries)) entries[w] ??= e;
  rebuild();
}

export const wordLists = (): readonly WordList[] => lists;

export function setDictionary(next: Dictionary | null): void {
  dict = next;
  common = dict ? Object.keys(dict.lemmas).slice(0, COMMON_WORDS) : [];
  commonSet = new Set(common);
  rebuild();
}

export const commonWords = (): readonly string[] => common;
/** The open dictionary as loaded (null before it arrives, or in a build without one). */
export const dictionaryData = (): Dictionary | null => dict;
export const isCommonWord = (lemma: string): boolean => commonSet.has(lemma);
/** Is the word on one of the reader's imported lists? */
export const isImportedListWord = (lemma: string): boolean => lemma in entries;

export interface Lookup {
  lemma: string;
  meaning: Meaning | null;
}

export function baseForm(surface: string): string {
  const w = surface.toLowerCase();
  if (entries[w]) return w;
  return dict?.forms[w] ?? (dict?.lemmas[w] ? w : lemmatizer.lemma(w));
}

export function lookup(surface: string, opts: { meanings?: Record<string, Meaning> } = {}): Lookup {
  const lemma = baseForm(surface);
  return { lemma, meaning: meaningOf(lemma, opts.meanings ?? {}) };
}

/** The meaning for a tapped word or a flashcard's back, from any source. */
export function meaningOf(lemma: string, meanings: Record<string, Meaning>): Meaning | null {
  const e = entries[lemma];
  if (e?.gloss) return { en: e.gloss, nl: null, article: e.article, from: "list" };
  const d = dict?.lemmas[lemma];
  if (d) return { en: d[0], nl: meanings[lemma]?.nl ?? null, article: d[1], from: "dictionary" };
  return meanings[lemma] ?? null;
}

/** A dictionary word's base form, or null when neither the dictionary nor the reader's word list knows it. */
function knownBase(w: string): string | null {
  if (entries[w]) return w;
  if (dict?.lemmas[w]) return w;
  const f = dict?.forms[w];
  return f && dict?.lemmas[f] ? f : null;
}

/**
 * A meaning for a Dutch compound the dictionary doesn't list, from its two parts: "fietsenstalling" ->
 * "fiets (bicycle) + stalling (storage)". Null when it doesn't split into two known words.
 */
export function compoundMeaning(surface: string): Meaning | null {
  const c = splitCompound(surface, knownBase);
  if (!c) return null;
  const gloss = (w: string) => (entries[w]?.gloss ?? dict?.lemmas[w]?.[0] ?? "").split(/[;,]/)[0].trim();
  const [l, r] = [gloss(c.left), gloss(c.right)];
  if (!l || !r) return null;
  return { en: `${c.left} (${l}) + ${c.right} (${r})`, nl: null, article: dict?.lemmas[c.right]?.[1] ?? null, from: "compound" };
}

/** Words on the reader's imported lists (their textbook, course lists): taken as known when matching a book's level. */
export function listLemmas(): string[] {
  return Object.keys(entries);
}

/** Does the dictionary know this word (as a word or a form of one)? Used to find the Dutch column in an import. */
export const isDutchWord = (w: string): boolean => knownBase(w.toLowerCase()) != null;

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
