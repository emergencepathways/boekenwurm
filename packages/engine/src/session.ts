/**
 * A reading session: paragraphs one after another until a page turn fails
 * the checkpoint. Pure functions over plain data, so the same code runs in
 * the browser, on the server and (later) gets ported to the KOReader plugin.
 *
 * Reveals are counted once per word per paragraph: tapping the same word
 * twice in one paragraph is reading its definition again, not a new mistake.
 * A reveal can be undone within `undoWindowMs` (a mis-tap on a phone).
 */
import { allowanceFor, inStreak, passes, type Allowance, type CheckpointRules } from "./checkpoint.ts";

export interface Reveal {
  /** Base form ("lopen"), which is what the word list and the stats are keyed on. */
  lemma: string;
  /** The form as written in the paragraph ("liep"). */
  surface: string;
  /** Milliseconds since the epoch. */
  at: number;
}

export interface ParagraphRun {
  paragraphId: string;
  countableWords: number;
  /** Lemmas of every countable word in the paragraph (for encounter counts). */
  lemmas: string[];
  allowance: Allowance;
  reveals: Reveal[];
}

export interface ParagraphResult {
  paragraphId: string;
  countableWords: number;
  allowed: number;
  percent: number;
  revealed: number;
  passed: boolean;
}

export interface Session {
  id: string;
  rules: CheckpointRules;
  undoWindowMs: number;
  /** Passed paragraphs in a row that earn this session its streak token (default 10). */
  tokenAtStreak: number;
  /** Paragraphs passed in a row in this session. */
  passesInARow: number;
  /** Longest run of passed paragraphs in this session. */
  bestStreak: number;
  /** True once this session's streak reached `tokenAtStreak`. One token per session at most. */
  tokenEarned: boolean;
  results: ParagraphResult[];
  /** Every reveal of the session, in order. */
  reveals: Reveal[];
  /** Every lemma met in a finished paragraph, with how often. */
  encounters: Record<string, number>;
  current: ParagraphRun | null;
  ended: boolean;
}

export interface SessionOptions {
  /** Unique per session; streak tokens are counted per session id. */
  id?: string;
  undoWindowMs?: number;
  tokenAtStreak?: number;
}

let counter = 0;

export function startSession(rules: CheckpointRules, opts: SessionOptions = {}): Session {
  return {
    id: opts.id ?? `session-${++counter}`,
    rules,
    undoWindowMs: opts.undoWindowMs ?? 5000,
    tokenAtStreak: opts.tokenAtStreak ?? 10,
    passesInARow: 0,
    bestStreak: 0,
    tokenEarned: false,
    results: [],
    reveals: [],
    encounters: {},
    current: null,
    ended: false,
  };
}

export function beginParagraph(s: Session, paragraphId: string, lemmas: string[]): Session {
  if (s.ended) throw new Error("Session has ended");
  if (s.current) throw new Error("Finish the current paragraph with turnPage() first");
  const allowance = allowanceFor(lemmas.length, s.passesInARow, s.rules);
  return { ...s, current: { paragraphId, countableWords: lemmas.length, lemmas, allowance, reveals: [] } };
}

/** Distinct lemmas revealed in the current paragraph. */
export function revealedCount(s: Session): number {
  return s.current ? new Set(s.current.reveals.map((r) => r.lemma)).size : 0;
}

export function reveal(s: Session, r: Reveal): Session {
  const cur = requireCurrent(s);
  if (cur.reveals.some((x) => x.lemma === r.lemma)) return s; // second look, not a new reveal
  return { ...s, current: { ...cur, reveals: [...cur.reveals, r] } };
}

/** Undo a reveal tapped less than `undoWindowMs` ago. Returns the session unchanged otherwise. */
export function undoReveal(s: Session, lemma: string, now: number): Session {
  const cur = requireCurrent(s);
  const r = cur.reveals.find((x) => x.lemma === lemma);
  if (!r || now - r.at > s.undoWindowMs) return s;
  return { ...s, current: { ...cur, reveals: cur.reveals.filter((x) => x !== r) } };
}

/** What the reader sees while reading: allowance, used reveals, whether the streak badge shows. */
export function status(s: Session) {
  const cur = requireCurrent(s);
  return {
    allowed: cur.allowance.allowed,
    percent: cur.allowance.percent,
    used: revealedCount(s),
    /** Strikes left before the last one: 0 means the next reveal fails this paragraph. */
    strikesLeft: Math.max(0, cur.allowance.allowed - revealedCount(s) - (s.rules.failWhen === "reaches" ? 1 : 0)),
    streak: inStreak(s.passesInARow, s.rules) ? s.passesInARow : 0,
    tokenEarned: s.tokenEarned,
  };
}

export type TurnOutcome =
  | { kind: "continue"; session: Session; result: ParagraphResult; tokenEarnedNow: boolean }
  | { kind: "ended"; session: Session; result: ParagraphResult; streakLength: number };

/** The page turn: judge the paragraph, then continue or end the session. */
export function turnPage(s: Session): TurnOutcome {
  const cur = requireCurrent(s);
  const revealed = revealedCount(s);
  const passed = passes(revealed, cur.allowance, s.rules);
  const result: ParagraphResult = {
    paragraphId: cur.paragraphId,
    countableWords: cur.countableWords,
    allowed: cur.allowance.allowed,
    percent: cur.allowance.percent,
    revealed,
    passed,
  };
  const encounters = { ...s.encounters };
  for (const l of cur.lemmas) encounters[l] = (encounters[l] ?? 0) + 1;
  const base = { ...s, results: [...s.results, result], reveals: [...s.reveals, ...cur.reveals], encounters, current: null };
  if (passed) {
    const run = s.passesInARow + 1;
    const tokenEarnedNow = !s.tokenEarned && run >= s.tokenAtStreak;
    return {
      kind: "continue",
      session: { ...base, passesInARow: run, bestStreak: Math.max(s.bestStreak, run), tokenEarned: s.tokenEarned || tokenEarnedNow },
      result,
      tokenEarnedNow,
    };
  }
  return { kind: "ended", session: { ...base, ended: true }, result, streakLength: s.passesInARow };
}

function requireCurrent(s: Session): ParagraphRun {
  if (!s.current) throw new Error("No paragraph in progress");
  return s.current;
}
