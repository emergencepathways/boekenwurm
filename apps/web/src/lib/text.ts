/**
 * Text handling shared by every way a book gets in: language per paragraph, the old-spelling check, tap tokens
 * and the import verdict. A port of the playtest (and a mirror of services/ingest), kept pure so it is tested
 * in Node (test/text.test.ts).
 */

// ---------------------------------------------------------------- language

const NL = new Set(
  "de het een en van ik je jij niet dat op te zijn met voor maar er ook naar wat hij zij we wij ze mijn nog bij uit om aan dit deze wordt werd kan moet wil geen veel heel hoe waar wie omdat hebben heeft hun jullie haar zich zo dan toen al nu wel".split(" "),
);
const EN = new Set(
  "the and of to a that it with for you he she they this are have not but what which from by be at would there their his her was were been has had will can do does said".split(" "),
);
const DE = new Set(
  "der und ist nicht ich sie das ein eine mit auf sich auch dem zu den es war für von wird aber noch nach wie wenn nur oder bei sind hat haben werden".split(" "),
);

const WORD_RE = /\p{L}+(?:['’-]\p{L}+)*/gu;
export const wordsOf = (t: string): string[] => t.match(WORD_RE) ?? [];

export interface LanguageGuess {
  lang: "nl" | "en" | "de" | "und";
  /** Dutch with English or German mixed in: a line with its translation, common in learner books. */
  mixed: boolean;
  words: number;
}

export function langOf(text: string): LanguageGuess {
  const ws = wordsOf(text).map((w) => w.toLowerCase());
  const s = { nl: 0, en: 0, de: 0 };
  for (const w of ws) {
    if (NL.has(w)) s.nl++;
    if (EN.has(w)) s.en++;
    if (DE.has(w)) s.de++;
  }
  const best = (Object.keys(s) as Array<keyof typeof s>).sort((a, b) => s[b] - s[a])[0];
  const mixed = s.en + s.de >= 2 && s.en + s.de >= 0.35 * Math.max(s.nl, 1);
  return { lang: s[best] ? best : "und", mixed, words: ws.length };
}

// ---------------------------------------------------------------- pre-1955 spelling

const OLD = new Set(
  "zoo zooals zoodra zoowel zoolang oogen oogenblik oogenblikje ooren groote grooter grootste loopen koopen rooken hooren boomen noodig heeren eenen eener eenige eenigen eenigszins leeren deelen beenen steenen meenen weenen keeren veele vreezen leezen mensch menschen menschelijk visch vleesch tusschen wensch wenschen engelsch fransch duitsch hollandsch nederlandsch frisch valsch wasch eene mijne uwe hunne onzen dezen welken zijnen haren zeide thans alsdan gaarne zóó zyn myn wy zy hy tyd blyven schryven ryk".split(" "),
);

export function isOldForm(word: string): boolean {
  const w = word.toLowerCase();
  return OLD.has(w) || (w.length >= 5 && w.endsWith("sch") && !w.endsWith("isch") && !["bosch", "esch", "marsch"].includes(w));
}

// ---------------------------------------------------------------- tap tokens

/** A tap token, in the paragraph format of DESIGN.md: `k` is word (counts), name, number or punct. */
export interface Token {
  t: string;
  k: "word" | "name" | "number" | "punct";
  s: number;
  e: number;
}

export type NameTest = (word: string, sentenceStart: boolean) => boolean;

// "'s" (as in 's avonds) belongs to the next word's meaning and is punctuation for counting.
const TOKEN_RE = /((?:'|’)s(?=\s))|(\p{L}+(?:['’-]\p{L}+)*)|(\d+(?:[.,:]\d+)*)|([^\p{L}\d]+)/gu;

export function tokenize(text: string, isName: NameTest): Token[] {
  const out: Token[] = [];
  let start = true;
  TOKEN_RE.lastIndex = 0;
  for (let m: RegExpExecArray | null; (m = TOKEN_RE.exec(text)); ) {
    const s = m.index;
    const e = s + m[0].length;
    if (m[2]) {
      out.push({ t: m[2], k: isName(m[2], start) ? "name" : "word", s, e });
      start = false;
    } else if (m[3]) {
      out.push({ t: m[3], k: "number", s, e });
      start = false;
    } else {
      out.push({ t: m[0], k: "punct", s, e });
      if (/[.!?…:]\s*["'“”‘’»)]*\s*$/.test(m[0])) start = true;
    }
  }
  return out;
}

export const countable = (tokens: Token[]): number => tokens.filter((t) => t.k === "word").length;

/**
 * Names: capitalised mid-sentence and never written in lowercase anywhere in the book. Built once per book
 * from all its paragraphs, so "Bank" at the start of a sentence is still a word when "bank" appears elsewhere.
 */
export function nameTest(paragraphs: string[], extraNames: Iterable<string> = []): NameTest {
  const lower = new Set<string>();
  for (const p of paragraphs) for (const w of wordsOf(p)) if (w[0] === w[0].toLowerCase()) lower.add(w.toLowerCase());
  const known = new Set([...extraNames].map((n) => n.toLowerCase()));
  return (w, start) => known.has(w.toLowerCase()) || (!start && w[0] !== w[0].toLowerCase() && !lower.has(w.toLowerCase()));
}

// ---------------------------------------------------------------- the import check

export type VerdictKind = "accept" | "accept_partial" | "warn_borderline" | "reject_old_spelling" | "reject_not_dutch";

export interface Verdict {
  kind: VerdictKind;
  /** What the reader is told. */
  text: string;
  paragraphs: string[];
  oldPer10k: number;
  dutchShare: number;
}

export const isRejected = (v: Verdict): boolean => v.kind.startsWith("reject");

/**
 * The same check as services/ingest (DESIGN.md, "The import check"): Dutch paragraphs of 8 words or more, mixed
 * Dutch/English lines dropped, and the share of pre-1955 spelling per 10,000 Dutch words.
 */
export function checkBook(blocks: string[]): Verdict {
  let nlWords = 0;
  let allWords = 0;
  const paragraphs: string[] = [];
  for (const raw of blocks) {
    const t = raw.replace(/\s+/g, " ").trim();
    const L = langOf(t);
    if (L.words < 8) continue;
    allWords += L.words;
    if (L.lang === "nl" && !L.mixed) {
      nlWords += L.words;
      paragraphs.push(t);
    }
  }
  const dutch = paragraphs.flatMap(wordsOf);
  const old = dutch.filter(isOldForm);
  const oldPer10k = dutch.length ? Math.round((old.length / dutch.length) * 100000) / 10 : 0;
  const dutchShare = allWords ? nlWords / allWords : 0;
  const counts = new Map<string, number>();
  for (const w of old) counts.set(w.toLowerCase(), (counts.get(w.toLowerCase()) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w, n]) => `${w} ×${n}`).join(", ");
  const base = { paragraphs, oldPer10k, dutchShare };
  if (paragraphs.length < 5)
    return { ...base, kind: "reject_not_dutch", text: `No usable Dutch text: only ${paragraphs.length} Dutch paragraphs of 8 words or more.` };
  if (oldPer10k > 15)
    return {
      ...base,
      kind: "reject_old_spelling",
      text: `This book uses spelling from before 1955 (${oldPer10k} old forms per 10,000 words: ${top}). Reading it would teach forms that are no longer correct.`,
    };
  if (oldPer10k > 5)
    return { ...base, kind: "warn_borderline", text: `Some old spelling (${oldPer10k} per 10,000 words: ${top}). Usable, but watch for old forms.` };
  if (dutchShare < 0.6)
    return {
      ...base,
      kind: "accept_partial",
      text: `A learner book: ${Math.round(dutchShare * 100)}% Dutch. Its ${paragraphs.length} Dutch passages can be used.`,
    };
  return { ...base, kind: "accept", text: `Modern Dutch, ${paragraphs.length} paragraphs.` };
}

// ---------------------------------------------------------------- small helpers

/** The sentence a word was read in: what makes a flashcard useful. */
export function sentenceAround(text: string, word: string): string {
  const parts = text.match(/[^.!?]+[.!?"”]*/g) ?? [text];
  return (parts.find((s) => s.toLowerCase().includes(word.toLowerCase())) ?? text).trim();
}

/** A short stable hash for cache keys (FNV-1a). Not for security. */
export function hash(s: string): string {
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) {
    x ^= s.charCodeAt(i);
    x = Math.imul(x, 16777619);
  }
  return (x >>> 0).toString(36);
}
