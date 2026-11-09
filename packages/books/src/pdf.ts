/**
 * PDF text into paragraphs.
 *
 * Two layers:
 *   - linesFromItems / paragraphsFromLines: pure functions over positioned text (testable without a PDF).
 *   - readPdf: loads a PDF with pdf.js (passed in, so the app can use its own build and tests can skip it)
 *     and returns pages in the same shape page photos produce, so both go through `stitch`.
 *
 * A PDF with little or no text is a scan: the app offers the photo route for it, page by page.
 */
import type { PageText } from "./stitch.ts";

/** A run of text with its position: pdf.js TextItem, reduced to what is needed. */
export interface TextItem {
  str: string;
  /** Baseline x and y in PDF units (y grows upwards). */
  x: number;
  y: number;
  /** Font size (height of the glyphs). */
  size: number;
  width: number;
  /** True when pdf.js marks the end of a line after this item. */
  eol?: boolean;
}

export interface Line {
  text: string;
  x: number;
  y: number;
  size: number;
  right: number;
}

/** Group items into lines by baseline, left to right. */
export function linesFromItems(items: TextItem[]): Line[] {
  const sorted = items.filter((i) => i.str.trim() || i.str === " ").sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: { items: TextItem[]; y: number; size: number }[] = [];
  for (const it of sorted) {
    const line = lines.find((l) => Math.abs(l.y - it.y) <= Math.max(1.5, l.size * 0.3));
    if (line) line.items.push(it);
    else lines.push({ items: [it], y: it.y, size: it.size || 10 });
  }
  return lines
    .map((l) => {
      const its = l.items.sort((a, b) => a.x - b.x);
      let text = "";
      let lastRight = -Infinity;
      for (const it of its) {
        const gap = it.x - lastRight;
        if (text && gap > l.size * 0.15 && !text.endsWith(" ") && !it.str.startsWith(" ")) text += " ";
        text += it.str;
        lastRight = it.x + it.width;
      }
      return { text: text.replace(/\s+/g, " ").trim(), x: its[0].x, y: l.y, size: l.size, right: lastRight };
    })
    .filter((l) => l.text)
    .sort((a, b) => b.y - a.y);
}

export interface PageLayout {
  /** Lines of every page, to find running heads and page numbers repeated across pages. */
  allPages: Line[][];
}

const PAGE_NUMBER = /^(?:[-–—]\s*)?(?:pagina\s+)?(\d{1,4})(?:\s*[-–—])?$|^[A-Z]\s?\d{1,4}$/i;

/** Text that repeats at the top or bottom of many pages (running heads, book title, chapter title). */
export function runningHeads(pages: Line[][]): Set<string> {
  const counts = new Map<string, number>();
  for (const lines of pages) {
    const edge = [...lines.slice(0, 2), ...lines.slice(-2)];
    const heads = edge.filter((e) => !PAGE_NUMBER.test(e.text)).map((e) => normalizeHead(e.text));
    for (const l of new Set(heads)) counts.set(l, (counts.get(l) ?? 0) + 1);
  }
  const need = Math.max(3, Math.ceil(pages.length * 0.3));
  return new Set([...counts].filter(([t, n]) => n >= need && t.length > 0).map(([t]) => t));
}
const normalizeHead = (t: string) => t.replace(/\d+/g, "#").replace(/\s+/g, " ").trim().toLowerCase();

export interface PageParagraphs {
  pageNumber: number | null;
  paragraphs: string[];
  startsMidParagraph: boolean;
  endsMidParagraph: boolean;
  endsWithHyphen: boolean;
}

/**
 * Lines of one page into paragraphs. A new paragraph starts after a gap larger than the usual line spacing,
 * or at a line indented relative to the text's left edge. Hyphens at line ends are joined.
 */
