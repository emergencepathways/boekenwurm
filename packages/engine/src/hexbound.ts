/**
 * The Hex-bound Collector: a secret game mode for the tabletop RPG Mörk Borg (docs/HEXBOUND.md). A player whose
 * character is the Hex-bound Collector reads a page of their cursed book every turn: a random unread paragraph from
 * a book above their reading level. Understood (within the fouten): +2 on every roll that turn. Not understood: −2 on
 * every roll and 2 damage. The fouten shrink with every turn, passed or failed, until the character dies.
 *
 * Pure rules, like the rest of the engine: the app passes in the books, the paragraphs and a random number.
 */
import { allowanceFor, type Allowance, type CheckpointRules } from "./checkpoint.ts";
import { LEVELS } from "./progress.ts";
import type { CefrLevel } from "./definitions.ts";

/** The code that opens the mode, in the access-code box: any capitals, with or without the ö. */
export const GAME_CODE = "mork borg";

export function isGameCode(input: string): boolean {
  const plain = input
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "") // ö → o
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .trim();
  return plain === GAME_CODE;
}

/**
 * The game's fouten (owner, 2026-11-21): 25% on the first turn, 3 points fewer every turn after it, passed or failed,
 * down to 5%; the strike minimum 3, 2, 1, never below 1. The reader's own preset (Strict, Standard, Relaxed) doesn't
 * apply. A harder version (10% down to 0 fouten) may follow.
 */
export const HEXBOUND_RULES: Readonly<CheckpointRules> = {
  basePercent: 25,
  streakStartsAfter: 1,
  stepPercent: 3,
  floorPercent: 5,
  minStrikes: 3,
  minStrikesFloor: 1,
  failWhen: "exceeds",
};

/** The fouten for a turn (0 is the first): the game's tightening runs on turns, not on passes. */
export const turnAllowance = (countableWords: number, turn: number): Allowance =>
  allowanceFor(countableWords, Math.max(0, turn), HEXBOUND_RULES);

/** What the book gives on each turn. */
export const BLESSING = { modifier: 2 } as const;
export const CURSE = { modifier: -2, damage: 2 } as const;

/**
 * A book the cursed book can draw from: at least one level above the reader's reading level, or the same level from
 * B2 up (a C2 reader has nowhere higher to go). Books without a level don't count.
 */
export function bookQualifies(bookLevel: CefrLevel | null | undefined, readerLevel: CefrLevel): boolean {
  if (!bookLevel) return false;
  const b = LEVELS.indexOf(bookLevel), r = LEVELS.indexOf(readerLevel);
  return b >= r + 1 || (r >= LEVELS.indexOf("B2") && b >= r);
}

/** A page of the cursed book must have more than this many words. */
export const MIN_WORDS = 20;

export const wordCount = (text: string): number => text.split(/\s+/).filter((w) => /\p{L}/u.test(w)).length;

export interface GameBook {
  id: string;
  level: CefrLevel | null;
  /** The paragraph the reader is at in normal reading: everything before it has been seen. */
  position: number;
  paragraphs: ReadonlyArray<{ text: string }>;
}

/** A paragraph the game can open: "bookId:ord". */
export const turnKey = (bookId: string, ord: number) => `${bookId}:${ord}`;

/**
 * Every paragraph the cursed book may show: in a qualifying book, not yet seen in normal reading (at or after the
 * reader's place in that book), not shown earlier in this game, and more than 20 words long.
 */
export function turnCandidates(books: readonly GameBook[], readerLevel: CefrLevel, used: ReadonlySet<string>): Array<{ bookId: string; ord: number }> {
  const out: Array<{ bookId: string; ord: number }> = [];
  for (const b of books) {
    if (!bookQualifies(b.level, readerLevel)) continue;
    for (let ord = Math.max(0, b.position); ord < b.paragraphs.length; ord++)
      if (!used.has(turnKey(b.id, ord)) && wordCount(b.paragraphs[ord].text) > MIN_WORDS) out.push({ bookId: b.id, ord });
  }
  return out;
}

/** One of the candidates, chosen by `random` (0 ≤ random < 1, passed in so the rules stay pure). */
export function pickTurn<T>(candidates: readonly T[], random: number): T | null {
  if (!candidates.length) return null;
  return candidates[Math.min(candidates.length - 1, Math.floor(Math.max(0, random) * candidates.length))];
}

/** The secret badge for playing the Hex-bound Collector until the character dies (at least one turn read). */
export const SECRET_MORK_BORG = "mork-borg-enjoyer";
