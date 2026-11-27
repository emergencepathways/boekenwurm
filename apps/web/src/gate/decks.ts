/**
 * The reader's own cards for the app gate (docs/APP_GATE.md): any subject, not only Dutch words. Pure: parsing pasted
 * text, picking multiple-choice options with a seeded random, and the review order (the same Hard / Medium / Easy
 * rules as Boekenwurm's flashcards, packages/engine/src/review.ts). Kept only on the device (state.ts).
 */
// The review rules straight from their file (not "@boekenwurm/engine"), so the gate's tests run under plain Node.
import * as E from "../../../../packages/engine/src/review.ts";

export interface Deck {
  id: string;
  name: string;
  added: number;
}

export interface GateCard {
  id: string;
  deck: string;
  front: string;
  back: string;
  added: number;
  /** Its place in the review pool; `lemma` is the card's id. */
  review: E.ReviewCard;
}

/** Limits that keep a paste from filling the phone's storage. */
export const LIMITS = { cardsPerImport: 2000, textLength: 500, decks: 50, cards: 10_000 } as const;

export interface Pair {
  front: string;
  back: string;
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, LIMITS.textLength);

/**
 * Cards from pasted text, one per line: "front<TAB>back" (Quizlet's export and spreadsheets), or "front - back",
 * "front;back", "front,back". The first separator on the line wins, in that order. A header line "term, definition"
 * (or "front, back") and lines without both sides are left out.
 */
export function parseCards(text: string): Pair[] {
  const out: Pair[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const sep = line.includes("\t") ? "\t" : / [-–—] /.test(line) ? / [-–—] / : line.includes(";") ? ";" : line.includes(",") ? "," : null;
    if (!sep) continue;
    const i = typeof sep === "string" ? line.indexOf(sep) : line.search(sep);
    const width = typeof sep === "string" ? sep.length : (line.match(sep)?.[0].length ?? 1);
    const front = clean(line.slice(0, i));
    const back = clean(line.slice(i + width));
    if (!front || !back) continue;
    if (/^(term|front|question|vraag)$/i.test(front) && /^(definition|back|answer|antwoord)$/i.test(back)) continue;
    out.push({ front, back });
    if (out.length >= LIMITS.cardsPerImport) break;
  }
  return out;
}

/** New cards for a deck; a card whose front and back are already in the deck is left out. */
export function addCards(existing: readonly GateCard[], deck: string, pairs: readonly Pair[], now: number, newId: () => string): GateCard[] {
  const seen = new Set(existing.filter((c) => c.deck === deck).map((c) => key(c)));
  const out: GateCard[] = [];
  for (const p of pairs) {
    if (existing.length + out.length >= LIMITS.cards) break;
    const k = key(p);
    if (seen.has(k)) continue;
    seen.add(k);
    const id = newId();
    out.push({ id, deck, front: p.front, back: p.back, added: now, review: E.newReviewCard(id, now) });
  }
  return out;
}
const key = (p: Pair) => `${p.front.toLowerCase()}\u0000${p.back.toLowerCase()}`;

/** The reader's cards due now, in review order (Hard first, then Medium, then Easy check-backs). */
export function dueCards(cards: readonly GateCard[], now: number): GateCard[] {
  const byId = new Map(cards.map((c) => [c.id, c]));
  return E.reviewOrder(cards.map((c) => c.review), now).map((r) => byId.get(r.lemma)!).filter(Boolean);
}

/** A card after an answer. */
export const answerCard = (c: GateCard, a: E.Answer, now: number): GateCard => ({ ...c, review: E.answer(c.review, a, now) });

// ---------------------------------------------------------------- multiple choice

/** A small seeded random (mulberry32), so the same card in the same review shows its options in the same order. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export const CHOICES = 4;

/**
 * Four options for a card: its answer and three other answers from the same deck (different from it, ignoring
 * capitals). Null when the deck has fewer than three other answers: the card is shown as a flashcard instead.
 */
export function choices(card: GateCard, deck: readonly GateCard[], random: () => number): { options: string[]; correct: number } | null {
  const answer = card.back.toLowerCase();
  const others = [...new Set(deck.filter((c) => c.deck === card.deck && c.id !== card.id).map((c) => c.back))].filter((b) => b.toLowerCase() !== answer);
  const unique = others.filter((b, i) => others.findIndex((x) => x.toLowerCase() === b.toLowerCase()) === i);
  if (unique.length < CHOICES - 1) return null;
  const pool = [...unique];
  const picked: string[] = [];
  while (picked.length < CHOICES - 1) picked.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
  const correct = Math.floor(random() * CHOICES);
  const options = [...picked];
  options.splice(correct, 0, card.back);
  return { options, correct };
}

/**
 * A multiple-choice card as a review answer. The reader keeps choosing until they find the answer: right first time
 * is Easy (out of the pool until its check-back), one miss Medium, two or more Hard.
 */
export const choiceAnswer = (misses: number): E.Answer => (misses <= 0 ? "easy" : misses === 1 ? "medium" : "hard");
