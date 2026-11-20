/**
 * A page read by Google Cloud Vision (the read-page function, for readers with an access code), turned into the same
 * page shape as Claude's, the device's and PDF pages, so it goes through `stitch` like the rest.
 *
 * Vision finds the paragraphs itself; this decides what the page's numbers are. A number alone in the top or bottom
 * tenth of the page is the printed page number (the foot before the head, as most books print it there) and is left
 * out of the text. A number alone further in (a chapter number above its first paragraph) is kept as text; the
 * short-paragraph rule then reads it together with the paragraph after it.
 *
 * Vision copies every mark it sees, so the page is cleaned first (`cleanVision`): stray symbols ("|", "~", "•") are
 * taken out of the text, and a paragraph is dropped when it has no word of two letters or more (specks, rules, "* * *"),
 * when Vision was unsure of it and it has fewer than three words, or when it is a sliver of a few words at the very side of the
 * photo (the facing page or a thumb). Lone numbers are kept for the page number.
 */
import { tidy, type OcrPage } from "./ocr.ts";

export interface VisionParagraph {
  text: string;
  box: { x0: number; y0: number; x1: number; y1: number };
  confidence: number;
  unsure: string[];
}

export interface VisionPage {
  width: number;
  height: number;
  paragraphs: VisionParagraph[];
}

/** Share of the page height, from the top or the bottom, where a lone number is the page number. */
export const PAGE_NUMBER_BAND = 0.1;

/** A token made only of marks that are never Dutch text or punctuation: a stray symbol read from a speck or an edge. */
const STRAY = /^[|¦~^_<>=+*#@\\/•·°¬`©®™¤§¶†‡□■▪◦○●]+$/u;
/** Below this paragraph confidence, a short paragraph is taken for noise. */
export const UNSURE_PARAGRAPH = 0.5;
/** A paragraph this close to the side of the photo, and this narrow, is from the facing page or a finger. */
export const SIDE_BAND = 0.08;

const words2 = (t: string) => (t.match(/\p{L}{2,}/gu) ?? []).length;

/** Take the stray marks out of a page read by Vision (see the comment at the top). */
export function cleanVision(v: VisionPage): VisionPage {
  const w = v.width || Math.max(1, ...v.paragraphs.map((p) => p.box.x1));
  const out: VisionParagraph[] = [];
  for (const p of v.paragraphs) {
    const text = p.text.split(/\s+/).filter((t) => t && !STRAY.test(t)).join(" ").replace(/\s+([.,;:!?])/g, "$1").trim();
    if (!text) continue;
    if (LONE_NUMBER.test(text)) { out.push({ ...p, text }); continue; }
    const n = words2(text);
    if (n === 0) continue;
    if (p.confidence < UNSURE_PARAGRAPH && n < 3) continue;
    const atSide = p.box.x1 <= w * SIDE_BAND * 1.5 || p.box.x0 >= w * (1 - SIDE_BAND * 1.5);
    const narrow = p.box.x1 - p.box.x0 <= w * SIDE_BAND * 2;
    if (atSide && narrow && n < 4) continue;
    out.push({ ...p, text });
  }
  return { ...v, paragraphs: out };
}

const LONE_NUMBER = /^[\s\-–—.·•|]*(\d{1,4})[\s\-–—.·•|]*$/;
const ENDS_SENTENCE = /[.!?…:;"'”’»)\]]$/;

export function pageFromVision(read: VisionPage, seq: number, range: { firstPage?: number; lastPage?: number | null } = {}): OcrPage {
  const v = cleanVision(read);
  const h = v.height || Math.max(1, ...v.paragraphs.map((p) => p.box.y1));
  const where = (p: VisionParagraph) => (p.box.y1 <= h * PAGE_NUMBER_BAND ? "top" : p.box.y0 >= h * (1 - PAGE_NUMBER_BAND) ? "bottom" : "body");
  const inRange = (n: number) => n >= 1 && n <= (range.lastPage ?? 5000);

  // The page number: a lone number at the foot, else at the head. Any lone number in those bands is page furniture.
  const edge = v.paragraphs
    .map((p) => ({ p, at: where(p), m: p.text.match(LONE_NUMBER) }))
    .filter((x) => x.at !== "body" && x.m);
  const pick = edge.filter((x) => x.at === "bottom" && inRange(Number(x.m![1])))[0] ?? edge.filter((x) => x.at === "top" && inRange(Number(x.m![1])))[0];
  const furniture = new Set(edge.map((x) => x.p));
  const body = v.paragraphs.filter((p) => !furniture.has(p));

  const texts = body.map((p) => tidy(p.text)).filter(Boolean);
  const first = texts[0] ?? "";
  const last = texts[texts.length - 1] ?? "";
  const endsWithHyphen = /\p{L}-$/u.test(last);
  // Words: confidence weighted by length, for the same "retake" advice as the device reader.
  const letters = body.reduce((n, p) => n + (p.text.match(/\p{L}/gu)?.length ?? 0), 0);
  const sure = body.reduce((n, p) => n + (p.text.match(/\p{L}/gu)?.length ?? 0) * p.confidence, 0);
  return {
    page: {
      seq,
      pageNumber: pick ? Number(pick.m![1]) : null,
      paragraphs: texts,
      // A page that opens in lower case continues the last paragraph of the page before.
      startsMidParagraph: /^\p{Ll}/u.test(first),
      endsMidParagraph: Boolean(last) && (endsWithHyphen || !ENDS_SENTENCE.test(last)),
      endsWithHyphen,
    },
    uncertain: [...new Set(body.flatMap((p) => p.unsure))],
    quality: letters ? Math.round((sure / letters) * 100) / 100 : 0,
  };
}
