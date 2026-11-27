/**
 * Add book: an EPUB or a PDF from the reader's device, or a printed book by camera (PhotoBook.tsx).
 * Files go through the same import check as the playtest and services/ingest: Dutch paragraphs only, mixed
 * Dutch/English lines dropped, no spelling from before 1955. Then the book's level, chosen by the reader, with the
 * share of its words they know as a hint (Claude no longer grades books: DESIGN.md, 2026-11-27).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { CefrLevel } from "@boekenwurm/engine";
import { stitch } from "@boekenwurm/books";
import { readEpub } from "../lib/epub.ts";
import { readPdfFile, renderPdfPage } from "../lib/pdf.ts";
import { checkBook, isRejected, type Verdict } from "../lib/text.ts";
import { currentPageReader, hintFromWordMatch, newBook, readPhotoPage, toParagraphs, wordMatchOf } from "../lib/books.ts";
import { downscale, COVER_SIDE, OCR_SIDE, CLAUDE_SIDE } from "../lib/images.ts";
import { saveBook, saveCover, saveText } from "../lib/store.ts";
import { stopReader } from "../lib/ocr.ts";
import { hasFeature, PAGE_READS_PER_DAY, PHOTO_PAGES, usePhotoPages } from "../lib/features.ts";
import { close, open } from "../nav.ts";
import type { Book, Paragraph } from "../lib/types.ts";
import { Icon, LevelPicker, plural } from "../ui.tsx";

interface Draft {
  source: "epub" | "pdf";
  fileName: string;
  title: string;
  author: string;
  cover: Blob | null;
  coverUrl: string | null;
  paragraphs: Paragraph[];
  verdict: Verdict;
  pageCount: number | null;
}

type Step =
  | { kind: "choose" }
  | { kind: "reading"; what: string; done?: number; total?: number }
  | { kind: "scanned"; file: File; pages: number; title: string | null; author: string | null }
  | { kind: "rejected"; title: string; text: string }
  | { kind: "details"; draft: Draft };

export function AddBook() {
  const photoPages = usePhotoPages();
  const [step, setStep] = useState<Step>({ kind: "choose" });
  const [error, setError] = useState<string | null>(null);
  const stop = useRef(false);

  const fail = (e: unknown) => {
    setError((e as Error).message || String(e));
    setStep({ kind: "choose" });
  };

  async function fromEpub(file: File) {
    setError(null);
    setStep({ kind: "reading", what: `Reading ${file.name}…` });
    try {
      const epub = await readEpub(file, file.name.replace(/\.epub$/i, ""));
      const verdict = checkBook(epub.blocks);
      if (isRejected(verdict)) return setStep({ kind: "rejected", title: epub.title, text: verdict.text });
      const cover = epub.cover ? await downscale(epub.cover, COVER_SIDE).catch(() => null) : null;
      setStep({
        kind: "details",
        draft: { source: "epub", fileName: file.name, title: epub.title, author: epub.author ?? "", cover, coverUrl: cover && URL.createObjectURL(cover), paragraphs: toParagraphs(verdict.paragraphs), verdict, pageCount: null },
      });
    } catch (e) {
      fail(e);
    }
  }

  async function fromPdf(file: File) {
    setError(null);
    setStep({ kind: "reading", what: `Reading ${file.name}…` });
    try {
      const info = await readPdfFile(file);
      if (info.reading.isScanned) {
        // Scanned pages are read like photos: for access-code holders only (lib/features.ts PHOTO_PAGES).
        if (!hasFeature(PHOTO_PAGES)) {
          setStep({ kind: "choose" });
          return setError("This PDF is scanned: its pages are pictures, not text. Boekenwurm can't read scanned PDFs yet. Try an EPUB, or a PDF with text in it.");
        }
        return setStep({ kind: "scanned", file, pages: info.pageCount, title: info.title, author: info.author });
      }
      const stitched = stitch(info.reading.pages).paragraphs;
      const verdict = checkBook(stitched.map((p) => p.text));
      if (isRejected(verdict)) return setStep({ kind: "rejected", title: info.title ?? file.name, text: verdict.text });
      const keep = new Set(verdict.paragraphs);
      const kept = stitched.filter((p) => keep.has(p.text.replace(/\s+/g, " ").trim()));
      const cover = await renderPdfPage(file, 1, COVER_SIDE).catch(() => null);
      setStep({
        kind: "details",
        draft: {
          source: "pdf", fileName: file.name, title: info.title ?? file.name.replace(/\.pdf$/i, ""), author: info.author ?? "", cover,
          coverUrl: cover && URL.createObjectURL(cover), paragraphs: toParagraphs(kept), verdict, pageCount: info.pageCount,
        },
      });
    } catch (e) {
      fail(e);
    }
  }

  /** Scanned PDFs: each page is rendered and read like a photo, by the page reader chosen (lib/pagereader.ts). */
  async function readScanned(file: File, pages: number, title: string | null, author: string | null) {
    stop.current = false;
    const read = [];
    const reader = currentPageReader();
    try {
      for (let n = 1; n <= pages && !stop.current; n++) {
        setStep({ kind: "reading", what: READING[reader], done: n - 1, total: pages });
        const img = await renderPdfPage(file, n, reader === "claude" ? CLAUDE_SIDE : OCR_SIDE);
        const r = await readPhotoPage(img, n - 1);
        if (r.page.paragraphs.length) read.push({ ...r.page, pageNumber: r.page.pageNumber ?? n });
      }
    } catch (e) {
      if (!read.length) return fail(e);
      setError(`Stopped after ${plural(read.length, "page")}: ${(e as Error).message}`);
    } finally {
      if (reader === "device") void stopReader();
    }
    const stitched = stitch(read).paragraphs;
    const verdict = checkBook(stitched.map((p) => p.text));
    if (isRejected(verdict)) return setStep({ kind: "rejected", title: title ?? file.name, text: verdict.text });
    const keep = new Set(verdict.paragraphs);
    const cover = await renderPdfPage(file, 1, COVER_SIDE).catch(() => null);
    setStep({
      kind: "details",
      draft: {
        source: "pdf", fileName: file.name, title: title ?? file.name.replace(/\.pdf$/i, ""), author: author ?? "", cover,
        coverUrl: cover && URL.createObjectURL(cover), paragraphs: toParagraphs(stitched.filter((p) => keep.has(p.text.replace(/\s+/g, " ").trim()))),
        verdict, pageCount: pages,
      },
    });
  }

  return (
    <main className="screen full">
      <div className="topbar">
        <button className="back" type="button" onClick={() => (stop.current = true, close())}>
          <span style={{ width: 22, height: 22, display: "inline-block" }}><Icon.back /></span> Home
        </button>
      </div>
      <h1 className="big">Add a book</h1>

      {step.kind === "choose" && (
        <>
          <div className="tiles">
            <label className="tile">
              <span className="ico"><Icon.epub /></span>
              <span><b>EPUB file</b><span className="small muted">An ebook without copy protection (DRM). Read on this device, checked for modern Dutch.</span></span>
              <input type="file" accept=".epub,application/epub+zip" onChange={(e) => e.target.files?.[0] && void fromEpub(e.target.files[0])} />
            </label>
            <label className="tile">
              <span className="ico"><Icon.pdf /></span>
              <span><b>PDF file</b><span className="small muted">{photoPages ? "Text PDFs are read directly. Scanned PDFs are read page by page, like photos." : "A PDF with text in it (not a scan)."}</span></span>
              <input type="file" accept=".pdf,application/pdf" onChange={(e) => e.target.files?.[0] && void fromPdf(e.target.files[0])} />
            </label>
            {photoPages && (
              <button className="tile" type="button" onClick={() => open({ name: "photo" })}>
                <span className="ico"><Icon.camera /></span>
                <span><b>Photograph a book</b><span className="small muted">A printed book you own: the cover, the page count, your level for it, then its pages.</span></span>
              </button>
            )}
          </div>
          {error && <div className="verdict bad"><b>Couldn't add that file</b><span>{error}</span></div>}
          <p className="note">Your books stay private: on this device, and in your own account when you're signed in. Nothing is shared with anyone.</p>
        </>
      )}

      {step.kind === "reading" && (
        <section className="panel" aria-live="polite">
          <div className="row"><span className="spinner" /><b>{step.what}</b></div>
          {step.total != null && (
            <>
              <div className="bar"><i style={{ width: `${Math.round(((step.done ?? 0) / step.total) * 100)}%` }} /></div>
              <span className="small muted num">{step.done} / {step.total} pages</span>
              <button className="btn small" type="button" onClick={() => (stop.current = true)}>Stop and keep the pages read so far</button>
            </>
          )}
        </section>
      )}

      {step.kind === "rejected" && (
        <section className="panel">
          <div className="verdict bad"><b lang="nl">{step.title}</b><span>{step.text}</span></div>
          <button className="btn" type="button" onClick={() => setStep({ kind: "choose" })}>Choose another book</button>
        </section>
      )}

      {step.kind === "scanned" && <Scanned step={step} onRead={readScanned} onBack={() => setStep({ kind: "choose" })} />}

      {step.kind === "details" && <Details draft={step.draft} onBack={() => setStep({ kind: "choose" })} error={error} />}
    </main>
  );
}

