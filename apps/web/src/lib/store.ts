/**
 * App state: one small store that React reads with useSyncExternalStore. Every change is written to the device
 * store first (local-first), marked dirty, and picked up by the sync when the reader is signed in.
 */
import type { GameState } from "./hexbound.ts";
import { useSyncExternalStore } from "react";
import * as E from "@boekenwurm/engine";
import type { CefrLevel, Session } from "@boekenwurm/engine";
import { db } from "./db.ts";
import { commonWords, isCommonWord, isImportedListWord, setDictionary, setWordLists, wordLists as currentLists } from "./words.ts";
import { localDay } from "./usage.ts";
import { loadDictionary } from "./dictionary.ts";
import { hasKey } from "./claude.ts";
import { newCard, upgradeCard } from "./cards.ts";
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
  type WordListSource,
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
  /** The reader's imported word lists (kept on this device), for the Words tab. */
  wordLists: WordListInfo[];
  user: { id: string; email: string | null } | null;
  sync: SyncState;
  hasKey: boolean;
  /** The open dictionary: undefined while loading, null when this build has none. */
  dictionary: { words: number; forms: number; built: string; attribution: string } | null | undefined;
  /** Google Translate lookups today (lib/usage.ts). */
  translations: { day: string; used: number; limit: number } | null;
  /** Features this reader has through an access code (lib/features.ts). */
  features: string[];
  /** Google page readings today (lib/features.ts). */
  pageReads: { day: string; used: number; limit: number } | null;
  /** The secret Hex-bound Collector game (lib/hexbound.ts), kept on this device until the character dies. */
  game: GameState | null;
  /** An app is connected (lib/connections.ts): only then is active reading time measured. PRELAUNCH-REMOVE. */
  appsConnected: boolean;
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
  wordLists: [],
  user: null,
  sync: { status: "off", lastAt: null, error: null },
  hasKey: false,
  dictionary: undefined,
  translations: null,
  features: [],
  appsConnected: false,
  pageReads: null,
  game: null,
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

/** A list's card in the Words tab: everything but its words. */
export interface WordListInfo {
  id: string;
  name: string;
  source: WordListSource;
  added: number;
  size: number;
}
const infoOf = (l: WordList): WordListInfo => ({ id: l.id ?? "textbook", name: l.name, source: l.source ?? "textbook", added: l.added ?? 0, size: Object.keys(l.entries).length });

