/**
 * A page read by Google Cloud Vision (the read-page function, for readers with an access code), turned into the same
 * page shape as Claude's, the device's and PDF pages, so it goes through `stitch` like the rest.
 *
 * Vision finds the paragraphs itself; this decides what the page's numbers are. A number alone in the top or bottom
 * tenth of the page is the printed page number (the foot before the head, as most books print it there) and is left
 * out of the text. A number alone further in (a chapter number above its first paragraph) is kept as text; the
 * short-paragraph rule then reads it together with the paragraph after it.
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

const LONE_NUMBER = /^[\s\-–—.·•|]*(\d{1,4})[\s\-–—.·•|]*$/;
const ENDS_SENTENCE = /[.!?…:;"'”’»)\]]$/;

export function pageFromVision(v: VisionPage, seq: number, range: { firstPage?: number; lastPage?: number | null } = {}): OcrPage {
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
