/**
 * The photographed pages of a printed book, as the camera flow keeps them on the device. No React and no I/O, so
 * the rules are tested in Node (test/pages.test.ts):
 *
 * - Photos are numbered in the order they were taken, from the first page the reader chose: first page 7, so the
 *   second photo is page 8, whatever number can or can't be read on it (stylised page numbers are often misread).
 * - The number read from the photo is shown next to it. Where the two differ, the photo is flagged, and the reader
 *   can change the number. A changed number is kept as typed, and the photos taken after it follow on from the
 *   furthest page so far (a skipped page is fixed in one edit). The book reads in page-number order.
 * - A retake replaces the photo in the same slot, so it keeps its number and place.
 * - Photos are taken in sections of at most 20, one section per visit to the camera, carrying on after the furthest
 *   page so far.
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
  /** A page number the reader typed. It is kept as typed, and the photos taken after it follow on from it. */
  manualPage?: number | null;
  /** The reader saw that the number read from the photo differs, and kept the number in order. */
  keepOrder?: boolean;
}

export interface Range {
  firstPage: number;
  lastPage: number | null;
}

export interface Placed {
  entry: PageEntry;
  /** The page number in the book: in capture order from the first page, or the one the reader typed. */
  pageNumber: number;
  /** The number read from the photo, if any; shown next to the page number. */
  seen: number | null;
  /** The reader typed this number. */
  typed: boolean;
}

export const seenNumber = (e: PageEntry): number | null => e.page?.pageNumber ?? null;
export const isBusy = (e: PageEntry) => e.status === "queued" || e.status === "reading";

/**
 * Every photo's page number, by capture order: the first photo is the first page, and each photo without a typed
 * number is the page after the furthest one so far. So a typed number carries the photos after it along (7, 8, then
 * 10 typed: 11, 12…), a page photographed out of order and fixed doesn't pull the next photo back (9, 10, 12 and 11
 * typed: the next is 13), and a new section carries on after the furthest page.
 */
export function numberPages(entries: PageEntry[], range: Range): Map<number, number> {
  const out = new Map<number, number>();
  let furthest = range.firstPage - 1;
  for (const e of [...entries].sort((a, b) => a.seq - b.seq)) {
    const n = e.manualPage ?? furthest + 1;
    out.set(e.seq, n);
    furthest = Math.max(furthest, n);
  }
  return out;
}

/** Every photo in reading order (by page number; a page photographed twice in capture order), with its numbers. */
export function arrange(entries: PageEntry[], range: Range): Placed[] {
  const numbers = numberPages(entries, range);
  return entries
    .map((e) => ({ entry: e, pageNumber: numbers.get(e.seq)!, seen: seenNumber(e), typed: e.manualPage != null }))
    .sort((a, b) => a.pageNumber - b.pageNumber || a.entry.seq - b.entry.seq);
}

/**
 * The number read from a photo differs from its page number, and the reader hasn't settled it. Readings outside the
 * book's chosen pages are ignored (a smudge read as "1", a year in the running head).
 */
export function differs(p: Placed, range: Range): boolean {
  const s = p.seen;
  if (s == null || s === p.pageNumber || p.typed || p.entry.keepOrder) return false;
  return s >= range.firstPage && (range.lastPage == null || s <= range.lastPage);
}

/** Why a photo needs the reader's look, if it does. Words to check are optional; the rest affect reading. */
export function flags(p: Placed, all: Placed[], range: Range): string[] {
  const e = p.entry;
  if (isBusy(e)) return [];
  const out: string[] = [];
  if (e.status === "failed" || e.status === "check") out.push(...(e.problems.length ? e.problems : ["This photo couldn't be read."]));
  if (differs(p, range))
    out.push(`In order this is page ${p.pageNumber}, but the photo seems to show page ${p.seen}. Change the number if ${p.seen} is right; the pages after it follow.`);
  if (p.pageNumber < range.firstPage) out.push(`Page ${p.pageNumber} is before your first page (${range.firstPage}).`);
  if (range.lastPage != null && p.pageNumber > range.lastPage) out.push(`Page ${p.pageNumber} is after the last page (${range.lastPage}).`);
  const twin = all.find((q) => q !== p && q.pageNumber === p.pageNumber && q.entry.seq < e.seq);
  if (twin) out.push(`Page ${p.pageNumber} was photographed twice; this later photo is left out unless you change its number.`);
  if (e.uncertain.length) out.push(`${e.uncertain.length === 1 ? "A word was" : `${e.uncertain.length} words were`} hard to read.`);
  return out;
}

/**
 * Books photographed before numbering by capture order were placed by the numbers read from the photos. Their
 * photos keep that order: where the new numbering would give a photo another number, its old number is kept as if
 * typed. Run once per book.
 */
export function keepEarlierOrder(entries: PageEntry[], range: Range): PageEntry[] {
  const old = new Map(
    placePages(
      entries.map((e) => {
        const n = e.manualPage ?? seenNumber(e);
        const inRange = n != null && (e.manualPage != null || (n >= range.firstPage && (range.lastPage == null || n <= range.lastPage)));
        return { seq: e.seq, pageNumber: inRange ? n : null };
      }),
      { firstPage: range.firstPage, lastPage: range.lastPage ?? undefined },
    ).map((p) => [p.seq, p.pageNumber]),
  );
  const out = entries.map((e) => ({ ...e }));
  for (const e of [...out].sort((a, b) => a.seq - b.seq)) {
    const was = old.get(e.seq);
    if (was != null && e.manualPage == null && numberPages(out, range).get(e.seq) !== was) e.manualPage = was;
  }
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
  const nums = [...numberPages(entries, range).values()];
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