const READING = {
  google: "Google is reading the pages…",
  "google+claude": "Google is reading the pages, and Claude is sorting out the paragraphs…",
  claude: "Claude is reading the pages…",
  device: "Reading pages on this device…",
} as const;

function Scanned({ step, onRead, onBack }: {
  step: Extract<Step, { kind: "scanned" }>;
  onRead: (f: File, pages: number, title: string | null, author: string | null) => void;
  onBack: () => void;
}) {
  const reader = currentPageReader();
  return (
    <section className="panel">
      <h2>This PDF is scanned</h2>
      <p>Its {plural(step.pages, "page")} are pictures, so the text has to be read from them first.</p>
      {reader === "claude" ? (
        <p>Claude reads the pages with your key: about {plural(step.pages, "request")}, one per page. Google's daily pages aren't used.</p>
      ) : (
        <p>
          Google reads the pages: up to {PAGE_READS_PER_DAY} a day, for all your books together. A longer PDF stops at today's limit and keeps the pages read so far.
          {reader === "google+claude" && ` Claude then sorts each page into its printed paragraphs, with your key: one request per page.`}
        </p>
      )}
      <button className="btn primary" type="button" onClick={() => onRead(step.file, step.pages, step.title, step.author)}>Read the pages</button>
      <button className="btn ghost" type="button" onClick={onBack}>Choose another file</button>
    </section>
  );
}

