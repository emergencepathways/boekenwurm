/**
 * Word suggestions while writing in the diary: on the device, from the open dictionary (most common first) and the
 * words the reader has met in their reading, which come first. Nothing is sent anywhere.
 */
export interface Suggestion {
  word: string;
  /** de or het, for nouns. */
  article: "de" | "het" | null;
}

export interface SuggestSource {
  /** Base forms, most common first. */
  lemmas: readonly string[];
  /** Inflected form → base form. */
  forms: Readonly<Record<string, string>>;
  article: (lemma: string) => "de" | "het" | null;
  /** Words the reader has met: suggested first. */
  known?: { has(word: string): boolean };
}

interface Entry {
  word: string;
  rank: number;
  lemma: string;
}

export interface Suggester {
  suggest(prefix: string, n?: number): Suggestion[];
}

export function buildSuggester(src: SuggestSource): Suggester {
  const rankOf = new Map<string, number>();
  src.lemmas.forEach((w, i) => rankOf.set(w, i));
  const entries: Entry[] = src.lemmas.map((w, i) => ({ word: w, rank: i, lemma: w }));
  for (const [form, lemma] of Object.entries(src.forms))
    if (!rankOf.has(form) && rankOf.has(lemma)) entries.push({ word: form, rank: rankOf.get(lemma)! + 0.5, lemma });
  entries.sort((a, b) => (a.word < b.word ? -1 : a.word > b.word ? 1 : 0));
  const score = (e: Entry) => (src.known?.has(e.lemma) || src.known?.has(e.word) ? e.rank - 1e7 : e.rank);

  return {
    suggest(prefix, n = 3) {
      const p = prefix.toLowerCase();
      if (p.length < 2) return [];
      // The first entry at or after the prefix, by binary search; then every entry that starts with it.
      let lo = 0, hi = entries.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (entries[mid].word < p) lo = mid + 1;
        else hi = mid;
      }
      const found: Entry[] = [];
      for (let i = lo; i < entries.length && entries[i].word.startsWith(p) && found.length < 400; i++) if (entries[i].word !== p) found.push(entries[i]);
      const upper = prefix[0] !== prefix[0].toLowerCase();
      return found
        .sort((a, b) => score(a) - score(b))
        .slice(0, n)
        .map((e) => ({ word: upper ? e.word[0].toUpperCase() + e.word.slice(1) : e.word, article: e.word === e.lemma ? src.article(e.lemma) : null }));
    },
  };
}

/** The word being typed: the letters right before the caret. */
export function wordAtCaret(text: string, caret: number): { start: number; word: string } {
  const before = text.slice(0, caret);
  const m = /[\p{L}'’-]+$/u.exec(before);
  return m ? { start: caret - m[0].length, word: m[0] } : { start: caret, word: "" };
}

/** The text with the word at the caret replaced by a suggestion (and a space after it). */
export function applySuggestion(text: string, caret: number, word: string): { text: string; caret: number } {
  const at = wordAtCaret(text, caret);
  const after = text.slice(caret).replace(/^[\p{L}'’-]+/u, "");
  // A space after the word, unless one or a punctuation mark follows already.
  const space = /^[\s.,!?;:)]/.test(after) ? "" : " ";
  const next = text.slice(0, at.start) + word + space + after;
  return { text: next, caret: at.start + word.length + space.length };
}
