/**
 * Turning what was imported into a book on the shelf: paragraphs with tap tokens, the book's level (set by the
 * reader, with the share of its words they know as a hint), and photographed pages, read by Google, by Google with
 * Claude sorting out the paragraphs, or by Claude (lib/pagereader.ts).
 */
import * as AI from "@boekenwurm/ai";
import type { CefrLevel } from "@boekenwurm/engine";
import { joinShortBlocks, type PageText, type StitchedParagraph } from "@boekenwurm/books";
import { claudeVision, AiError, hasKey } from "./claude.ts";
import { countable, isOldForm, langOf, nameTest, tokenize } from "./text.ts";
import { lookup, listLemmas } from "./words.ts";
import { getState, knownLemmas } from "./store.ts";
import { readPageOnDevice } from "./ocr.ts";
import { ADMIN, explainGoogleError, GOOGLE_PAGES, hasFeature, PAGE_READS_PER_DAY, readPageWithGoogle } from "./features.ts";
import { pageReaderFor, type PageReader } from "./pagereader.ts";
import { downscale, toBase64, CLAUDE_SIDE, OCR_SIDE } from "./images.ts";
import type { Book, BookText, Paragraph } from "./types.ts";

export function newBook(fields: Partial<Book> & Pick<Book, "source" | "title">): Book {
  const t = Date.now();
  return {
    id: crypto.randomUUID(),
    author: null, isbn: null, level: null, levelSource: null, scan: null, status: "ready", pageCount: null,
    pagesRead: [], position: { ord: 0, mode: "original" }, paragraphCount: 0, coverPath: null, hasCover: false,
    createdAt: t, updatedAt: t, dirty: true, textSynced: false, textRemote: false, nextSeq: 0,
    ...fields,
  };
}

/** Paragraphs with tap tokens. Names are found across the whole book (DESIGN.md: names are not vocabulary). */
export function toParagraphs(items: Array<string | StitchedParagraph>): Paragraph[] {
  // Every book, whatever its source: a paragraph under 7 words (a heading, a caption, half a sentence split off by
  // page recognition) is read together with the one after it (packages/books/src/paragraphs.ts).
  const blocks = joinShortBlocks(items.map((p) => (typeof p === "string" ? { text: p, pageNumber: null } : p)));
  const isName = nameTest(blocks.map((b) => b.text));
  return blocks.map(({ text, pageNumber }) => {
    const tokens = tokenize(text, isName);
    return { text, tokens, countable: countable(tokens), pageNumber };
  });
}

// ---------------------------------------------------------------- the book's level

/** Share of a paragraph's words the reader knows (null when nothing is known yet). */
export function knownShare(text: string, known: Set<string>): number | null {
  if (!known.size) return null;
  const words = tokenize(text, () => false).filter((t) => t.k === "word");
  if (!words.length) return null;
  return words.filter((t) => known.has(lookup(t.t).lemma)).length / words.length;
}

/**
 * The share of the book's words the reader knows: a hint for the level they choose. Books are no longer graded by
 * Claude (removed 2026-11-27, DESIGN.md).
 */
export function wordMatchOf(text: BookText): number | null {
  const known = knownLemmas(listLemmas());
  const valid = text.paragraphs.map((p) => knownShare(p.text, known)).filter((x): x is number => x != null);
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
}

/** The level suggested by the word match: a hint, never a verdict. */
export function hintFromWordMatch(wordMatch: number | null): CefrLevel | null {
  if (wordMatch == null) return null;
  if (wordMatch >= 0.95) return "A1";
  if (wordMatch >= 0.9) return "A2";
  if (wordMatch >= 0.82) return "B1";
  if (wordMatch >= 0.72) return "B2";
  return "C1";
}

// ---------------------------------------------------------------- photographed pages

export interface PageResult {
  page: PageText;
  /** Words the on-device reader was unsure of: shown for a quick check. */
  uncertain: string[];
  /** 0–1; under 0.8 the photo should be retaken (on-device reading). */
  quality: number;
  problems: string[];
  by: "claude" | "google" | "google+claude" | "device";
  model: string | null;
  /** Read on the device although the reader has Google page reading (today's 20 used, or Google unreachable). */
  fallback?: string;
}

/** Who reads pages on this device now: Google, Google with Claude, Claude, or the device (lib/pagereader.ts). */
export function currentPageReader(): PageReader {
  const st = getState();
  return pageReaderFor(st.profile.settings.pageReader, { admin: hasFeature(ADMIN), hasKey: hasKey(), google: hasFeature(GOOGLE_PAGES) });
}