function Details({ draft, onBack, error }: { draft: Draft; onBack: () => void; error: string | null }) {
  const [title, setTitle] = useState(draft.title);
  const [author, setAuthor] = useState(draft.author);
  const [level, setLevel] = useState<CefrLevel | null>(null);
  const [saving, setSaving] = useState(false);
  const wordMatch = useMemo(() => wordMatchOf({ bookId: "draft", paragraphs: draft.paragraphs }), [draft]);
  const hint = hintFromWordMatch(wordMatch);
  useEffect(() => void (hint && setLevel((l) => l ?? hint)), [hint]);

  async function save() {
    if (!level) return;
    setSaving(true);
    const book: Book = newBook({
      source: draft.source, title: title.trim() || draft.title, author: author.trim() || null, level, levelSource: "reader",
      paragraphCount: draft.paragraphs.length, pageCount: draft.pageCount, hasCover: Boolean(draft.cover),
    });
    if (draft.cover) await saveCover(book.id, draft.cover);
    await saveText({ bookId: book.id, paragraphs: draft.paragraphs });
    await saveBook(book);
    open({ name: "reader", bookId: book.id });
  }

  return (
    <>
      <div className={`verdict ${draft.verdict.kind === "warn_borderline" ? "warn" : ""}`}>
        <b>{draft.verdict.kind === "warn_borderline" ? "Usable, with a few old forms" : "Ready to read"}</b>
        <span className="small">{draft.verdict.text}</span>
      </div>
      {error && <p className="error">{error}</p>}
      <section className="panel">
        <div style={{ display: "grid", gridTemplateColumns: draft.coverUrl ? "96px 1fr" : "1fr", gap: 14 }}>
          {draft.coverUrl && <div className="cover"><img src={draft.coverUrl} alt="Cover" /></div>}
          <div className="stack">
            <label className="field"><span>Title</span><input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} lang="nl" /></label>
            <label className="field"><span>Author</span><input value={author} onChange={(e) => setAuthor(e.target.value)} maxLength={200} /></label>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>The book's level</h2>
        <p>
          Choose the level this book feels like to you.
          {wordMatch != null && ` You know about ${Math.round(wordMatch * 100)}% of its words${hint ? `, which suggests about ${hint}` : ""}.`}
        </p>
        <LevelPicker value={level} onChange={setLevel} label="Book level" />
        <p className="small muted">{plural(draft.paragraphs.length, "paragraph")}{draft.pageCount ? ` · ${plural(draft.pageCount, "page")}` : ""}</p>
      </section>

      <div className="actions">
        <button className="btn primary" type="button" disabled={!level || saving} onClick={() => void save()}>
          {level ? "Add to my books" : "Choose a level first"}
        </button>
        <button className="btn ghost" type="button" onClick={onBack}>Cancel</button>
      </div>
    </>
  );
}
