/**
 * The free way to read a photographed page: text recognition on the reader's own device (Tesseract.js with
 * its Dutch model), turned into the same page shape that Claude's reading and PDF pages produce, so all
 * three go through `stitch`.
 *
 * Tesseract returns lines with a bounding box (image pixels, y grows downwards) and a confidence per word.
 * This module is pure: the app runs Tesseract and passes its lines in.
 */
import { paragraphsFromLines, type Line } from "./pdf.ts";
import type { PageText } from "./stitch.ts";

export interface OcrWord {
  text: string;
  /** 0–100, as Tesseract reports it. */
  confidence: number;
}

export interface OcrLine {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  confidence: number;
  words?: OcrWord[];
}

export interface OcrPage {
  page: PageText;
  /** Words the reader should check before the page is added, in reading order (unique). */
  uncertain: string[];
  /** 0–1: share of words recognised with confidence; under 0.8 the photo should be retaken. */
  quality: number;
}

/** Below this, a word is shown for checking. */
export const UNCERTAIN_BELOW = 70;

/**
 * Lines whose height is far from the page's usual text height are headings, captions or page furniture;
 * they are kept but sized so the paragraph logic sees them as separate.
 */
function toLines(ocr: OcrLine[]): Line[] {
  return ocr
    .filter((l) => l.text.trim())
    .map((l) => {
      const height = Math.max(1, l.bbox.y1 - l.bbox.y0);
      return {
        text: l.text.replace(/\s+/g, " ").trim(),
        x: l.bbox.x0,
        // Flip to PDF-style coordinates (y grows upwards) and use the baseline, as pdf.ts expects.
        y: -l.bbox.y1,
        size: height * 0.8,
        right: l.bbox.x1,
      };
    });
}

/** Common misreadings in Dutch body text that are safe to fix without a dictionary. */
export function tidy(text: string): string {
  return text
    .replace(/[“”„]/g, '"')
    .replace(/[‘’‚]/g, "'")
    .replace(/\s+([.,;:!?])/g, "$1")
    // Left alone on purpose: spaced dashes (real punctuation in Dutch) and "IJ", which Dutch capitalises as one letter.
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function pageFromOcr(lines: OcrLine[], seq: number): OcrPage {
  const usable = lines.filter((l) => l.text.trim() && l.confidence > 20);
  const parsed = paragraphsFromLines(toLines(usable));
  const words = usable.flatMap((l) => l.words ?? l.text.split(/\s+/).map((t) => ({ text: t, confidence: l.confidence })));
  const letters = words.filter((w) => /\p{L}/u.test(w.text));
  const sure = letters.filter((w) => w.confidence >= UNCERTAIN_BELOW).length;
  const uncertain = [
    ...new Set(letters.filter((w) => w.confidence < UNCERTAIN_BELOW).map((w) => w.text.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, ""))),
  ].filter((w) => w.length > 1);
  return {
    page: {
      seq,
      pageNumber: parsed.pageNumber,
      paragraphs: parsed.paragraphs.map(tidy).filter(Boolean),
      startsMidParagraph: parsed.startsMidParagraph,
      endsMidParagraph: parsed.endsMidParagraph,
      endsWithHyphen: parsed.endsWithHyphen,
    },
    uncertain,
    quality: letters.length ? Math.round((sure / letters.length) * 100) / 100 : 0,
  };
}
