import { useEffect, useState, type ReactNode } from "react";
import { bookProgress } from "@boekenwurm/books";
import { LEVELS, type CefrLevel, type Progress } from "@boekenwurm/engine";
import { loadCover } from "./lib/store.ts";
import type { Book } from "./lib/types.ts";

// ---------------------------------------------------------------- icons (drawn for Boekenwurm, 24px grid)

const I = ({ children, label }: { children: ReactNode; label?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden={!label} aria-label={label}>
    {children}
  </svg>
);
export const Icon = {
  home: () => <I><path d="M4 11.5 12 5l8 6.5" /><path d="M6 10v9h12v-9" /><path d="M10 19v-5h4v5" /></I>,
  study: () => <I><rect x="4" y="6" width="13" height="14" rx="2" /><path d="M8 3h10a2 2 0 0 1 2 2v12" /><path d="M8 13h5" /></I>,
  words: () => <I><path d="M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" /><path d="M5 17a3 3 0 0 1 3-3h10" /><path d="M9 8h5" /></I>,
  me: () => <I><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20c1.2-3.6 4-5.5 7-5.5s5.8 1.9 7 5.5" /></I>,
  epub: () => <I><path d="M6 3h9l4 4v14H6z" /><path d="M15 3v4h4" /><path d="M9 12h7M9 15h7M9 18h4" /></I>,
  pdf: () => <I><path d="M6 3h9l4 4v14H6z" /><path d="M15 3v4h4" /><path d="M9 17v-4h1.5a1.5 1.5 0 0 1 0 3H9" /><path d="M14 13v4" /></I>,
  camera: () => <I><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></I>,
  share: () => <I><path d="M12 15V3" /><path d="m8 7 4-4 4 4" /><path d="M6 11v9h12v-9" /></I>,
  back: () => <I><path d="m15 5-7 7 7 7" /></I>,
};

// ---------------------------------------------------------------- covers

const PALETTE = ["#5b4a8b", "#7a4c2d", "#2d5a7a", "#6b2d7a", "#7a2d45", "#4c6b2d", "#2d6e7a", "#7a642d"];
const colourFor = (s: string) => PALETTE[[...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % PALETTE.length];

/** Share of the book read: paragraphs for files, printed pages for photographed books. */
export function bookShare(b: Book): number {
  if (b.source === "photo" && b.pageCount) return bookProgress(b.pageCount, b.pagesRead, b.firstPage ?? 1).share;
  return b.paragraphCount ? Math.min(1, b.position.ord / b.paragraphCount) : 0;
}

export function Cover({ book, showRing = true }: { book: Book; showRing?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null;
    let live = true;
    if (book.hasCover)
      void loadCover(book.id).then((blob) => {
        if (blob && live) setUrl((u = URL.createObjectURL(blob)));
      });
    return () => {
      live = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [book.id, book.hasCover]);
  const pct = Math.round(bookShare(book) * 100);
  return (
    <div className={`cover ${book.status === "processing" ? "processing" : ""}`}>
      {url ? (
        <img src={url} alt="" />
      ) : (
        <div className="made" style={{ ["--c" as string]: colourFor(book.title) }}>
          <b lang="nl">{book.title}</b>
          <small>{book.author ?? ""}</small>
        </div>
      )}
      {book.level && <span className="lvl">{book.level}</span>}
      {showRing && pct > 0 && (
        <span className="ring" style={{ ["--p" as string]: pct }} data-p={`${pct}%`} aria-label={`${pct}% read`} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- tokens, levels

export function TokenPips({ progress }: { progress: Progress }) {
  const need = 3;
  const have = progress.offer ? need : Math.min(need, progress.tokens.length);
  return (
    <span className="tokens" aria-label={`${have} of ${need} streak tokens toward the next level`}>
      {Array.from({ length: need }, (_, i) => <i key={i} className={`tok ${i < have ? "on" : ""}`} />)}
    </span>
  );
}

export function LevelPicker({ value, onChange, label }: { value: CefrLevel | null; onChange: (l: CefrLevel) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {LEVELS.map((l) => (
        <button key={l} type="button" aria-pressed={value === l} onClick={() => onChange(l)}>
          {l}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- sheets and toasts

export function Sheet({ children, onClose, label }: { children: ReactNode; onClose?: () => void; label: string }) {
  useEffect(() => {
    if (!onClose) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="sheetmodal" role="dialog" aria-modal="true" aria-label={label}>
        <div className="grab" />
        {children}
      </div>
    </div>
  );
}

/**
 * Toasts. A plain toast says what happened. A reward (XP, a badge, a new rank) is the game talking: a gold bookplate
 * springs up, its "+N XP" lands like a stamp, and a few Dutch letters spill out of the book. Only rewards move like
 * this, so the motion keeps its meaning; with reduced motion they simply fade in.
 */
export type RewardKind = "xp" | "badge" | "rank";
interface ToastState { id: number; text: string; reward?: RewardKind }

let toastSet: ((m: ToastState | null) => void) | null = null;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let toastId = 0;
function show(t: Omit<ToastState, "id">, ms: number): void {
  clearTimeout(toastTimer);
  toastSet?.({ ...t, id: ++toastId });
  toastTimer = setTimeout(() => toastSet?.(null), ms);
}
export function toast(message: string, ms = 3400): void {
  show({ text: message }, ms);
}
/** A game reward: XP earned, a badge tier or a new rank. */
export function celebrate(message: string, reward: RewardKind = "xp", ms = 4600): void {
  show({ text: message, reward }, ms);
}

/** Letters that spill out of the book: the ones that make Dutch look Dutch. Fixed, so every reward looks the same. */
const SPILL = ["ij", "é", "a", "ë", "oe", "w", "ui", "k"];

/** The "+N XP" in a message (any language: the number is formatted, "XP" stays). */
const GAIN = /([+＋]\s?[\d\s.,\u00a0\u202f]*\d\s?XP)/;

function RewardIcon({ kind }: { kind: RewardKind }) {
  if (kind === "rank")
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5 4.5 5.5v6c0 4.6 3.1 8.4 7.5 10 4.4-1.6 7.5-5.4 7.5-10v-6z" /><path className="hi" d="m8.5 12.2 2.4 2.4 4.6-5" /></svg>;
  if (kind === "badge")
    return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="9" r="6" /><path className="line" d="m8.5 13.8-2 7.2 5.5-2.6 5.5 2.6-2-7.2" /><circle className="hi" cx="12" cy="9" r="2.2" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5.5c3-1 6-.6 9 1.4 3-2 6-2.4 9-1.4v13c-3-1-6-.6-9 1.4-3-2-6-2.4-9-1.4z" /><path className="hi" d="M12 6.9v13.4" /></svg>;
}

export function Toaster() {
  const [m, setM] = useState<ToastState | null>(null);
  useEffect(() => {
    toastSet = setM;
    return () => void (toastSet = null);
  }, []);
  if (!m) return null;
  if (!m.reward) return <div key={m.id} className="toast" role="status">{m.text}</div>;
  const parts = m.text.split(GAIN);
  return (
    <div key={m.id} className={`toast reward r-${m.reward}`} role="status">
      <span className="plate" aria-hidden="true">
        <RewardIcon kind={m.reward} />
        <span className="spill">
          {SPILL.map((l, i) => <i key={i} lang="nl" style={{ ["--i" as string]: i }}>{l}</i>)}
        </span>
      </span>
      <span className="msg">{parts.map((p, i) => (i % 2 ? <b key={i} className="gain">{p}</b> : p))}</span>
    </div>
  );
}

/**
 * A milestone unlocked (every 20 new pages of a book): a banner at the top of the screen, like an achievement
 * unlocking in a game. A gold disc pops in, a ring draws round it, the banner opens out of the disc with the title and
 * the XP, a glint passes over it, and it folds back into the disc. It isn't an achievement and isn't listed with the
 * badges; only this moment marks it.
 */
interface UnlockState { id: number; title: string; detail: string }
let unlockSet: ((u: UnlockState | null) => void) | null = null;
let unlockTimer: ReturnType<typeof setTimeout> | undefined;
export function unlock(title: string, detail: string, ms = 5200): void {
  clearTimeout(unlockTimer);
  unlockSet?.({ id: ++toastId, title, detail });
  unlockTimer = setTimeout(() => unlockSet?.(null), ms);
}
export function Unlocker() {
  const [u, setU] = useState<UnlockState | null>(null);
  useEffect(() => {
    unlockSet = setU;
    return () => void (unlockSet = null);
  }, []);
  if (!u) return null;
  return (
    <div key={u.id} className="unlock" role="status">
      <span className="disc" aria-hidden="true">
        <svg className="ring" viewBox="0 0 60 60"><circle cx="30" cy="30" r="27" /></svg>
        <svg className="icon" viewBox="0 0 24 24">
          <path d="M3 5.5c3-1 6-.6 9 1.4 3-2 6-2.4 9-1.4v13c-3-1-6-.6-9 1.4-3-2-6-2.4-9-1.4z" />
          <path className="hi" d="M12 6.9v13.4" />
        </svg>
      </span>
      <span className="band">
        <b>{u.title}</b>
        <span>{u.detail}</span>
      </span>
    </div>
  );
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
