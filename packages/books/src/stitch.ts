/**
 * Turning a book's pages into one list of paragraphs, and measuring progress through a printed book.
 *
 * Pages arrive one photo (or one PDF page) at a time, each already split into paragraphs. A paragraph that
 * runs over a page break is cut in two; a word hyphenated at the end of a page is cut in two. Stitching joins
 * both back, in reading order, and remembers which printed page each paragraph starts on.
 */

export interface PageText {
  /** Order in which the page was added (photo order), used when no page number is known. */
  seq: number;
  /** Printed page number, when known. */
  pageNumber: number | null;
  paragraphs: string[];
  startsMidParagraph: boolean;
  endsMidParagraph: boolean;
  /** The page's last word is hyphenated and continues on the next page. */
  endsWithHyphen?: boolean;
}

export interface StitchedParagraph {
  text: string;
  /** Printed page the paragraph starts on (null if unknown). */
  pageNumber: number | null;
  /** Pages the paragraph spans, by seq. */
  seqs: number[];
}

export interface StitchResult {
  paragraphs: StitchedParagraph[];
  /** Same printed page photographed twice: later copies were skipped. */
  duplicates: number[];
  /** Gaps in printed page numbers between consecutive pages, e.g. [[35, 37]] when 36 is missing. */
  gaps: Array<[number, number]>;
}

/** Order pages by printed number where known, otherwise by when they were taken. */
export function orderPages(pages: PageText[]): { ordered: PageText[]; duplicates: number[] } {
  const seen = new Map<number, PageText>();
  const duplicates: number[] = [];
  const kept: PageText[] = [];
  for (const p of [...pages].sort((a, b) => a.seq - b.seq)) {
    if (p.pageNumber != null) {
      if (seen.has(p.pageNumber)) {
        duplicates.push(p.seq);
        continue;
      }
      seen.set(p.pageNumber, p);
    }
    kept.push(p);
  }
  // Numbered pages sort by number; an unnumbered page stays right after the page taken before it.
  const ordered: PageText[] = [];
  const numbered = kept.filter((p) => p.pageNumber != null).sort((a, b) => a.pageNumber! - b.pageNumber!);
  const unnumbered = kept.filter((p) => p.pageNumber == null);
  ordered.push(...numbered);
  for (const u of unnumbered) {
    const before = [...kept].filter((p) => p.seq < u.seq && p.pageNumber != null).pop();
    const at = before ? ordered.indexOf(before) + 1 : 0;
    // keep unnumbered pages taken in a row in their own order
    let i = at;
    while (i < ordered.length && ordered[i].pageNumber == null && ordered[i].seq < u.seq) i++;
    ordered.splice(i, 0, u);
  }
  return { ordered, duplicates };
}

/** Join the end of one piece of text to the start of the next across a break. */
export function joinAcross(before: string, after: string, hyphenated: boolean): string {
  const a = before.trimEnd();
  const b = after.trimStart();
  if (hyphenated && /\p{L}-$/u.test(a)) {
    // "boodschap-" + "pen gedaan" -> "boodschappen gedaan"; keep the hyphen when the next part is capitalised
    // or a compound joiner like "zee-" + "egel" is unlikely to be known here, so prefer joining.
    return /^\p{Lu}/u.test(b) ? a + b : a.slice(0, -1) + b;
  }
  return `${a} ${b}`;
}

export function stitch(pages: PageText[]): StitchResult {
  const { ordered, duplicates } = orderPages(pages);
  const out: StitchedParagraph[] = [];
  const gaps: Array<[number, number]> = [];
  let carry: StitchedParagraph | null = null;
  let carryHyphen = false;
  let prevNumber: number | null = null;

  for (const page of ordered) {
    if (prevNumber != null && page.pageNumber != null && page.pageNumber > prevNumber + 1) gaps.push([prevNumber, page.pageNumber]);
    const missingBefore = prevNumber != null && page.pageNumber != null && page.pageNumber !== prevNumber + 1;
    if (page.pageNumber != null) prevNumber = page.pageNumber;

    const paras = page.paragraphs.filter((p) => p.trim());
    paras.forEach((text, i) => {
      const first = i === 0;
      const last = i === paras.length - 1;
      let current: StitchedParagraph;
      // Only join across the break when the pages really follow each other.
      if (first && carry && page.startsMidParagraph && !missingBefore) {
        current = { text: joinAcross(carry.text, text, carryHyphen), pageNumber: carry.pageNumber, seqs: [...carry.seqs, page.seq] };
        carry = null;
      } else {
        if (first && carry) {
          out.push(carry);
          carry = null;
        }
        current = { text: text.trim(), pageNumber: page.pageNumber, seqs: [page.seq] };
      }
      if (last && page.endsMidParagraph) {
        carry = current;
        carryHyphen = page.endsWithHyphen === true;
      } else out.push(current);
    });
    if (!paras.length && carry) {
      out.push(carry);
      carry = null;
    }
  }
  if (carry) out.push(carry);
  return { paragraphs: out, duplicates, gaps };
}

// ---------------------------------------------------------------- progress

export interface BookProgress {
  /** 0–1 share of the printed book read. */
  share: number;
  pagesRead: number;
  pageCount: number;
  /** Highest printed page read, for "page 34 of 212". */
  furthestPage: number | null;
}

/**
 * Progress through a printed book: pages finished out of the page count the reader entered.
 * pagesRead holds printed page numbers; numbers outside 1..pageCount are ignored.
 */
export function bookProgress(pageCount: number, pagesRead: Iterable<number>): BookProgress {
  const count = Math.max(1, Math.floor(pageCount));
  const done = new Set([...pagesRead].filter((n) => Number.isInteger(n) && n >= 1 && n <= count));
  const furthest = done.size ? Math.max(...done) : null;
  return { share: Math.round((done.size / count) * 1000) / 1000, pagesRead: done.size, pageCount: count, furthestPage: furthest };
}

/** Printed pages finished once the reader has passed paragraph `index` (0-based) of the stitched list. */
export function pagesFinished(paragraphs: StitchedParagraph[], index: number): number[] {
  const finished = new Set<number>();
  const upTo = paragraphs.slice(0, index + 1);
  const next = paragraphs[index + 1];
  for (const p of upTo) if (p.pageNumber != null) finished.add(p.pageNumber);
  // The page the next paragraph starts on isn't finished yet.
  if (next?.pageNumber != null) finished.delete(next.pageNumber);
  return [...finished].sort((a, b) => a - b);
}
