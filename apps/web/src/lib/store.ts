/**
 * App state: one small store that React reads with useSyncExternalStore. Every change is written to the device
 * store first (local-first), marked dirty, and picked up by the sync when the reader is signed in.
 */
import { useSyncExternalStore } from "react";
import * as E from "@boekenwurm/engine";
import type { CefrLevel, Session } from "@boekenwurm/engine";
import { db } from "./db.ts";
import { setDictionary, setWordList } from "./words.ts";
import { loadDictionary } from "./dictionary.ts";
import { hasKey } from "./claude.ts";
import { newCard, type Rating, review } from "./srs.ts";
import {
  DEFAULT_SETTINGS,
  type Book,
  type BookText,
  type CardState,
  type Meaning,
  type Profile,
  type SessionRow,
  type WordBook,
  type WordDelta,
  type WordList,
} from "./types.ts";

export interface SyncState {
  status: "off" | "idle" | "syncing" | "error" | "offline";
  lastAt: number | null;
  error: string | null;
}

export interface State {
  ready: boolean;
  profile: Profile;
  books: Book[];
  wordbook: WordBook;
  meanings: Record<string, Meaning>;
  examples: Record<string, string>;
  cards: Record<string, CardState>;
  wordList: { name: string; size: number } | null;
  user: { id: string; email: string | null } | null;
  sync: SyncState;
  hasKey: boolean;
  /** The open dictionary: undefined while loading, null when this build has none. */
  dictionary: { words: number; forms: number; built: string; attribution: string } | null | undefined;
}

const now = () => Date.now();

function freshProfile(level: CefrLevel = "A1"): Profile {
  return { displayName: null, settings: DEFAULT_SETTINGS, progress: E.startProgress(level, now()), updatedAt: 0, dirty: false, onboarded: false };
}

let state: State = {
  ready: false,
  profile: freshProfile(),
  books: [],
  wordbook: {},
  meanings: {},
  examples: {},
  cards: {},
  wordList: null,
  user: null,
  sync: { status: "off", lastAt: null, error: null },
  hasKey: false,
  dictionary: undefined,
};

const listeners = new Set<() => void>();
export const getState = (): State => state;
export function setState(patch: Partial<State>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => select(state));
}

// The sync listens for this; changes are pushed a few seconds later in one go.
const changed = () => window.dispatchEvent(new Event("boekenwurm:changed"));

const sortBooks = (books: Book[]) => [...books].sort((a, b) => b.updatedAt - a.updatedAt);

// ---------------------------------------------------------------- start

/** An earlier version of the app preloaded a sample story under this id; it is removed from devices on start. */
const LEGACY_SAMPLE_ID = "sample";

export async function init(): Promise<void> {
  const [profile, stored, wordbook, meanings, examples, cards, list] = await Promise.all([
    db.get<Profile>("kv", "profile"),
    db.all<Book>("books"),
    db.get<WordBook>("kv", "wordbook"),
    db.get<Record<string, Meaning>>("kv", "meanings"),
    db.get<Record<string, string>>("kv", "examples"),
    db.get<Record<string, CardState>>("kv", "cards"),
    db.get<WordList>("kv", "wordlist"),
  ]);
  if (stored.some((b) => b.id === LEGACY_SAMPLE_ID)) await Promise.all([db.del("books", LEGACY_SAMPLE_ID), db.del("texts", LEGACY_SAMPLE_ID)]);
  setWordList(list ?? null);
  setState({
    ready: true,
    profile: profile ? { ...freshProfile(), ...profile, settings: { ...DEFAULT_SETTINGS, ...profile.settings, models: { ...DEFAULT_SETTINGS.models, ...profile.settings?.models } } } : freshProfile(),
    books: sortBooks(stored.filter((b) => b.id !== LEGACY_SAMPLE_ID)),
    wordbook: wordbook ?? {},
    meanings: meanings ?? {},
    examples: examples ?? {},
    cards: cards ?? {},
    wordList: list ? { name: list.name, size: Object.keys(list.entries).length } : null,
    hasKey: hasKey(),
  });
  window.addEventListener("boekenwurm:key", () => setState({ hasKey: hasKey() }));
  // The open dictionary loads in the background; reading works without it and gains meanings once it's in.
  void loadDictionary().then((d) => {
    setDictionary(d);
    setState({ dictionary: d ? { words: Object.keys(d.lemmas).length, forms: Object.keys(d.forms).length, built: d.built, attribution: d.attribution } : null });
  });
}

