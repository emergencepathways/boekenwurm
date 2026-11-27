/**
 * The app gate's state and its steps (docs/APP_GATE.md; rules in rules.ts, the reader's own cards in decks.ts).
 *
 * Privacy by design (the owner's decisions, 2026-11-27):
 * - Which apps are gated, how often each one opened the gate, the gate's settings and the reader's own cards are kept
 *   **only on this device** (IndexedDB, `kv` key `appGate`), never synced or uploaded. Counts older than 30 days go.
 * - The app's name reaches the page after "#" (`/#gate=TikTok`): browsers don't send that part, so it never reaches
 *   Cloudflare's or Supabase's logs.
 * - The unlock time lives in a file the reader's own Shortcut keeps in their iCloud Drive; Boekenwurm never sees it.
 * - What the reader learns at the gate (paragraphs read, Boekenwurm flashcards answered) is recorded like any reading
 *   and review, in the tables Boekenwurm already keeps, and so is covered by its export and erase.
 */
import { useSyncExternalStore } from "react";
import { pagesFinished } from "@boekenwurm/books";
import type * as E from "@boekenwurm/engine";
import { db } from "../lib/db.ts";
import { localDay } from "../lib/usage.ts";
import { bookText } from "../lib/hexbound.ts";
import { getState, saveBook } from "../lib/store.ts";
import type { Book, Paragraph } from "../lib/types.ts";
import * as R from "./rules.ts";
import * as D from "./decks.ts";

export interface GateApp {
  name: string;
  /** The app's own link ("tiktok://"), to reopen it after a passed review. Optional. */
  link: string | null;
}

export interface GateSettings {
  apps: GateApp[];
  /** The quick review's length in minutes (5–10). */
  quickMinutes: number;
  reading: R.ReadingRules;
  sources: { reading: boolean; reviews: boolean; myCards: boolean };
  /** Show the reader's own cards as multiple choice when their deck has enough answers. */
  multipleChoice: boolean;
  /** One shared Shortcut (iOS 27+) or the hand-built pair (iOS 26 and earlier): decides the unlock link. */
  shortcut: R.ShortcutSetup;
}

/** Whether the phone side works: the Shortcut's test called back, and when the gate last opened from it. */
export interface GateCheck {
  verifiedAt: number | null;
  lastArrival: number | null;
}

export interface GateData {
  v: 1;
  settings: GateSettings;
  log: R.AttemptLog;
  decks: D.Deck[];
  cards: D.GateCard[];
  check: GateCheck;
}

export const DEFAULT_SETTINGS: GateSettings = {
  apps: [],
  quickMinutes: R.QUICK_MINUTES.default,
  reading: "unlimited",
  sources: { reading: true, reviews: true, myCards: true },
  multipleChoice: true,
  shortcut: "single",
};

const KEY = "appGate";
const empty = (): GateData => ({ v: 1, settings: DEFAULT_SETTINGS, log: {}, decks: [], cards: [], check: { verifiedAt: null, lastArrival: null } });
const today = () => localDay(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");

// ---------------------------------------------------------------- the store (its own, so removing the gate touches nothing else)

let data: GateData = empty();
let loaded: Promise<void> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function loadGate(): Promise<void> {
  return (loaded ??= (async () => {
    const saved = await db.get<GateData>("kv", KEY);
    data = saved
      ? {
          ...empty(),
          ...saved,
          settings: {
            ...DEFAULT_SETTINGS,
            ...saved.settings,
            sources: { ...DEFAULT_SETTINGS.sources, ...saved.settings?.sources },
            // Set up before the shared Shortcut (2026-11-27): the two Shortcuts built by hand.
            shortcut: saved.settings?.shortcut ?? (saved.settings?.apps?.length ? "pair" : "single"),
          },
          check: { ...empty().check, ...saved.check },
        }
      : empty();
    data = { ...data, log: R.prune(data.log, today()) };
    emit();
  })());
}

async function save(next: GateData): Promise<void> {
  data = next;
  emit();
  await db.put("kv", data, KEY);
}

export const getGate = (): GateData => data;

export function useGate<T>(select: (d: GateData) => T): T {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => void listeners.delete(l)),
    () => select(data),
  );
}

export const updateSettings = (fn: (s: GateSettings) => GateSettings) => save({ ...data, settings: fn(data.settings) });

/** Forget everything of the gate on this device: apps, counts, settings and the reader's own cards. */
export async function deleteGateData(): Promise<void> {
  data = empty();
  emit();
  await db.del("kv", KEY);
}

// ---------------------------------------------------------------- where the reader is: the gate, its setup, or neither

export type Route = { kind: "gate"; app: string } | { kind: "setup" } | null;

let route: Route = null;
let cameFromTestFlag = false;
/** This visit came from the Shortcut's test ("#gate-setup=ok"): the setup shows its last step, "It works". */
export const cameFromTest = (): boolean => cameFromTestFlag;
const routeListeners = new Set<() => void>();

function readRoute(): void {
  const hash = location.hash;
  const app = R.gateAppFromHash(hash);
  const setup = R.setupHash(hash);
  cameFromTestFlag = Boolean(setup?.verified);
  const next: Route = app ? { kind: "gate", app } : setup ? { kind: "setup" } : null;
  // The Shortcut's test called back ("#gate-setup=ok"): the phone side works. The address drops the "=ok" so a
  // reload doesn't count as a test.
  if (setup?.verified) {
    history.replaceState(history.state, "", `${location.pathname}${location.search}#gate-setup`);
    void loadGate().then(() => markVerified());
  }
  const opened = next?.kind === "gate" && !(route?.kind === "gate" && route.app === next.app);
  route = next;
  routeListeners.forEach((l) => l());
  // Counted once per arrival from the Shortcut (here, not in a component, so a re-render never counts twice).
  if (opened && next?.kind === "gate") void loadGate().then(() => noteShown(next.app));
}