export function paragraphsFromLines(lines: Line[], heads: Set<string> = new Set()): PageParagraphs {
  let pageNumber: number | null = null;
  const body: Line[] = [];
  lines.forEach((l, i) => {
    const edge = i < 2 || i >= lines.length - 2;
    const m = l.text.match(PAGE_NUMBER);
    if (edge && m) {
      const n = Number(m[1] ?? l.text.replace(/\D/g, ""));
      if (pageNumber == null && n > 0) pageNumber = n;
      return;
    }
    if (edge && heads.has(normalizeHead(l.text))) return;
    body.push(l);
  });
  if (!body.length) return { pageNumber, paragraphs: [], startsMidParagraph: false, endsMidParagraph: false, endsWithHyphen: false };

  const left = Math.min(...body.map((l) => l.x));
  const gaps = body.slice(1).map((l, i) => body[i].y - l.y).filter((g) => g > 0).sort((a, b) => a - b);
  const usual = gaps.length ? gaps[Math.floor(gaps.length / 2)] : body[0].size * 1.2;
  const indent = (l: Line) => l.x - left > l.size * 0.8;

  const paras: string[][] = [];
  body.forEach((l, i) => {
    const gap = i ? body[i - 1].y - l.y : 0;
    const prev = body[i - 1];
    // A short previous line ends a paragraph only when this line is also indented or set apart.
    const newPara = i === 0 || gap > usual * 1.45 || indent(l) || (prev && /[.!?:"”’]$/.test(prev.text) && l.size !== prev.size);
    if (newPara) paras.push([l.text]);
    else paras[paras.length - 1].push(l.text);
  });

  const text = paras.map((p) => joinLines(p)).filter(Boolean);
  const lastLine = body[body.length - 1].text;
  const endsWithHyphen = /\p{L}-$/u.test(lastLine);
  return {
    pageNumber,
    paragraphs: text,
    // No indent and no capital at the very start: the page continues the previous one.
    startsMidParagraph: !indent(body[0]) && /^[\p{Ll},;]/u.test(body[0].text),
    endsMidParagraph: endsWithHyphen || !/[.!?:"”’)…]$/.test(lastLine),
    endsWithHyphen,
  };
}

/** Join a paragraph's lines, rejoining words hyphenated at line ends ("boodschap-" + "pen"). */
export function joinLines(lines: string[]): string {
  let out = "";
  for (const raw of lines) {
    const line = raw.trim();
    if (!out) out = line;
    else if (/\p{Ll}-$/u.test(out) && /^\p{Ll}/u.test(line)) out = out.slice(0, -1) + line;
    else out += " " + line;
  }
  return out.replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------- reading a PDF with pdf.js

/** The parts of pdf.js used here; pass the library in (`await import("pdfjs-dist")`). */
export interface PdfJs {
  getDocument(src: { data: Uint8Array; disableFontFace?: boolean; isEvalSupported?: boolean }): { promise: Promise<PdfDoc> };
}
interface PdfDoc {
  numPages: number;
  getPage(n: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }> }>;
  destroy?(): Promise<void>;
}

export interface PdfReading {
  pages: PageText[];
  /** Pages with almost no text: likely scanned images. */
  scannedPages: number[];
  /** True when most pages have no text layer: offer the photo route. */
  isScanned: boolean;
}

export async function readPdf(pdfjs: PdfJs, data: Uint8Array, opts: { maxPages?: number } = {}): Promise<PdfReading> {
  const doc = await pdfjs.getDocument({ data, disableFontFace: true, isEvalSupported: false }).promise;
  const n = Math.min(doc.numPages, opts.maxPages ?? 2000);
  const allLines: Line[][] = [];
  for (let i = 1; i <= n; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const items: TextItem[] = [];
    for (const raw of content.items as Array<Record<string, unknown>>) {
      if (typeof raw.str !== "string" || !Array.isArray(raw.transform)) continue;
      const t = raw.transform as number[];
      items.push({ str: raw.str, x: t[4], y: t[5], size: Math.abs(t[3]) || Math.abs(Number(raw.height)) || 10, width: Number(raw.width) || 0, eol: raw.hasEOL === true });
    }
    allLines.push(linesFromItems(items));
  }
  await doc.destroy?.();
  const heads = runningHeads(allLines);
  const scannedPages: number[] = [];
  const pages: PageText[] = allLines.map((lines, i) => {
    const words = lines.reduce((acc, l) => acc + (l.text.match(/\p{L}+/gu)?.length ?? 0), 0);
    if (words < 20) scannedPages.push(i + 1);
    const p = paragraphsFromLines(lines, heads);
    return { seq: i, pageNumber: p.pageNumber ?? i + 1, paragraphs: p.paragraphs, startsMidParagraph: p.startsMidParagraph, endsMidParagraph: p.endsMidParagraph, endsWithHyphen: p.endsWithHyphen };
  });
  return { pages, scannedPages, isScanned: n > 0 && scannedPages.length / n > 0.6 };
}
