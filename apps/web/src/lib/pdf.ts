/**
 * PDFs in the browser with pdf.js: text PDFs become paragraphs through packages/books (line gaps, running heads,
 * hyphenation); scanned PDFs are detected and their pages rendered to images for the photo route.
 * pdf.js is loaded only when a PDF is opened.
 */
import { readPdf, type PdfJs, type PdfReading } from "@boekenwurm/books";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { canvasToJpeg } from "./images.ts";

type PdfModule = typeof import("pdfjs-dist");
let lib: Promise<PdfModule> | null = null;

function pdfjs(): Promise<PdfModule> {
  return (lib ??= import("pdfjs-dist").then((m) => {
    m.GlobalWorkerOptions.workerSrc = workerUrl;
    return m;
  }));
}

export interface PdfInfo {
  reading: PdfReading;
  title: string | null;
  author: string | null;
  pageCount: number;
}

export async function readPdfFile(file: Blob): Promise<PdfInfo> {
  const m = await pdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  let meta: { info?: Record<string, unknown> } = {};
  let pageCount = 0;
  try {
    const task = m.getDocument({ data: data.slice() });
    const doc = await task.promise;
    pageCount = doc.numPages;
    meta = (await doc.getMetadata().catch(() => ({}))) as typeof meta;
    await task.destroy();
  } catch (e) {
    if ((e as Error).name === "PasswordException") throw new Error("This PDF is password-protected, so it can't be read here.");
    throw new Error("This file isn't a readable PDF.");
  }
  const reading = await readPdf(m as unknown as PdfJs, data);
  const s = (k: string) => (typeof meta.info?.[k] === "string" && (meta.info[k] as string).trim()) || null;
  return { reading, title: s("Title"), author: s("Author"), pageCount };
}

/** Render one page (1-based) to a JPEG: the cover from page 1, or a scanned page for recognition. */
export async function renderPdfPage(file: Blob, pageNo: number, maxSide: number): Promise<Blob> {
  const m = await pdfjs();
  const task = m.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(pageNo);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: maxSide / Math.max(base.width, base.height) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    return canvasToJpeg(canvas, 0.85);
  } finally {
    await task.destroy();
  }
}
