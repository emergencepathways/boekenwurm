/**
 * Rules for meanings that don't come straight from the dictionary. No I/O, no aliases, so they are tested in Node
 * (test/meaning.test.ts).
 *
 * A tap only counts (a strike, a word to study) when a real meaning is found: the open dictionary, then Google
 * Translate, then the word split into two dictionary words (a Dutch compound), then Claude with the reader's key.
 * If none of them finds one, the tap is free.
 */

const letters = (s: string) => s.normalize("NFC").toLowerCase().replace(/[^\p{L}]+/gu, "");

/**
 * A translation is useful when it says something: not empty, made of words, and not the Dutch word handed back
 * unchanged (what a translator does with a name, a typo or a word it doesn't know).
 */
export function isUsefulTranslation(source: string, translated: string | null | undefined): boolean {
  if (!translated) return false;
  const t = translated.trim();
  if (!t || t.length > 80 || !/\p{L}/u.test(t)) return false;
  return letters(t) !== letters(source);
}

/** Linking letters between the parts of a Dutch compound: stad-s-bus, boek-en-kast, panne-koek. */
const LINKS = ["", "s", "en", "e"];

export interface Compound {
  /** Base form of each part, as the dictionary knows it. */
  left: string;
  right: string;
}

/**
 * Split a Dutch compound into two words the dictionary knows, so "fietsenstalling" reads as fiets + stalling and
 * "boekenkast" as boek + kast. `known` returns a word's base form when the dictionary knows it, otherwise null.
 * Each part must be at least 3 letters (the head, on the right, at least 4), so short accidental words don't count.
 * The longest head wins: in Dutch the last part carries the meaning.
 */
export function splitCompound(word: string, known: (w: string) => string | null): Compound | null {
  const w = word.toLowerCase();
  if (w.length < 7 || /[^\p{L}]/u.test(w)) return null;
  for (let i = 3; i <= w.length - 4; i++) {
    const right = known(w.slice(i));
    if (!right) continue;
    const head = w.slice(0, i);
    for (const link of LINKS) {
      if (link && !head.endsWith(link)) continue;
      const stem = link ? head.slice(0, -link.length) : head;
      if (stem.length < 3) continue;
      const left = known(stem);
      if (left) return { left, right };
    }
  }
  return null;
}
