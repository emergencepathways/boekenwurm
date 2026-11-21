/**
 * The Hex-bound Collector: the secret Mörk Borg game mode (docs/HEXBOUND.md; rules in packages/engine/src/hexbound.ts).
 *
 * It opens when the access-code box gets "Mörk Borg" (checked here on the device, never sent anywhere) and stays open,
 * on this device, even when the app is closed, until the player says their character died. While it is open the app
 * shows only the game. A turn reads one random unread paragraph of a book above the reader's level: its words join
 * the reader's word book and reviews like any reading, but it earns no XP, moves no bookmark and counts for no badge,
 * except the secret one for playing until death.
 */
import * as E from "@boekenwurm/engine";
import { db } from "./db.ts";
import { getState, loadText, setState, updateProfile } from "./store.ts";
import { fetchRemoteText } from "./sync.ts";
import type { Book, Paragraph } from "./types.ts";

export interface TurnWord {
  lemma: string;
  forms: string[];
  meaning: string | null;
}

export interface GameState {
  /** intro: the backstory. journey: the blank book. turn: a page to read. recap: how the turn went. nobook: no book qualifies. */
  phase: "intro" | "journey" | "turn" | "recap" | "nobook";
  /** Turns read so far (the next turn's fouten tighten by this many steps). */
  turn: number;
  /** Paragraphs already shown in this game ("bookId:ord"). */
  used: string[];
  current: { bookId: string; ord: number } | null;
  recap: { passed: boolean; revealed: number; allowed: number; words: TurnWord[] } | null;
}

const KEY = "hexbound";

async function save(game: GameState | null): Promise<void> {
  setState({ game });
  if (game) await db.put("kv", game, KEY);
  else await db.del("kv", KEY);
}

export const startGame = () => save({ phase: "intro", turn: 0, used: [], current: null, recap: null });

const patch = (p: Partial<GameState>) => {
  const g = getState().game;
  return g ? save({ ...g, ...p }) : Promise.resolve();
};

export const toJourney = () => patch({ phase: "journey", recap: null });

/** The text of a book, from this device or, for a book read on another device, from the account. */
export async function bookText(book: Book): Promise<Paragraph[] | null> {
  const local = await loadText(book.id);
  if (local) return local.paragraphs;
  if (!book.textRemote) return null;
  return (await fetchRemoteText(book.id).catch(() => null))?.paragraphs ?? null;
}

/** The books the cursed book can draw from, with their text. */
async function gameBooks(): Promise<E.GameBook[]> {
  const level = getState().profile.progress.level;
  const out: E.GameBook[] = [];
  for (const b of getState().books) {
    if (!E.bookQualifies(b.level, level)) continue;
    const paragraphs = await bookText(b);
    if (paragraphs) out.push({ id: b.id, level: b.level, position: b.position.ord, paragraphs });
  }
  return out;
}

/** Is there a page to read at all? Asked before the journey starts, so a player without a book learns it at once. */
export async function anyPageLeft(): Promise<boolean> {
  const g = getState().game;
  return E.turnCandidates(await gameBooks(), getState().profile.progress.level, new Set(g?.used ?? [])).length > 0;
}

/** The next turn: a random page; with none left, the character dies for want of a book. */
export async function nextTurn(random = Math.random()): Promise<void> {
  const g = getState().game;
  if (!g) return;
  const pick = E.pickTurn(E.turnCandidates(await gameBooks(), getState().profile.progress.level, new Set(g.used)), random);
  if (!pick) return patch({ phase: "nobook", current: null, recap: null });
  return patch({ phase: "turn", current: pick, used: [...g.used, E.turnKey(pick.bookId, pick.ord)], recap: null });
}

/** A turn read: its outcome, for the recap. */
export const endTurn = (recap: NonNullable<GameState["recap"]>) => {
  const g = getState().game;
  return patch({ phase: "recap", recap, turn: (g?.turn ?? 0) + 1, current: null });
};

/**
 * The character died ("I died", "Dead, exit game mode", or no book): back to the app. Playing at least one turn until
 * death earns the secret badge, once; it gives no XP.
 */
export async function die(): Promise<void> {
  const g = getState().game;
  if (g && g.turn > 0) {
    await updateProfile((p) => {
      const play = { ...E.emptyPlay(), ...p.progress.play };
      const secrets = play.secrets ?? [];
      return secrets.includes(E.SECRET_MORK_BORG) ? p : { ...p, progress: { ...p.progress, play: { ...play, secrets: [...secrets, E.SECRET_MORK_BORG] } } };
    });
  }
  await save(null);
}
