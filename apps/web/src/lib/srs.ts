/**
 * Flashcard scheduling with FSRS (the algorithm modern Anki uses), via ts-fsrs. Cards are stored as plain data
 * with millisecond times, matching the `cards` table.
 */
import { createEmptyCard, fsrs, Rating as R, type Card, type Grade } from "ts-fsrs";
import type { CardState } from "./types.ts";

export type Rating = "again" | "hard" | "good" | "easy";
const GRADE: Record<Rating, Grade> = { again: R.Again, hard: R.Hard, good: R.Good, easy: R.Easy };

const scheduler = fsrs({ enable_fuzz: false });

export function newCard(lemma: string, at: number): CardState {
  return fromCard(lemma, createEmptyCard(new Date(at)), at);
}

function fromCard(lemma: string, c: Card, at: number): CardState {
  return {
    lemma,
    due: c.due.getTime(),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsedDays: c.elapsed_days,
    scheduledDays: c.scheduled_days,
    learningSteps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state,
    lastReview: c.last_review ? c.last_review.getTime() : null,
    updatedAt: at,
    dirty: true,
  };
}

function toCard(c: CardState): Card {
  return {
    due: new Date(c.due),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsedDays,
    scheduled_days: c.scheduledDays,
    learning_steps: c.learningSteps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state,
    last_review: c.lastReview ? new Date(c.lastReview) : undefined,
  };
}

export function review(c: CardState, rating: Rating, at: number): CardState {
  return fromCard(c.lemma, scheduler.next(toCard(c), new Date(at), GRADE[rating]).card, at);
}

/** When each answer would bring the card back, for the buttons ("10 min", "3 days"). */
export function preview(c: CardState, at: number): Record<Rating, string> {
  const out = {} as Record<Rating, string>;
  for (const r of Object.keys(GRADE) as Rating[]) out[r] = span(scheduler.next(toCard(c), new Date(at), GRADE[r]).card.due.getTime() - at);
  return out;
}

export function span(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h`;
  const d = Math.round(h / 24);
  if (d < 31) return `${d} ${d === 1 ? "day" : "days"}`;
  const mo = Math.round(d / 30);
  return `${mo} mo`;
}

/** A card from a `cards` row (server). Fields the table doesn't keep are derived. */
export function fromRow(row: {
  lemma: string; due: string; stability: number | null; difficulty: number | null; reps: number; lapses: number;
  state: number; last_review: string | null; updated_at: string;
}): CardState {
  const due = Date.parse(row.due);
  const last = row.last_review ? Date.parse(row.last_review) : null;
  return {
    lemma: row.lemma,
    due,
    stability: row.stability ?? 0,
    difficulty: row.difficulty ?? 0,
    elapsedDays: 0,
    scheduledDays: last ? Math.max(0, Math.round((due - last) / 86400000)) : 0,
    learningSteps: 0,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state,
    lastReview: last,
    updatedAt: Date.parse(row.updated_at),
    dirty: false,
  };
}
