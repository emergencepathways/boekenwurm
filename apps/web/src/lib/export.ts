/**
 * "Export everything" (Account → Settings → Your data): the reader's data as one JSON file.
 *
 * Everything is in it except the text of photographed books (owner's decision, 2026-11-20). That text was read from
 * photos of a printed book; handing it out as a file would turn Boekenwurm into a way to copy books, and the text
 * isn't personal data about the reader (GDPR art. 15(4): a copy mustn't harm others' rights, copyright included).
 * What the reader did with such a book is theirs and stays in: its title, author, pages read and progress.
 */
import type { Book, BookText } from "./types.ts";

/** A photographed book in the export: what the reader did with it, without the book's text. */
export interface PhotographedBookSummary {
  id: string;
  title: string;
  author: string | null;
  isbn: string | null;
  level: Book["level"];
  firstPage: number | null;
  lastPage: number | null;
  pagesRead: number[];
  /** Share of the book's pages read, 0–100. */
  percentRead: number;
  /** The paragraph the reader is at, and when they last read. */
  position: Book["position"];
  addedAt: string;
}

export function summarizePhotographed(b: Book): PhotographedBookSummary {
  const first = b.firstPage ?? 1;
  const total = b.pageCount != null ? b.pageCount - first + 1 : null;
  const read = b.pagesRead.filter((n) => n >= first && (b.pageCount == null || n <= b.pageCount)).length;
  return {
    id: b.id, title: b.title, author: b.author, isbn: b.isbn, level: b.level,
    firstPage: b.firstPage ?? null, lastPage: b.pageCount, pagesRead: [...b.pagesRead],
    percentRead: total ? Math.round((read / total) * 100) : 0,
    position: b.position, addedAt: new Date(b.createdAt).toISOString(),
  };
}

/** The export's books and paragraphs: photographed books as summaries, their text left out. */
export function booksForExport(books: Book[], texts: BookText[]): { books: Book[]; photographedBooks: PhotographedBookSummary[]; paragraphs: BookText[] } {
  const photographed = new Set(books.filter((b) => b.source === "photo").map((b) => b.id));
  return {
    books: books.filter((b) => !photographed.has(b.id)),
    photographedBooks: books.filter((b) => photographed.has(b.id)).map(summarizePhotographed),
    paragraphs: texts.filter((t) => !photographed.has(t.bookId)),
  };
}
