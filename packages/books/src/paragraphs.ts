/**
 * Paragraphs too short to read on their own. A heading ("Hoofdstuk 3"), a caption, or a sentence that page
 * recognition split in two is joined with the paragraph after it, so the reader always gets a block worth reading.
 * Applied to every book, whatever it came from (EPUB, PDF, photos).
 */

/** A paragraph with fewer words than this is joined with the next one. */
export const MIN_PARAGRAPH_WORDS = 7;

/** Words, not numbers or punctuation: "Hoofdstuk 3" is one word, "zo'n" and "e-mail" are one each. */
export function wordCount(text: string): number {
  return text.match(/\p{L}[\p{L}\p{M}'’-]*/gu)?.length ?? 0;
}

/**
 * Join each paragraph of fewer than `min` words with the ones after it, until the block has `min` words. Short text
 * left at the very end is added to the paragraph before it. `combine` merges two items (default for strings: with a
 * space); the first item's page number and the like are kept by the caller's combine.
 */
export function joinShortParagraphs<T>(
  items: T[],
  textOf: (item: T) => string,
  combine: (a: T, b: T) => T,
  min = MIN_PARAGRAPH_WORDS,
): T[] {
  const out: T[] = [];
  let open: T | null = null;
  for (const item of items) {
    open = open == null ? item : combine(open, item);
    if (wordCount(textOf(open)) >= min) {
      out.push(open);
      open = null;
    }
  }
  if (open != null) {
    if (out.length) out[out.length - 1] = combine(out[out.length - 1], open);
    else out.push(open);
  }
  return out;
}

/** Joined text: a space between, without doubling the spaces at the seam. */
export const joinText = (a: string, b: string): string => `${a.trimEnd()} ${b.trimStart()}`.trim();

/**
 * Paragraphs with the printed page they start on, joined by the rule above. A joined block belongs to the page most
 * of its words are on, so a stray scrap at the foot of one page, joined to the next page's first paragraph, doesn't
 * take that page away (Go to page and progress go by these page numbers).
 */
export function joinShortBlocks<T extends { text: string; pageNumber: number | null }>(items: T[], min = MIN_PARAGRAPH_WORDS): Array<{ text: string; pageNumber: number | null }> {
  return joinShortParagraphs<{ text: string; pageNumber: number | null }>(
    items.map(({ text, pageNumber }) => ({ text, pageNumber })),
    (p) => p.text,
    (a, b) => ({
      text: joinText(a.text, b.text),
      pageNumber: (wordCount(a.text) >= wordCount(b.text) ? a.pageNumber : b.pageNumber) ?? a.pageNumber ?? b.pageNumber,
    }),
    min,
  );
}
