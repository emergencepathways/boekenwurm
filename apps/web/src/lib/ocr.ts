/**
 * Free page reading on the device: Tesseract.js with its Dutch model, served from this app (/tesseract/) and
 * cached after the first use (about 7 MB in all). packages/books turns its lines into the same page shape as
 * Claude's reading and PDF pages.
 */
import { pageFromOcr, type OcrLine, type OcrPage } from "@boekenwurm/books";
import type { Worker } from "tesseract.js";

let worker: Promise<Worker> | null = null;
let progressCb: ((p: number, status: string) => void) | null = null;

function getWorker(): Promise<Worker> {
  return (worker ??= (async () => {
    const { createWorker } = await import("tesseract.js");
    const dir = new URL(`${import.meta.env.BASE_URL}tesseract/`, location.origin).href;
    return createWorker("nld", 1 /* LSTM */, {
      workerPath: `${dir}worker.min.js`,
      corePath: dir,
      langPath: dir,
      gzip: true,
      // Load the worker from this site directly (not from a blob: URL), so the content-security policy holds.
      workerBlobURL: false,
      logger: (m: { progress: number; status: string }) => progressCb?.(m.progress, m.status),
    });
  })().catch((e) => {
    worker = null;
    throw e;
  }));
}

export async function readPageOnDevice(image: Blob, seq: number, onProgress?: (p: number, status: string) => void): Promise<OcrPage> {
  progressCb = onProgress ?? null;
  const w = await getWorker();
  const { data } = await w.recognize(image, {}, { blocks: true, text: false });
  const lines: OcrLine[] = [];
  for (const block of data.blocks ?? [])
    for (const para of block.paragraphs)
      for (const line of para.lines)
        lines.push({
          text: line.text,
          bbox: line.bbox,
          confidence: line.confidence,
          words: line.words.map((wd) => ({ text: wd.text, confidence: wd.confidence })),
        });
  progressCb = null;
  return pageFromOcr(lines, seq);
}

/** Free the memory the recognizer holds (when the camera flow closes). */
export async function stopReader(): Promise<void> {
  const w = worker;
  worker = null;
  if (w) await (await w).terminate().catch(() => undefined);
}
