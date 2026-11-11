/**
 * How the device and the server agree (ARCHITECTURE.md, "Sync"): rows are last-write-wins by updated_at, except
 * that nothing earned is ever lost. Badges and streak tokens from any device are kept, and word counters are
 * added (word_stats is merged by add_word_stats on the server). Pure functions, tested in test/merge.test.ts.
 */
import type { Badge, Progress, Token, WordBook } from "@boekenwurm/engine";
import type { Book, WordDelta } from "./types.ts";

/** Last write wins for the level and the current token count; badges and token history are united. */
export function mergeProgress(local: Progress, localAt: number, server: Progress | null, serverAt: number): Progress {
  if (!server || !Array.isArray(server.badges)) return local;
  const winner = serverAt > localAt ? server : local;
  const badges = new Map<string, Badge>();
  for (const b of [...server.badges, ...local.badges]) {
    const have = badges.get(b.level);
    // A badge earned in play beats one given by placement; between two of the same kind, the earliest stays.
    const earned = (x: Badge) => x.source !== "placement";
    if (!have || (earned(b) && !earned(have)) || (earned(b) === earned(have) && b.at < have.at)) badges.set(b.level, b);
  }
  const history = new Map<string, Token>();
  for (const t of [...(server.history ?? []), ...(local.history ?? [])]) if (!history.has(t.sessionId)) history.set(t.sessionId, t);
  return {
    ...winner,
    badges: [...badges.values()].sort((a, b) => a.at - b.at),
    history: [...history.values()].sort((a, b) => a.at - b.at),
  };
}

export interface BookRow {
  id: string;
  user_id?: string;
  source: Book["source"];
  title: string;
  author: string | null;
  isbn: string | null;
  cover_path: string | null;
  page_count: number | null;
  first_page?: number;
  level: Book["level"];
  level_source: Book["levelSource"];
  scan: Book["scan"];
  status: Book["status"];
  position: Book["position"] & { paragraphs?: number; next_seq?: number };
  pages_read: number[];
  created_at?: string;
  updated_at?: string;
}

export function bookToRow(b: Book, userId: string): BookRow {
  return {
    id: b.id,
    user_id: userId,
    source: b.source,
    title: b.title.slice(0, 300) || "Untitled",
    author: b.author ? b.author.slice(0, 200) : null,
    isbn: b.isbn,
    cover_path: b.coverPath,
    page_count: b.pageCount,
    first_page: b.firstPage ?? 1,
    level: b.level,
    level_source: b.levelSource,
    scan: b.scan,
    status: b.status,
    // The paragraph count and next photo number travel with the position: the schema keeps both as jsonb.
    position: { ...b.position, paragraphs: b.paragraphCount, next_seq: b.nextSeq },
    pages_read: b.pagesRead,
    created_at: new Date(b.createdAt).toISOString(),
  };
}

/** A server row as a device book. `local` keeps what only this device knows (its cover image, its text). */
export function rowToBook(r: BookRow, local: Book | null, hasLocalText: boolean): Book {
  const pos = r.position ?? { ord: 0, mode: "original" };
  return {
    id: r.id,
    source: r.source,
    title: r.title,
    author: r.author,
    isbn: r.isbn,
    level: r.level,
    levelSource: r.level_source,
    scan: r.scan,
    status: r.status,
    pageCount: r.page_count,
    firstPage: r.first_page ?? 1,
    pagesRead: r.pages_read ?? [],
    position: { ord: Number(pos.ord) || 0, mode: pos.mode === "match" ? "match" : "original", at: Number(pos.at) || undefined },
    paragraphCount: Number(pos.paragraphs) || local?.paragraphCount || 0,
    coverPath: r.cover_path,
    hasCover: local?.hasCover ?? false,
    createdAt: r.created_at ? Date.parse(r.created_at) : Date.now(),
    updatedAt: r.updated_at ? Date.parse(r.updated_at) : Date.now(),
    dirty: false,
    textSynced: true,
    textRemote: !hasLocalText,
    nextSeq: Number(pos.next_seq) || local?.nextSeq || 0,
  };
}

/** Should the server's copy of a book replace the device's? Not while the device has newer, unsynced changes. */
export function serverWins(local: Book | null, serverUpdatedAt: number): boolean {
  if (!local) return true;
  if (local.dirty && local.updatedAt >= serverUpdatedAt) return false;
  return serverUpdatedAt > local.updatedAt || !local.dirty;
}

export interface WordStatRow {
  lemma: string;
  reveals: number;
  encounters: number;
  first_seen: string | null;
  last_revealed: string | null;
  example: string | null;
}

/** The server's totals plus what this device hasn't sent yet. */
export function wordbookFrom(rows: WordStatRow[], pending: Record<string, WordDelta>): WordBook {
  const out: WordBook = {};
  for (const r of rows)
    out[r.lemma] = {
      lemma: r.lemma,
      reveals: r.reveals,
      encounters: r.encounters,
      firstSeen: r.first_seen ? Date.parse(r.first_seen) : null,
      lastRevealed: r.last_revealed ? Date.parse(r.last_revealed) : null,
    };
  for (const [lemma, d] of Object.entries(pending)) {
    const w = (out[lemma] ??= { lemma, reveals: 0, encounters: 0, firstSeen: Date.now(), lastRevealed: null });
    w.reveals += d.reveals;
    w.encounters += d.encounters;
    w.lastRevealed = Math.max(w.lastRevealed ?? 0, d.lastRevealed ?? 0) || null;
  }
  return out;
}
