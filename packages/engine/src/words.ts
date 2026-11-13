/**
 * Word statistics: reveals versus encounters.
 *
 * A reveal is a tap that shows the definition. An encounter is the word
 * appearing in a paragraph the reader finished. A word revealed in most of
 * the paragraphs it turns up in is "not sticking"; a word met often and
 * rarely revealed is on its way to being known.
 */
import type { Session } from "./session.ts";

export interface WordStats {
  lemma: string;
  reveals: number;
  encounters: number;
  firstSeen: number | null;
  lastRevealed: number | null;
  /** When the word was revealed in the last RECENT_DAYS days (ms), for the colour-coded text. */
  recent?: number[];
}

const DAY = 24 * 60 * 60 * 1000;
/** The window the colour-coded text counts reveals in. */
export const RECENT_DAYS = 14;

/** Reveal times still inside the window ending at `now`, oldest first. */
export function keepRecent(times: number[], now: number): number[] {
  return times.filter((t) => t > now - RECENT_DAYS * DAY && t <= now).sort((a, b) => a - b);
}

export type WordBook = Record<string, WordStats>;

/** Fold a finished session into the lifetime word book (returns a new object). */
export function applySession(book: WordBook, s: Session, now: number): WordBook {
  const out: WordBook = { ...book };
  const touch = (lemma: string): WordStats =>
    (out[lemma] = out[lemma] ? { ...out[lemma] } : { lemma, reveals: 0, encounters: 0, firstSeen: now, lastRevealed: null });
  for (const [lemma, n] of Object.entries(s.encounters)) touch(lemma).encounters += n;
  for (const r of s.reveals) {
    const w = touch(r.lemma);
    w.reveals += 1;
    w.lastRevealed = Math.max(w.lastRevealed ?? 0, r.at);
    w.recent = [...(w.recent ?? []), r.at];
  }
  for (const w of Object.values(out)) if (w.recent) w.recent = keepRecent(w.recent, now);
  return out;
}

export type WordColor = "green" | "yellow" | "red";

/**
 * Colour-coded text (a reader setting): how often a word had to be revealed in the last 14 days, shown before it is
 * tapped. Never revealed: no colour. Revealed before, and at most 3 times in the window: green; 4 to 6: yellow; 7 or
 * more: red. `extra` adds reveals not yet in the word book (the session being read).
 */
export function wordColor(w: WordStats | undefined, now: number, extra: number[] = []): WordColor | null {
  if (!(w && w.reveals > 0) && !extra.length) return null;
  // Older records (before reveal times were kept) count their last reveal, if it is recent.
  const times = w?.recent ?? (w?.lastRevealed != null ? [w.lastRevealed] : []);
  const n = keepRecent([...times, ...extra], now).length;
  return n <= 3 ? "green" : n <= 6 ? "yellow" : "red";
}

/** Share of encounters in which the word had to be revealed (0 when never met). */
export function revealRate(w: WordStats): number {
  return w.encounters ? Math.min(1, w.reveals / w.encounters) : 0;
}

/** Words that keep coming up and keep being revealed, worst first. */
export function notSticking(book: WordBook, minEncounters = 3, minRate = 0.5): WordStats[] {
  return Object.values(book)
    .filter((w) => w.encounters >= minEncounters && revealRate(w) >= minRate)
    .sort((a, b) => revealRate(b) - revealRate(a) || b.reveals - a.reveals || a.lemma.localeCompare(b.lemma));
}

export interface StudyItem {
  lemma: string;
  /** Forms tapped in this session ("liep", "gelopen"). */
  forms: string[];
  /** Reveals of this word in the session. */
  sessionReveals: number;
  /** Reveals of this word over all sessions, including this one. */
  lifetimeReveals: number;
  revealRate: number;
}

/**
 * The end-of-session summary that leads straight into flashcards: every word
 * revealed in the session, the ones revealed most often over time first.
 * Pass the word book *after* applySession so lifetime counts include today.
 */
export function studyList(s: Session, book: WordBook): StudyItem[] {
  const byLemma = new Map<string, { forms: Set<string>; n: number }>();
  for (const r of s.reveals) {
    const e = byLemma.get(r.lemma) ?? { forms: new Set<string>(), n: 0 };
    e.forms.add(r.surface);
    e.n += 1;
    byLemma.set(r.lemma, e);
  }
  return [...byLemma.entries()]
    .map(([lemma, e]) => {
      const w = book[lemma];
      return {
        lemma,
        forms: [...e.forms],
        sessionReveals: e.n,
        lifetimeReveals: w?.reveals ?? e.n,
        revealRate: w ? revealRate(w) : 1,
      };
    })
    .sort((a, b) => b.lifetimeReveals - a.lifetimeReveals || b.revealRate - a.revealRate || a.lemma.localeCompare(b.lemma));
}
