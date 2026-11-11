import type { CefrLevel, Preset, Progress, WordBook } from "@boekenwurm/engine";
import type { BookLevel } from "@boekenwurm/ai";
import type { Token, VerdictKind } from "./text.ts";

/** "sample" is in the database enum from the playtest era; the app no longer creates it. */
export type BookSource = "sample" | "epub" | "pdf" | "photo";
export type BookStatus = "processing" | "ready" | "failed" | "archived";
export type ReadMode = "original" | "match";

/** A book as the device keeps it. Field names follow the `books` table; times are milliseconds. */
export interface Book {
  id: string;
  source: BookSource;
  title: string;
  author: string | null;
  isbn: string | null;
  level: CefrLevel | null;
  levelSource: "reader" | "graded" | null;
  scan: (BookLevel & { verdict?: VerdictKind; note?: string }) | null;
  status: BookStatus;
  pageCount: number | null;
  /** Printed page numbers finished (photographed books). */
  pagesRead: number[];
  /** Where the reader is, how they read it, and when they last opened it (for "Continue reading"). */
  position: { ord: number; mode: ReadMode; at?: number };
  paragraphCount: number;
  /** Storage path of the cover once uploaded: covers/{user_id}/{book_id}.jpg */
  coverPath: string | null;
  /** The cover image is in the device store under `cover:{id}`. */
  hasCover: boolean;
  createdAt: number;
  updatedAt: number;
  /** Changed on this device since the last sync. */
  dirty: boolean;
  /** Paragraphs are on the server (false: still to upload). */
  textSynced: boolean;
  /** Paragraphs live on the server only; fetched when the book is opened. */
  textRemote: boolean;
  /** Last photographed seq, so new photos continue the order. */
  nextSeq: number;
}

export interface Paragraph {
  text: string;
  tokens: Token[];
  countable: number;
  pageNumber: number | null;
}

export interface BookText {
  bookId: string;
  paragraphs: Paragraph[];
}

export interface Settings {
  preset: Preset;
  defPref: "en" | "nl";
  models: { match: string; words: string; vision: string };
  /** The free route reads photos on the device even with a key. */
  preferFreeReading: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  preset: "standard",
  defPref: "en",
  models: { match: "claude-sonnet-5-5", words: "claude-sonnet-5-5", vision: "claude-sonnet-5-5" },
  preferFreeReading: false,
};

export interface Profile {
  displayName: string | null;
  settings: Settings;
  progress: Progress;
  updatedAt: number;
  dirty: boolean;
  /** The reader chose a starting level on first run. */
  onboarded: boolean;
}

/** Word counts not yet added on the server (word_stats is merged by adding, never overwritten). */
export interface WordDelta {
  reveals: number;
  encounters: number;
  lastRevealed: number | null;
  example: string | null;
}

/** A meaning shown on a tapped word or a flashcard: from the reader's word list, the open dictionary or Claude. */
export interface Meaning {
  en: string | null;
  nl: string | null;
  article?: string | null;
  from: "list" | "dictionary" | "claude";
}

export interface CardState {
  lemma: string;
  due: number;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  /** 0 new, 1 learning, 2 review, 3 relearning (as in the `cards` table) */
  state: number;
  lastReview: number | null;
  updatedAt: number;
  dirty: boolean;
}

export interface SessionRow {
  id: string;
  book_id: string | null;
  started_at: string;
  ended_at: string;
  preset: string;
  level: CefrLevel;
  paragraphs: number;
  best_streak: number;
  token_earned: boolean;
  ended_by: "strike" | "end_of_book" | "left";
  results: unknown[];
}

/** A reader's own imported word list (e.g. from their textbook). Kept on the device. */
export interface WordList {
  name: string;
  entries: Record<string, { gloss: string | null; article: string | null; chapter: number | null }>;
}

export type { CefrLevel, Progress, WordBook };