if (typeof window !== "undefined") {
  readRoute();
  window.addEventListener("hashchange", readRoute);
}

export function useGateRoute(): Route {
  return useSyncExternalStore(
    (l) => (routeListeners.add(l), () => void routeListeners.delete(l)),
    () => route,
  );
}

/** Back to Boekenwurm: drop the "#gate…" part of the address. */
export function leaveGate(): void {
  history.replaceState(history.state, "", location.pathname + location.search);
  readRoute();
}

export const openSetup = () => void (location.hash = "#gate-setup");

// ---------------------------------------------------------------- counts

function noteShown(app: string): Promise<void> {
  return save({ ...data, log: R.recordShown(R.prune(data.log, today()), today(), app), check: { ...data.check, lastArrival: Date.now() } });
}

function markVerified(): Promise<void> {
  return save({ ...data, check: { ...data.check, verifiedAt: Date.now() } });
}

/** Setting up again (another phone, a new Shortcut): the test has to pass again. */
export const resetCheck = () => save({ ...data, check: { verifiedAt: null, lastArrival: data.check.lastArrival } });

export const notePassed = (app: string): Promise<void> => save({ ...data, log: R.recordPassed(data.log, today(), app) });

export const countsFor = (app: string | undefined, days: number): R.DayCount => R.totals(data.log, today(), days, app);

/** The app's own link, to reopen it; with only one app gated, that one's (the automation may not say which app). */
export function appLink(name: string): string | null {
  const apps = data.settings.apps;
  return apps.find((a) => a.name.toLowerCase() === name.toLowerCase())?.link ?? (apps.length === 1 ? apps[0].link : null);
}

// ---------------------------------------------------------------- the reader's own cards

export async function addDeck(name: string): Promise<D.Deck | null> {
  const n = name.replace(/\s+/g, " ").trim().slice(0, 60);
  if (!n || data.decks.length >= D.LIMITS.decks) return null;
  const deck: D.Deck = { id: crypto.randomUUID(), name: n, added: Date.now() };
  await save({ ...data, decks: [...data.decks, deck] });
  return deck;
}

export const removeDeck = (id: string) => save({ ...data, decks: data.decks.filter((d) => d.id !== id), cards: data.cards.filter((c) => c.deck !== id) });

/** Add pasted cards to a deck; returns how many were new. */
export async function importCards(deck: string, text: string): Promise<number> {
  const fresh = D.addCards(data.cards, deck, D.parseCards(text), Date.now(), () => crypto.randomUUID());
  if (fresh.length) await save({ ...data, cards: [...data.cards, ...fresh] });
  return fresh.length;
}

export async function addCard(deck: string, front: string, back: string): Promise<boolean> {
  const fresh = D.addCards(data.cards, deck, [{ front: front.trim(), back: back.trim() }].filter((p) => p.front && p.back), Date.now(), () => crypto.randomUUID());
  if (fresh.length) await save({ ...data, cards: [...data.cards, ...fresh] });
  return fresh.length > 0;
}

export const removeCard = (id: string) => save({ ...data, cards: data.cards.filter((c) => c.id !== id) });

export async function answerMyCard(id: string, a: E.Answer): Promise<void> {
  const now = Date.now();
  await save({ ...data, cards: data.cards.map((c) => (c.id === id ? D.answerCard(c, a, now) : c)) });
}

// ---------------------------------------------------------------- reading: the next paragraph of the last book read

export interface NextParagraph {
  book: Book;
  ord: number;
  paragraph: Paragraph;
  paragraphs: Paragraph[];
}

/**
 * The paragraph after the reader's place in the book they read last (the one whose place moved most recently), with
 * text on this device or in their account. Null when there is no such book or it is read to the end.
 */
export async function nextParagraph(): Promise<NextParagraph | null> {
  const books = [...getState().books].sort((a, b) => (b.position.at ?? b.updatedAt) - (a.position.at ?? a.updatedAt));
  for (const book of books) {
    const paragraphs = await bookText(book).catch(() => null);
    const ord = book.position.ord;
    if (paragraphs && ord < paragraphs.length && paragraphs[ord]) return { book, ord, paragraph: paragraphs[ord], paragraphs };
    // Only the last book read counts; an older book is used only when the last has no text here or is finished.
  }
  return null;
}

/** The paragraph is read: the reader's place moves on, as if they had turned the page in the reader. */
export async function advancePlace(n: NextParagraph): Promise<void> {
  const b = getState().books.find((x) => x.id === n.book.id);
  if (!b) return;
  const next = n.ord + 1;
  const hasPages = n.paragraphs.some((p) => p.pageNumber != null);
  const pagesRead = hasPages
    ? [...new Set([...b.pagesRead, ...pagesFinished(n.paragraphs.map((p) => ({ text: p.text, pageNumber: p.pageNumber, seqs: [] })), next - 1)])].sort((x, y) => x - y)
    : b.pagesRead;
  await saveBook({ ...b, position: { ...b.position, ord: next, at: Date.now() }, pagesRead });
}
