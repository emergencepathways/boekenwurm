/**
 * Dutch base forms: liep, loopt, gelopen -> lopen; huizen -> huis; grootste -> groot.
 *
 * Two layers, checked in this order:
 *   1. Irregular verbs from data/nl/irregular-verbs.json, including compounds
 *      with an inseparable prefix (verkocht -> verkopen) or a separable one
 *      (opgestaan -> opstaan). These are certain, so they apply even without
 *      a word list.
 *   2. Regular inflection rules (verbs, plurals, adjectives, comparatives,
 *      diminutives). Rules over-generate, so a candidate is only accepted when
 *      it is in the lexicon: the reader's word list or dictionary.
 * Without a lexicon match the word is returned as written (lowercased).
 *
 * The Python twin is services/ingest/boekenwurm_ingest/lemma.py; both pass
 * data/nl/lemma-cases.json. Server-side, spaCy improves on this and also joins
 * split separable verbs ("belt ... op" -> opbellen), which needs the sentence.
 */

export interface IrregularData {
  verbs: Record<string, string[]>;
  present: Record<string, string[]>;
  inseparable_prefixes: string[];
  separable_prefixes: string[];
}

export interface Lemmatizer {
  lemma(word: string): string;
  /** Every candidate considered, best first (for debugging and tests). */
  candidates(word: string): string[];
}

const VOWELS = "aeiou";
const isVowel = (c: string | undefined) => c !== undefined && VOWELS.includes(c);

/** Undo spelling changes made when an ending was added: zitt -> zit, bom -> boom, huiz -> huis. */
export function restore(x: string): string[] {
  const out: string[] = [];
  const add = (s: string) => {
    if (s.length >= 2 && !out.includes(s)) out.push(s);
  };
  const devoice = (s: string) => s.replace(/z$/, "s").replace(/v$/, "f");
  const n = x.length;
  // double consonant at the end: katt -> kat, dikk -> dik
  if (n >= 3 && x[n - 1] === x[n - 2] && !isVowel(x[n - 1])) add(x.slice(0, -1));
  // single vowel + single consonant, open syllable before the ending: bom -> boom, grot -> groot, lez -> lees
  if (n >= 2 && !isVowel(x[n - 1]) && isVowel(x[n - 2]) && !isVowel(x[n - 3]) && x[n - 2] !== "i") {
    add(devoice(x.slice(0, -1) + x[n - 2] + x[n - 1]));
    add(x.slice(0, -1) + x[n - 2] + x[n - 1]);
  }
  add(devoice(x));
  add(x);
  return out;
}

/** Possible infinitives for a verb stem: loop -> lopen, zit -> zitten, lees -> lezen, ga -> gaan. */
export function infinitives(stem: string): string[] {
  const out: string[] = [];
  const add = (s: string) => {
    if (!out.includes(s)) out.push(s);
  };
  const n = stem.length;
  const voice = (s: string) => s.replace(/s$/, "z").replace(/f$/, "v");
  add(stem + "en");
  if (/[aeiou]$/.test(stem)) add(stem + "n"); // doe -> doen, zie -> zien
  if (stem.endsWith("a")) add(stem + "an"); // ga -> gaan
  if (n >= 3 && isVowel(stem[n - 2]) && stem[n - 2] === stem[n - 3] && !isVowel(stem[n - 1])) {
    const single = stem.slice(0, n - 2) + stem.slice(n - 1); // loop -> lop
    add(single + "en");
    add(voice(single) + "en"); // lees -> lezen, geef -> geven
  }
  if (n >= 2 && !isVowel(stem[n - 1]) && isVowel(stem[n - 2]) && !isVowel(stem[n - 3])) add(stem + stem[n - 1] + "en"); // zit -> zitten
  add(voice(stem) + "en"); // reis -> reizen
  return out;
}

function ruleCandidates(w: string): string[] {
  const out: string[] = [];
  const add = (xs: string[]) => {
    for (const x of xs) if (x && !out.includes(x)) out.push(x);
  };
  const stemForms = (stem: string) => add(infinitives(stem));
  const strip = (suffix: string) => (w.length > suffix.length + 1 && w.endsWith(suffix) ? w.slice(0, -suffix.length) : null);

  // verbs
  for (const suf of ["ten", "den", "te", "de"]) {
    const s = strip(suf);
    if (s) stemForms(s);
  }
  if (w.startsWith("ge") && /[td]$/.test(w) && w.length > 4) stemForms(w.slice(2, -1));
  stemForms(w); // the word itself as a stem first: zit -> zitten, not zi(t) -> zien
  const t = strip("t");
  if (t) stemForms(t);

  // diminutives (before plurals so huisjes -> huisje -> huis works both ways)
  for (const suf of ["etjes", "tjes", "pjes", "kjes", "jes", "etje", "tje", "pje", "kje", "je"]) {
    const s = strip(suf);
    if (s) add(restore(s));
  }
  // plurals and adjective endings
  const en = strip("en");
  if (en) add(restore(en));
  for (const suf of ["'s", "’s", "s"]) {
    const s = strip(suf);
    if (s) add([s]);
  }
  const e = strip("e");
  if (e) add(restore(e));
  // comparatives and superlatives
  for (const suf of ["ere", "er", "ste", "st"]) {
    const s = strip(suf);
    if (s) add(restore(s));
  }
  return out;
}

export function createLemmatizer(data: IrregularData, lexicon?: Iterable<string>): Lemmatizer {
  const lex = lexicon ? new Set([...lexicon].map((x) => x.toLowerCase())) : null;
  const irregular = new Map<string, string>();
  for (const [inf, forms] of Object.entries(data.verbs)) for (const f of forms) if (!irregular.has(f)) irregular.set(f, inf);
  for (const [inf, forms] of Object.entries(data.present)) for (const f of forms) irregular.set(f, inf);
  const insep = [...data.inseparable_prefixes].sort((a, b) => b.length - a.length);
  const sep = [...data.separable_prefixes].sort((a, b) => b.length - a.length);

  function irregularOf(w: string): string | null {
    const direct = irregular.get(w);
    if (direct) return direct;
    for (const p of insep) {
      if (w.startsWith(p) && w.length > p.length + 1) {
        const rest = w.slice(p.length);
        const base = irregular.get(rest) ?? irregular.get("ge" + rest); // verkocht: ver + (ge)kocht
        if (base && !base.startsWith(p)) return p + base;
      }
    }
    for (const p of sep) {
      if (w.startsWith(p) && w.length > p.length + 2) {
        const base = irregular.get(w.slice(p.length));
        if (base) return p + base;
      }
    }
    return null;
  }

  function candidates(word: string): string[] {
    const w = word.toLowerCase();
    const out: string[] = [];
    const irr = irregularOf(w);
    if (irr) out.push(irr);
    out.push(w);
    for (const c of ruleCandidates(w)) if (!out.includes(c)) out.push(c);
    // separable prefix + regular participle: opgeruimd -> op + ruimen
    for (const p of sep) {
      if (w.startsWith(p + "ge") && /[td]$/.test(w)) {
        for (const c of infinitives(w.slice(p.length + 2, -1))) if (!out.includes(p + c)) out.push(p + c);
      }
    }
    return out;
  }

  function lemma(word: string): string {
    const w = word.toLowerCase();
    const irr = irregularOf(w);
    if (irr && (!lex || lex.has(irr) || !lex.has(w))) return irr;
    if (!lex) return w;
    for (const c of candidates(w)) if (lex.has(c)) return c;
    return w;
  }

  return { lemma, candidates };
}