// ---------------------------------------------------------------- profile

export async function updateProfile(fn: (p: Profile) => Profile, opts: { sync?: boolean } = {}): Promise<void> {
  const p = { ...fn(state.profile), updatedAt: now(), dirty: opts.sync !== false };
  setState({ profile: p });
  await db.put("kv", p, "profile");
  if (opts.sync !== false) changed();
}

/** Replace the profile with the server's copy (sync). */
export async function adoptProfile(p: Profile): Promise<void> {
  setState({ profile: p });
  await db.put("kv", p, "profile");
}

// ---------------------------------------------------------------- books

export const bookById = (id: string) => state.books.find((b) => b.id === id) ?? null;

export async function saveBook(book: Book, opts: { sync?: boolean; touch?: boolean } = {}): Promise<Book> {
  const b: Book = { ...book, updatedAt: opts.touch === false ? book.updatedAt : now(), dirty: opts.sync !== false ? true : book.dirty };
  setState({ books: sortBooks([...state.books.filter((x) => x.id !== b.id), b]) });
  await db.put("books", b);
  if (b.dirty && opts.sync !== false) changed();
  return b;
}

/** Store a book from the server without marking it changed here. */
export async function adoptBook(b: Book): Promise<void> {
  setState({ books: sortBooks([...state.books.filter((x) => x.id !== b.id), b]) });
  await db.put("books", b);
}

export const loadText = (bookId: string) => db.get<BookText>("texts", bookId);
export const saveText = (t: BookText) => db.put("texts", t);
export const loadCover = (bookId: string) => db.get<Blob>("blobs", `cover:${bookId}`);
export const saveCover = (bookId: string, blob: Blob) => db.put("blobs", blob, `cover:${bookId}`);

export async function deleteBook(id: string): Promise<void> {
  setState({ books: state.books.filter((b) => b.id !== id) });
  // Everything of the book on this device: its text, cover, page photos and their readings, cached adaptations.
  await Promise.all([
    db.del("books", id), db.del("texts", id), db.del("blobs", `cover:${id}`), db.delPrefix("blobs", `page:${id}:`),
    db.del("kv", `pages:${id}`), db.delPrefix("cache", `m|${id}|`),
  ]);
  const gone = ((await db.get<string[]>("kv", "deletedBooks")) ?? []).concat(id);
  await db.put("kv", gone, "deletedBooks");
  changed();
}

// ---------------------------------------------------------------- reading sessions

export interface FinishedSession {
  session: Session;
  book: Book;
  startedAt: number;
  endedBy: SessionRow["ended_by"];
  /** lemma -> the sentence it was revealed in */
  sentences: Record<string, string>;
}

/**
 * Fold a finished (or abandoned) session into everything that lasts: the word book and its deltas for the server,
 * flashcards for every word revealed, the streak-token count, and the session row for the server.
 */
