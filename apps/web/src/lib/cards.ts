/**
 * Flashcards as the device and the `cards` table keep them. The rules (pool, answers, sets) are the engine's
 * (packages/engine/src/review.ts); this file converts between the device, the table, and cards saved before the
 * review pool replaced FSRS scheduling.
 */
import * as E from "@boekenwurm/engine";
import type { CardState } from "./types.ts";

export const newCard = (lemma: string, at: number): CardState => ({ ...E.newReviewCard(lemma, at), updatedAt: at, dirty: true });

/** A card saved by an older version (FSRS): one already known and not due yet starts as Easy; the rest as Medium. */
export function upgradeCard(c: CardState | (Record<string, unknown> & { lemma: string; due: number }), at: number): CardState {
  if ("pool" in c && c.pool) return c as CardState;
  const old = c as { lemma: string; due: number; state?: number; reps?: number; lapses?: number; lastReview?: number | null; updatedAt?: number };
  const known = old.state === 2 && old.due > at;
  return {
    lemma: old.lemma, pool: known ? "easy" : "medium", due: known ? old.due : at, easyStep: 0, easySince: known ? (old.lastReview ?? at) : null,
    reps: old.reps ?? 0, lapses: old.lapses ?? 0, lastReview: old.lastReview ?? null, updatedAt: old.updatedAt ?? at, dirty: true,
  };
}

export interface CardRow {
  lemma: string;
  due: string;
  reps: number;
  lapses: number;
  state: number;
  last_review: string | null;
  updated_at: string;
  /** Migration 0008; absent before it runs. */
  pool?: E.Pool | null;
  easy_step?: number | null;
  /** Migration 0009. */
  easy_since?: string | null;
}

export function fromRow(row: CardRow): CardState {
  const due = Date.parse(row.due);
  const card = {
    lemma: row.lemma, due, reps: row.reps, lapses: row.lapses, state: row.state,
    lastReview: row.last_review ? Date.parse(row.last_review) : null, updatedAt: Date.parse(row.updated_at),
  };
  if (row.pool) {
    // Before 0009 an Easy card has no easy_since: count from its last review.
    const easySince = row.easy_since ? Date.parse(row.easy_since) : row.pool === "easy" ? (card.lastReview ?? card.updatedAt) : null;
    return { lemma: row.lemma, pool: row.pool, due, easyStep: row.easy_step ?? 0, reps: row.reps, lapses: row.lapses, lastReview: card.lastReview, easySince, updatedAt: card.updatedAt, dirty: false };
  }
  return { ...upgradeCard(card, Date.now()), updatedAt: card.updatedAt, dirty: false };
}

/** Which newer columns the table has: 2 with 0009 (easy_since), 1 with 0008 (pool, easy_step), 0 before. */
export type CardColumns = 0 | 1 | 2;

/** The row to upsert, with the columns the table has. */
export function toRow(c: CardState, userId: string, cols: CardColumns = 2) {
  return {
    user_id: userId, lemma: c.lemma, due: new Date(c.due).toISOString(), reps: c.reps, lapses: c.lapses,
    // The FSRS columns are no longer used; state 2 keeps older app versions from treating the card as new.
    state: 2, stability: null, difficulty: null,
    last_review: c.lastReview ? new Date(c.lastReview).toISOString() : null,
    ...(cols >= 1 ? { pool: c.pool, easy_step: c.easyStep } : {}),
    ...(cols >= 2 ? { easy_since: c.easySince ? new Date(c.easySince).toISOString() : null } : {}),
  };
}

/** "in 3 days", for the Study tab. */
export function inWords(ms: number): string {
  const d = Math.round(ms / 86400000);
  if (d <= 0) return "today";
  if (d === 1) return "tomorrow";
  if (d < 31) return `in ${d} days`;
  return `in ${Math.round(d / 30)} ${Math.round(d / 30) === 1 ? "month" : "months"}`;
}
