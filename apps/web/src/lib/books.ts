/**
 * Turning what was imported into a book on the shelf: paragraphs with tap tokens, the book's level (graded with
 * the reader's Claude key, or set by the reader in free mode), and photographed pages read with Claude or on the
 * device.
 */
import * as AI from "@boekenwurm/ai";
import type { CefrLevel } from "@boekenwurm/engine";
import type { PageText, StitchedParagraph } from "@boekenwurm/books";
import { claude, claudeVision, AiError, hasKey } from "./claude.ts";
import { db } from "./db.ts";
import { countable, hash, isOldForm, langOf, nameTest, tokenize } from "./text.ts";
import { lookup, listLemmas } from "./words.ts";
import { getState, knownLemmas } from "./store.ts";
import { readPageOnDevice } from "./ocr.ts";
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
  const texts = items.map((p) => (typeof p === "string" ? p : p.text));
  const isName = nameTest(texts);
  return items.map((p) => {
    const text = typeof p === "string" ? p : p.text;
    const tokens = tokenize(text, isName);
    return { text, tokens, countable: countable(tokens), pageNumber: typeof p === "string" ? null : p.pageNumber };
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

export interface Grading {
  wordMatch: number | null;
  level: AI.BookLevel | null;
  error: string | null;
}

/**
 * The local word match always; with a key, Claude grades 12 paragraphs spread through the book
 * (DESIGN.md, "Your own books at your level"). Results are cached per book text and model.
 */
export async function gradeBook(text: BookText, onlyLocal = false): Promise<Grading> {
  const known = knownLemmas(listLemmas());
  const shares = text.paragraphs.map((p) => knownShare(p.text, known));
  const valid = shares.filter((x): x is number => x != null);
  const wordMatch = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
  if (onlyLocal || !hasKey()) return { wordMatch, level: null, error: null };
  const { profile } = getState();
  const model = profile.settings.models.match;
  const key = `g|${hash(text.paragraphs.map((p) => p.text.slice(0, 80)).join("|"))}|${text.paragraphs.length}|${model}`;
  try {
    let grades = await db.get<AI.ParagraphGrade[]>("cache", key);
    if (!grades) {
      const picks = AI.samplePositions(text.paragraphs.length, 12).map((i) => ({ id: `p${i}`, text: text.paragraphs[i].text, wordMatch: shares[i] }));
      grades = AI.parseGrades(await claude(AI.gradePrompt(picks), model), picks.map((p) => p.id));
      await db.put("cache", grades, key);
    }
    return { wordMatch, level: AI.bookLevel(grades, profile.progress.level as AI.Cefr, wordMatch), error: null };
  } catch (e) {
    return { wordMatch, level: null, error: e instanceof AiError ? e.message : "Couldn't grade this book." };
  }
}

/** The level suggested from the word match alone (free mode): a hint, never a verdict. */
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
  by: "claude" | "device";
  model: string | null;
}

export async function readPhotoPage(photo: Blob, seq: number, useClaude: boolean, onProgress?: (p: number, s: string) => void): Promise<PageResult> {
  if (useClaude) {
    const model = getState().profile.settings.models.vision;
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
  const r = await readPageOnDevice(img, seq, onProgress);
  const problems = r.quality < 0.8 ? ["Many words were hard to read. Retake the photo flat, closer and in good light."] : [];
  const words = r.page.paragraphs.join(" ").match(/\p{L}+/gu) ?? [];
  if (words.length < 15) problems.push("Very little text was found on this page. Retake the photo closer and in good light.");
  return { page: r.page, uncertain: r.uncertain, quality: r.quality, problems, by: "device", model: null };
}

export async function readCover(photo: Blob): Promise<AI.CoverReading> {
  const img = await downscale(photo, CLAUDE_SIDE);
  return AI.parseCover(await claudeVision(AI.coverPrompt({ mediaType: "image/jpeg", data: await toBase64(img) }), getState().profile.settings.models.vision));
}