export async function init(): Promise<void> {
  const [profile, stored, wordbook, meanings, examples, cards, oldList, savedLists] = await Promise.all([
    db.get<Profile>("kv", "profile"),
    db.all<Book>("books"),
    db.get<WordBook>("kv", "wordbook"),
    db.get<Record<string, Meaning>>("kv", "meanings"),
    db.get<Record<string, string>>("kv", "examples"),
    db.get<Record<string, CardState>>("kv", "cards"),
    db.get<WordList>("kv", "wordlist"),
    db.get<WordList[]>("kv", "wordlists"),
  ]);
  setState({ game: (await db.get<GameState>("kv", "hexbound")) ?? null });
  // One list (the textbook's) was kept before the Words tab; it becomes the first of the lists.
  const lists = savedLists ?? (oldList ? [{ ...oldList, id: "textbook", source: "textbook" as const }] : []);
  if (stored.some((b) => b.id === LEGACY_SAMPLE_ID)) await Promise.all([db.del("books", LEGACY_SAMPLE_ID), db.del("texts", LEGACY_SAMPLE_ID)]);
  setWordLists(lists);
  setState({
    ready: true,
    profile: profile ? { ...freshProfile(), ...profile, settings: { ...DEFAULT_SETTINGS, ...profile.settings, models: { ...DEFAULT_SETTINGS.models, ...profile.settings?.models } } } : freshProfile(),
    books: sortBooks(stored.filter((b) => b.id !== LEGACY_SAMPLE_ID)),
    wordbook: wordbook ?? {},
    meanings: meanings ?? {},
    examples: examples ?? {},
    // Cards saved before the review pool (FSRS) are converted once, on load.
    cards: Object.fromEntries(Object.entries(cards ?? {}).map(([k, c]) => [k, upgradeCard(c, Date.now())])),
    wordLists: lists.map(infoOf),
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
  /** Read in unlimited lookup mode: words not tapped don't count towards "learned". */
  lookupMode?: boolean;
  /** A turn of the Hex-bound Collector game: its words join the word book and reviews, but nothing else (no streak, no session row). */
  game?: boolean;
  /** Active reading time in seconds (engine activity.ts), for connected apps. PRELAUNCH-REMOVE (docs/PRELAUNCH.md). */
  activeSeconds?: number;
  /** The level of the text read (the matched level in match mode, else the book's level) and the reader's rank then. */
  textLevel?: E.CefrLevel | null;
  readerRank?: string | null;
}

/**
 * Fold a finished (or abandoned) session into everything that lasts: the word book and its deltas for the server,
 * flashcards for every word revealed, the streak-token count, and the session row for the server.
 */
export async function recordFinished(f: FinishedSession): Promise<{ list: E.StudyItem[]; offer: boolean }> {
  const t = now();
  const s = f.session;
  const wordbook = E.applySession(state.wordbook, s, t, { lookupMode: f.lookupMode });
  const list = E.studyList(s, wordbook);

  // What this session adds, for word_stats on the server (counters are added there, never overwritten).
  const mine = E.applySession({}, s, t, { lookupMode: f.lookupMode });
  const deltas = (await db.get<Record<string, WordDelta>>("kv", "wordDeltas")) ?? {};
  for (const w of Object.values(mine)) {
    const d = deltas[w.lemma] ?? { reveals: 0, encounters: 0, lastRevealed: null, example: null };
    deltas[w.lemma] = {
      reveals: d.reveals + w.reveals,
      encounters: d.encounters + w.encounters,
      lastRevealed: Math.max(d.lastRevealed ?? 0, w.lastRevealed ?? 0) || null,
      example: d.example ?? f.sentences[w.lemma] ?? null,
      recent: [...(d.recent ?? []), ...(w.recent ?? [])],
      untapped: (d.untapped ?? 0) + (w.untapped ?? 0),
    };
  }

  const examples = { ...state.examples };
  for (const [lemma, sentence] of Object.entries(f.sentences)) examples[lemma] ??= sentence;

  const cards = { ...state.cards };
  for (const item of list) if (!cards[item.lemma]) cards[item.lemma] = newCard(item.lemma, t);

  const before = state.profile.progress;
  // Ranks rise with XP now (lib/play.ts), so the old level-up offer is never made.
  const progress = { ...E.recordSession(before, s, t).progress, offer: null };
  const offer = false;

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
    // PRELAUNCH-REMOVE (docs/PRELAUNCH.md): the three fields for connected apps.
    active_seconds: Math.max(0, Math.min(86400, Math.round(f.activeSeconds ?? 0))),
    text_level: f.textLevel ?? null,
    reader_rank: f.readerRank ?? null,
  };
  const outbox = ((await db.get<SessionRow[]>("kv", "sessionOutbox")) ?? []).concat(f.game ? [] : [row]);

  setState({ wordbook, examples, cards });
  await Promise.all([
    db.put("kv", wordbook, "wordbook"),
    db.put("kv", deltas, "wordDeltas"),
    db.put("kv", examples, "examples"),
    db.put("kv", cards, "cards"),
    db.put("kv", outbox, "sessionOutbox"),
  ]);
  if (progress !== before && !f.game) await updateProfile((p) => ({ ...p, progress }));
  else changed();
  return { list, offer };
}

/** A streak token is recorded the moment it is earned, not only when the session ends. */
export async function recordToken(s: Session): Promise<boolean> {
  const before = state.profile.progress;
  const r = E.recordSession(before, s, now());
  if (r.earned) await updateProfile((p) => ({ ...p, progress: { ...r.progress, offer: null } }));
  return false;
}

// ---------------------------------------------------------------- words and cards

/** Meanings the reader's account keeps (word_meanings): found by Google or Claude, or typed by the reader. */
export const SAVED_SOURCES: ReadonlyArray<Meaning["from"]> = ["translation", "claude", "manual"];

export async function saveMeaning(lemma: string, m: Meaning, opts: { sync?: boolean } = {}): Promise<void> {
  const have = state.meanings[lemma];
  // A meaning the reader typed is theirs; Claude's (in a sentence) beats a bare translation.
  if (have?.from === "manual" && m.from !== "manual") return;
  if (have?.from === "claude" && m.from !== "claude" && m.from !== "manual") return;
  const meanings = { ...state.meanings, [lemma]: m };
  setState({ meanings });
  await db.put("kv", meanings, "meanings");
  if (opts.sync !== false && SAVED_SOURCES.includes(m.from)) {
    const dirty = new Set((await db.get<string[]>("kv", "meaningsDirty")) ?? []);
    dirty.add(lemma);
    await db.put("kv", [...dirty], "meaningsDirty");
    changed();
  }
}

/** Meanings from the reader's account (another device), without marking them changed here. */
export async function adoptMeanings(incoming: Record<string, Meaning>, keepLocal: Set<string>): Promise<void> {
  const meanings = { ...state.meanings };
  for (const [lemma, m] of Object.entries(incoming)) if (!keepLocal.has(lemma)) meanings[lemma] = m;
  setState({ meanings });
  await db.put("kv", meanings, "meanings");
}

/**
 * A flashcard answered: Hard, Medium, Easy or Skip (packages/engine/src/review.ts). A new common word has no card
 * until its first answer. Answers in a review set count towards today's 90 (`inSet`); a recap's don't.
 */
export async function reviewCard(lemma: string, a: E.Answer, o: { inSet?: boolean } = {}): Promise<void> {
  const t = now();
  const fresh = !state.cards[lemma];
  if (fresh && !o.inSet) return;
  const c = state.cards[lemma] ?? newCard(lemma, t);
  if (o.inSet) noteReviewed(lemma, fresh);
  const cards = { ...state.cards, [lemma]: { ...E.answer(c, a, t), updatedAt: t, dirty: true } };
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

async function putWordLists(lists: WordList[]): Promise<void> {
  setWordLists(lists);
  await db.put("kv", lists, "wordlists");
  await db.del("kv", "wordlist");
  setState({ wordLists: lists.map(infoOf) });
}

/** Add an imported list (or replace the one with the same id). */
export async function saveWordList(list: WordList): Promise<void> {
  const withId: WordList = { ...list, id: list.id ?? crypto.randomUUID(), added: list.added ?? now() };
  await putWordLists([...currentLists().filter((l) => (l.id ?? "textbook") !== withId.id), withId]);
}

export async function removeWordList(id: string): Promise<void> {
  await putWordLists(currentLists().filter((l) => (l.id ?? "textbook") !== id));
}

/** Is the word on one of the reader's lists: an imported one, or the common words once added? */
export const onWordList = (lemma: string): boolean => isImportedListWord(lemma) || (state.profile.settings.commonWords === true && isCommonWord(lemma));

/** Where a word on a list stands: not met yet, seen, tapped; its colour; learned. */
export const listStatus = (lemma: string, at = now()): E.ListWordStatus => E.listWordStatus(state.wordbook[lemma], state.cards[lemma], at);

/** Words the reader knows: their word list plus words met often and rarely revealed. */
export function knownLemmas(listLemmas: string[]): Set<string> {
  const known = new Set(listLemmas);
  for (const w of Object.values(state.wordbook)) if (w.encounters >= 3 && E.revealRate(w) < 0.5) known.add(w.lemma);
  return known;
}

/** A word from a list put into the review pool by hand (as Medium), before it was ever tapped. */
export async function addToReview(lemma: string): Promise<void> {
  if (state.cards[lemma]) return unskipCard(lemma);
  await setCards({ ...state.cards, [lemma]: newCard(lemma, now()) });
  changed();
}

/** A skipped word brought back into the pool. */
export async function unskipCard(lemma: string): Promise<void> {
  const c = state.cards[lemma];
  if (!c) return;
  const t = now();
  await setCards({ ...state.cards, [lemma]: { ...E.unskip(c, t), updatedAt: t, dirty: true } });
  changed();
}

// ---------------------------------------------------------------- today's reviews (REVIEW_DAY in the engine)

const REVIEWED = "boekenwurm-reviewed-today";
const today = () => localDay(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");

/** Cards answered in review sets today on this device, and which of them were new words. */
function reviewedToday(): { day: string; lemmas: string[]; fresh: string[] } {
  try {
    const r = JSON.parse(localStorage.getItem(REVIEWED) ?? "null") as { day: string; lemmas: string[]; fresh: string[] } | null;
    if (r?.day === today()) return r;
  } catch {
    /* storage unavailable: start the day afresh */
  }
  return { day: today(), lemmas: [], fresh: [] };
}

function noteReviewed(lemma: string, fresh: boolean): void {
  const r = reviewedToday();
  if (r.lemmas.includes(lemma)) return;
  r.lemmas.push(lemma);
  if (fresh) r.fresh.push(lemma);
  try {
    localStorage.setItem(REVIEWED, JSON.stringify(r));
  } catch {
    /* counted for this session only */
  }
}

/** Everything the engine needs to shape today's reviews. */
function day(at = now()): E.DayInput {
  const r = reviewedToday();
  // New words: the common words (once added) with no card yet and not learned, most common first.
  const newWords: string[] = [];
  if (state.profile.settings.commonWords)
    for (const w of commonWords()) {
      if (newWords.length >= 60) break;
      if (!state.cards[w] && !E.listWordStatus(state.wordbook[w], undefined, at).learned) newWords.push(w);
    }
  const since = at - E.REVIEW_DAY.recentDays * 86400000;
  return {
    cards: Object.values(state.cards), now: at, reviewedToday: r.lemmas.length, newToday: r.fresh.length, newWords, onList: onWordList,
    tappedRecently: (l) => (state.wordbook[l]?.recent ?? []).some((t) => t >= since),
  };
}

/** Different cards answered in review sets today (towards the 90). */
export const reviewedTodayCount = (): number => reviewedToday().lemmas.length;

/** Cards due today: at most 90 a day, new words included. */
export const dueToday = (): number => E.dueToday(day());
/** Cards in the pool beyond today's 90, for the days after. */
export const waitingAfterToday = (): number => E.waitingAfterToday(day());
/** The next review set (the reader's set size, or what's left of today's 90). */
export const planReviewSet = (): E.ReviewPlan => E.planSet(day(), E.clampSetSize(state.profile.settings.reviewSetSize));

/** The review pool in order: word-list words rated Hard or Medium first, then Hard, Medium, and Easy check-backs that are due. */
export const dueCards = (at = now()): CardState[] => E.reviewOrder(Object.values(state.cards), at, onWordList) as CardState[];