export async function recordFinished(f: FinishedSession): Promise<{ list: E.StudyItem[]; offer: boolean }> {
  const t = now();
  const s = f.session;
  const wordbook = E.applySession(state.wordbook, s, t);
  const list = E.studyList(s, wordbook);

  // What this session adds, for word_stats on the server (counters are added there, never overwritten).
  const mine = E.applySession({}, s, t);
  const deltas = (await db.get<Record<string, WordDelta>>("kv", "wordDeltas")) ?? {};
  for (const w of Object.values(mine)) {
    const d = deltas[w.lemma] ?? { reveals: 0, encounters: 0, lastRevealed: null, example: null };
    deltas[w.lemma] = {
      reveals: d.reveals + w.reveals,
      encounters: d.encounters + w.encounters,
      lastRevealed: Math.max(d.lastRevealed ?? 0, w.lastRevealed ?? 0) || null,
      example: d.example ?? f.sentences[w.lemma] ?? null,
    };
  }

  const examples = { ...state.examples };
  for (const [lemma, sentence] of Object.entries(f.sentences)) examples[lemma] ??= sentence;

  const cards = { ...state.cards };
  for (const item of list) if (!cards[item.lemma]) cards[item.lemma] = newCard(item.lemma, t);

  const before = state.profile.progress;
  const progress = E.recordSession(before, s, t).progress;
  const offer = Boolean(progress.offer && !before.offer);

  const row: SessionRow = {
    id: s.id,
    book_id: f.book.id,
    started_at: new Date(f.startedAt).toISOString(),
    ended_at: new Date(t).toISOString(),
    preset: state.profile.settings.preset,
    level: state.profile.progress.level,
    paragraphs: s.results.length,
    best_streak: s.bestStreak,
    token_earned: s.tokenEarned,
    ended_by: f.endedBy,
    results: s.results,
  };
  const outbox = ((await db.get<SessionRow[]>("kv", "sessionOutbox")) ?? []).concat(row);

  setState({ wordbook, examples, cards });
  await Promise.all([
    db.put("kv", wordbook, "wordbook"),
    db.put("kv", deltas, "wordDeltas"),
    db.put("kv", examples, "examples"),
    db.put("kv", cards, "cards"),
    db.put("kv", outbox, "sessionOutbox"),
  ]);
  if (progress !== before) await updateProfile((p) => ({ ...p, progress }));
  else changed();
  return { list, offer };
}

/** A streak token is recorded the moment it is earned, not only when the session ends. */
export async function recordToken(s: Session): Promise<boolean> {
  const before = state.profile.progress;
  const r = E.recordSession(before, s, now());
  if (r.earned) await updateProfile((p) => ({ ...p, progress: r.progress }));
  return Boolean(r.progress.offer && !before.offer);
}

// ---------------------------------------------------------------- words and cards

export async function saveMeaning(lemma: string, m: Meaning): Promise<void> {
  if (state.meanings[lemma]?.from === "claude" && m.from !== "claude") return;
  const meanings = { ...state.meanings, [lemma]: m };
  setState({ meanings });
  await db.put("kv", meanings, "meanings");
}

export async function reviewCard(lemma: string, rating: Rating): Promise<void> {
  const c = state.cards[lemma];
  if (!c) return;
  const cards = { ...state.cards, [lemma]: review(c, rating, now()) };
  setState({ cards });
  await db.put("kv", cards, "cards");
  changed();
}

export async function setCards(cards: Record<string, CardState>): Promise<void> {
  setState({ cards });
  await db.put("kv", cards, "cards");
}

export async function setWordbook(wordbook: WordBook): Promise<void> {
  setState({ wordbook });
  await db.put("kv", wordbook, "wordbook");
}

export async function importWordList(list: WordList | null): Promise<void> {
  setWordList(list);
  if (list) await db.put("kv", list, "wordlist");
  else await db.del("kv", "wordlist");
  setState({ wordList: list ? { name: list.name, size: Object.keys(list.entries).length } : null });
}

/** Words the reader knows: their word list plus words met often and rarely revealed. */
export function knownLemmas(listLemmas: string[]): Set<string> {
  const known = new Set(listLemmas);
  for (const w of Object.values(state.wordbook)) if (w.encounters >= 3 && E.revealRate(w) < 0.5) known.add(w.lemma);
  return known;
}

export const dueCards = (at = now()) =>
  Object.values(state.cards)
    .filter((c) => c.due <= at)
    .sort((a, b) => a.due - b.due);