export async function readPhotoPage(
  photo: Blob,
  seq: number,
  onProgress?: (p: number, s: string) => void,
  range: { lastPage?: number | null } = {},
): Promise<PageResult> {
  const reader = currentPageReader();
  const model = getState().profile.settings.models.vision;
  if (reader === "claude") {
    onProgress?.(0, "reading with Claude");
    const img = await downscale(photo, CLAUDE_SIDE);
    const reading = AI.parsePage(await claudeVision(AI.pagePrompt({ mediaType: "image/jpeg", data: await toBase64(img) }), model));
    const problems = [
      ...AI.validatePage(reading, { language: (t) => langOf(t).lang, isOldForm }),
      ...reading.problems,
    ];
    return {
      page: { seq, pageNumber: reading.pageNumber, paragraphs: reading.paragraphs, startsMidParagraph: reading.startsMidParagraph, endsMidParagraph: reading.endsMidParagraph, endsWithHyphen: reading.endsWithHyphen },
      uncertain: [], quality: 1, problems, by: "claude", model,
    };
  }
  const img = await downscale(photo, OCR_SIDE, 0.9);
  // Google page reading (an access code): Google Cloud Vision reads the page, at most 20 pages a day for the whole
  // account (the read-page function enforces it). There is no fallback to reading on the device: it isn't good enough
  // to give readers (owner, 2026-11-20). A page Google can't read now fails, and can be read again later.
  if (reader === "google" || reader === "google+claude") {
    onProgress?.(0, "reading with Google");
    const g = await readPageWithGoogle(img, seq, range);
    if (!g.ok)
      throw new Error(
        g.reason === "limit" ? `Today's ${PAGE_READS_PER_DAY} pages are used, for all your books. Read this page again tomorrow.`
        : g.reason === "offline" ? "You're offline, so Google couldn't read this page. Read it again when you're back online."
        : `Google couldn't read this page. Try reading it again.${g.detail ? ` ${explainGoogleError(g.detail)}` : ""}`,
      );
    const google: PageResult = { ...g.page, problems: readingProblems(g.page.page, g.page.quality), by: "google", model: "cloud-vision" };
    if (reader === "google") return google;
    onProgress?.(0.5, "arranging with Claude");
    return arrangeWithClaude(google, photo, model, range);
  }
  const r = await readPageOnDevice(img, seq, onProgress, range);
  return { page: r.page, uncertain: r.uncertain, quality: r.quality, problems: readingProblems(r.page, r.quality), by: "device", model: null };
}

/**
 * Google + Claude: Claude sorts Google's text into the printed paragraphs and reads the page number. The words stay
 * Google's (packages/ai/src/structure.ts). If Claude can't be reached, or its layout changes a letter, the page keeps
 * Google's own layout and says why.
 */
async function arrangeWithClaude(google: PageResult, photo: Blob, model: string, range: { lastPage?: number | null }): Promise<PageResult> {
  const blocks = google.page.paragraphs;
  if (!blocks.length) return google;
  try {
    const img = await downscale(photo, CLAUDE_SIDE);
    const layout = AI.parseLayout(await claudeVision(AI.structurePrompt({ mediaType: "image/jpeg", data: await toBase64(img) }, blocks), model));
    const paragraphs = AI.applyLayout(blocks, layout);
    if (!paragraphs) return { ...google, fallback: "Claude's paragraphs didn't match Google's text, so Google's layout is kept." };
    const pageNumber = layout.pageNumber != null && layout.pageNumber <= (range.lastPage ?? 5000) ? layout.pageNumber : google.page.pageNumber;
    return {
      ...google,
      page: { ...google.page, pageNumber, paragraphs, startsMidParagraph: layout.startsMidParagraph, endsMidParagraph: layout.endsMidParagraph, endsWithHyphen: layout.endsWithHyphen },
      problems: readingProblems({ ...google.page, paragraphs }, google.quality),
      by: "google+claude",
      model,
    };
  } catch (e) {
    return { ...google, fallback: `${e instanceof AiError ? e.message : "Claude couldn't arrange this page."} Google's layout is kept.` };
  }
}

/** A photo to retake: too many unsure words, or too little text found. */
function readingProblems(page: PageText, quality: number): string[] {
  const problems = quality < 0.8 ? ["Many words were hard to read. Retake the photo flat, closer and in good light."] : [];
  const words = page.paragraphs.join(" ").match(/\p{L}+/gu) ?? [];
  if (words.length < 15) problems.push("Very little text was found on this page. Retake the photo closer and in good light.");
  return problems;
}
