// "Export everything": photographed books are listed with title, author, pages read and progress, never their text
// (owner, 2026-11-20). Book text here is invented for the test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { booksForExport } from "../src/lib/export.ts";
import type { Book, BookText } from "../src/lib/types.ts";

const book = (id: string, source: Book["source"], o: Partial<Book> = {}): Book => ({
  id, source, title: `Boek ${id}`, author: "Test Auteur", isbn: null, level: "A2", levelSource: "reader", scan: null, status: "ready",
  pageCount: null, pagesRead: [], position: { ord: 3, mode: "original", at: 0 }, paragraphCount: 1, coverPath: null, hasCover: false,
  createdAt: Date.UTC(2026, 10, 1), updatedAt: 0, dirty: false, textSynced: true, textRemote: false, nextSeq: 0, ...o,
} as Book);
const text = (bookId: string): BookText => ({ bookId, paragraphs: [{ text: "Het was nog vroeg.", tokens: [], countable: 4, pageNumber: null }] });

test("a photographed book's text stays out; its title, author, pages read and progress go in", () => {
  const photo = book("p", "photo", { firstPage: 9, pageCount: 28, pagesRead: [9, 10, 11, 12, 13] });
  const out = booksForExport([book("e", "epub"), photo], [text("e"), text("p")]);
  assert.deepEqual(out.books.map((b) => b.id), ["e"], "the EPUB is exported as before");
  assert.deepEqual(out.paragraphs.map((t) => t.bookId), ["e"], "only the EPUB's text");
  assert.deepEqual(out.photographedBooks, [{
    id: "p", title: "Boek p", author: "Test Auteur", isbn: null, level: "A2", firstPage: 9, lastPage: 28,
    pagesRead: [9, 10, 11, 12, 13], percentRead: 25, position: { ord: 3, mode: "original", at: 0 }, addedAt: "2026-11-01T00:00:00.000Z",
  }], "pages 9–28 are 20 pages; 5 read is 25%");
  assert.ok(!JSON.stringify(out.photographedBooks).includes("Het was nog vroeg"), "the summary holds no text");
});
