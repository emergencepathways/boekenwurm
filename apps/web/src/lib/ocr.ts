/**
 * Free page reading on the device: Tesseract.js with its Dutch model, served from this app (/tesseract/) and
 * cached after the first use (about 7 MB in all). packages/books turns its lines into the same page shape as
 * Claude's reading and PDF pages.
 */
import { pageFromOcr, pickPageNumber, type NumberCandidate, type OcrLine, type OcrPage } from "@boekenwurm/books";
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

export async function readPageOnDevice(
  image: Blob,
  seq: number,
  onProgress?: (p: number, status: string) => void,
  range: { lastPage?: number | null } = {},
): Promise<OcrPage> {
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
  const result = pageFromOcr(lines, seq);
  // A lone page number is often misread in the full-page pass, so the strips where it is printed are read again.
  const candidates = await numberStrips(w, image);
  if (result.page.pageNumber != null) candidates.push({ text: String(result.page.pageNumber), confidence: 70, where: "body" });
  result.page.pageNumber = pickPageNumber(candidates, range);
  progressCb = null;
  return result;
}

/** Tesseract's own default page layout (TessBaseAPI: a single block), restored after the digit passes. */
const DEFAULT_PARAMS = { tessedit_char_whitelist: "", tessedit_pageseg_mode: "6" } as const;

/**
 * Read the top and bottom 14% of the photo again, enlarged, with digits only, in two layouts (a block of text and
 * sparse text): what each finds is a candidate page number. Stops early once a sure reading is found at the foot.
 */
async function numberStrips(w: Worker, image: Blob): Promise<NumberCandidate[]> {
  const out: NumberCandidate[] = [];
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(image);
  } catch {
    return out;
  }
  const h = Math.round(bmp.height * 0.14);
  try {
    for (const psm of ["6", "11"] as const) {
      await w.setParameters({ tessedit_char_whitelist: "0123456789", tessedit_pageseg_mode: psm as never });
      for (const [where, top] of [["bottom", bmp.height - h], ["top", 0]] as const) {
        const canvas = document.createElement("canvas");
        canvas.width = bmp.width * 2;
        canvas.height = h * 2;
        const g = canvas.getContext("2d")!;
        g.fillStyle = "#fff";
        g.fillRect(0, 0, canvas.width, canvas.height);
        g.drawImage(bmp, 0, top, bmp.width, h, 0, 0, canvas.width, canvas.height);
        const { data } = await w.recognize(canvas, {}, { blocks: true, text: false });
        for (const b of data.blocks ?? [])
          for (const p of b.paragraphs) for (const l of p.lines) for (const wd of l.words) out.push({ text: wd.text, confidence: wd.confidence, where });
      }
      if (out.some((c) => c.where === "bottom" && c.confidence >= 85 && /^\d{1,4}$/.test(c.text))) break;
    }
  } finally {
    bmp.close();
    await w.setParameters(DEFAULT_PARAMS as never);
  }
  return out;
}

/** Free the memory the recognizer holds (when the camera flow closes). */
export async function stopReader(): Promise<void> {
  const w = worker;
  worker = null;
  if (w) await (await w).terminate().catch(() => undefined);
}
