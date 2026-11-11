/**
 * The photographed pages of a printed book, as the camera flow keeps them on the device. No React and no I/O, so
 * the rules are tested in Node (test/pages.test.ts):
 *
 * - Every photo gets its place in the book the moment it is taken: by its printed page number where one was read
 *   (or typed), otherwise from the pages taken before and after it, otherwise by capture order. A retake replaces
 *   the photo in that same place, so fixing a bad photo never changes the reading order.
 * - Photos are taken in sections of at most 20, one section per visit to the camera.
 */
// A relative path (not the @boekenwurm/books alias) so the tests can load this module in Node without Vite.
import { placePages, stitch, type PageText, type StitchedParagraph } from "../../../../packages/books/src/stitch.ts";

/** Photos per section: a manageable sitting, after which the reader reads before photographing more. */
export const SECTION_SIZE = 20;

export interface PageEntry {
  /** Capture order, fixed for the life of the photo slot (a retake keeps it). */
  seq: number;
  /** The camera visit the photo was taken in (1, 2, …). Older entries have none and count as section 1. */
  section?: number;
  status: "queued" | "reading" | "done" | "check" | "failed";
  page: PageText | null;
  problems: string[];
  uncertain: string[];
  by: "claude" | "device" | null;
  /** A page number the reader typed, which wins over the one read from the photo. */
  manualPage?: number | null;
}

export interface Range {
  firstPage: number;
  lastPage: number | null;
}

export interface Placed {
  entry: PageEntry;
  /** Printed page number in the book: read, typed, or worked out from the neighbours (`guessed`). */
  pageNumber: number | null;
  guessed: boolean;
}

export const readNumber = (e: PageEntry): number | null => e.manualPage ?? e.page?.pageNumber ?? null;

/**
 * The number a photo is placed by: one the reader typed, or one read from the photo when it lies within the book's
 * chosen pages. A reading outside them (a "1" read off a smudge, a year in the running head) is not trusted.
 */
export function placingNumber(e: PageEntry, range: Range): number | null {
  if (e.manualPage != null) return e.manualPage;
  const n = e.page?.pageNumber ?? null;
  if (n == null || n < range.firstPage || (range.lastPage != null && n > range.lastPage)) return null;
  return n;
}
export const isBusy = (e: PageEntry) => e.status === "queued" || e.status === "reading";

/** Every photo in reading order, with its page number. Photos still being read keep their capture place. */
export function arrange(entries: PageEntry[], range: Range): Placed[] {
  const placed = placePages(
    entries.map((e) => ({ seq: e.seq, pageNumber: placingNumber(e, range) })),
    { firstPage: range.firstPage, lastPage: range.lastPage ?? undefined },
  );
  const bySeq = new Map(entries.map((e) => [e.seq, e]));
  return placed.map((p) => ({ entry: bySeq.get(p.seq)!, pageNumber: p.pageNumber, guessed: p.guessed }));
}

/** Why a photo needs the reader's look, if it does. Words to check are optional; the rest affect reading. */
export function flags(p: Placed, all: Placed[], range: Range): string[] {
  const e = p.entry;
  if (isBusy(e)) return [];
  const out: string[] = [];
  if (e.status === "failed" || e.status === "check") out.push(...(e.problems.length ? e.problems : ["This photo couldn't be read."]));
  const read = readNumber(e);
  if (read != null && placingNumber(e, range) == null)
    out.push(`The page number was read as ${read}, outside pages ${range.firstPage}–${range.lastPage ?? "…"}. Type the right number.`);
  else if (p.pageNumber == null) out.push("No page number was found. Type it, so the page sits in the right place.");
  else {
    if (p.pageNumber < range.firstPage) out.push(`Page ${p.pageNumber} is before your first page (${range.firstPage}).`);
    if (range.lastPage != null && p.pageNumber > range.lastPage) out.push(`Page ${p.pageNumber} is after the last page (${range.lastPage}).`);
    const twin = all.find((q) => q !== p && q.pageNumber === p.pageNumber && q.entry.seq < e.seq);
    if (twin) out.push(`Page ${p.pageNumber} was photographed twice; this later photo is left out unless you change its number.`);
  }
  if (e.uncertain.length) out.push(`${e.uncertain.length === 1 ? "A word was" : `${e.uncertain.length} words were`} hard to read.`);
  return out;
}

/** The pages that go into the book: read photos, numbered as placed (so stitching follows the reading order). */
export function bookPages(placed: Placed[]): PageText[] {
  return placed
    .filter((p) => p.entry.status === "done" && p.entry.page)
    .map((p) => ({ ...p.entry.page!, seq: p.entry.seq, pageNumber: p.pageNumber }));
}

export function stitchBook(entries: PageEntry[], range: Range): StitchedParagraph[] {
  return stitch(bookPages(arrange(entries, range))).paragraphs;
}

/** The section a new photo belongs to in this visit: one after the newest section that has photos. */
export function nextSection(entries: PageEntry[]): number {
  return Math.max(0, ...entries.map((e) => e.section ?? 1)) + 1;
}

/** Where the next section should start: the page after the furthest page photographed. */
export function nextPage(entries: PageEntry[], range: Range): number {
  const nums = arrange(entries, range).map((p) => p.pageNumber).filter((n): n is number => n != null);
  return nums.length ? Math.max(...nums) + 1 : range.firstPage;
}

/**
 * Keep the reader on the same paragraph when pages are added or replaced before it: the paragraph they were at is
 * found again in the new list (by its text), otherwise the first paragraph of the same page.
 */
export function keepPosition(
  before: Array<{ text: string; pageNumber: number | null }>,
  ord: number,
  after: Array<{ text: string; pageNumber: number | null }>,
): number {
  if (ord <= 0 || !before.length) return 0;
  if (ord >= before.length) {
    // Finished everything photographed so far: continue at the first new page after the last one read.
    const lastPage = before[before.length - 1].pageNumber;
    const i = lastPage == null ? -1 : after.findIndex((p) => p.pageNumber != null && p.pageNumber > lastPage);
    return i >= 0 ? i : after.length;
  }
  const here = before[ord];
  const same = after.findIndex((p) => p.text === here.text);
  if (same >= 0) return same;
  const page = here.pageNumber == null ? -1 : after.findIndex((p) => p.pageNumber != null && p.pageNumber >= here.pageNumber!);
  return page >= 0 ? page : Math.min(ord, after.length);
}
