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
  me: () => <I><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20c1.2-3.6 4-5.5 7-5.5s5.8 1.9 7 5.5" /></I>,
  epub: () => <I><path d="M6 3h9l4 4v14H6z" /><path d="M15 3v4h4" /><path d="M9 12h7M9 15h7M9 18h4" /></I>,
  pdf: () => <I><path d="M6 3h9l4 4v14H6z" /><path d="M15 3v4h4" /><path d="M9 17v-4h1.5a1.5 1.5 0 0 1 0 3H9" /><path d="M14 13v4" /></I>,
  camera: () => <I><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></I>,
  share: () => <I><path d="M12 15V3" /><path d="m8 7 4-4 4 4" /><path d="M6 11v9h12v-9" /></I>,
  back: () => <I><path d="m15 5-7 7 7 7" /></I>,
};

// ---------------------------------------------------------------- covers

const PALETTE = ["#2d7a4c", "#7a4c2d", "#2d5a7a", "#6b2d7a", "#7a2d45", "#4c6b2d", "#2d6e7a", "#7a642d"];
const colourFor = (s: string) => PALETTE[[...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % PALETTE.length];

/** Share of the book read: paragraphs for files, printed pages for photographed books. */
export function bookShare(b: Book): number {
  if (b.source === "photo" && b.pageCount) return bookProgress(b.pageCount, b.pagesRead).share;
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
          <small>{book.author ?? (book.source === "sample" ? "Sample story" : "")}</small>
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

let toastSet: ((m: string | null) => void) | null = null;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(message: string, ms = 3400): void {
  clearTimeout(toastTimer);
  toastSet?.(message);
  toastTimer = setTimeout(() => toastSet?.(null), ms);
}
export function Toaster() {
  const [m, setM] = useState<string | null>(null);
  useEffect(() => {
    toastSet = setM;
    return () => void (toastSet = null);
  }, []);
  return m ? <div className="toast" role="status">{m}</div> : null;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
