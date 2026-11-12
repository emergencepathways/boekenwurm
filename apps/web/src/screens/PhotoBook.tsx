/**
 * Photographing a printed book (ARCHITECTURE.md, "Photographing a book you own"):
 *   1. cover (Claude reads title, author and ISBN with a key; typed in free mode),
 *   2. details: the first page to read and the last page (progress counts the pages between), the book's level, ISBN,
 *   3. pages, in sections of up to 20 photos per visit: each photo is numbered in the order taken, from the first
 *      page (lib/pages.ts), and read in the background (Claude with a key, the device for free). The number read from
 *      the photo is shown next to its page number; where they differ the reader can change it, and the pages after
 *      it follow. A retake replaces the photo in its place, so the order holds. When a section ends with a gap in the
 *      page numbers, the reader is asked: a missed page (photograph it now) or a page with no text (a picture, map,
 *      or left out on purpose).
 * Pages are stitched into paragraphs across page breaks, in page order.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { CefrLevel } from "@boekenwurm/engine";
import { normalizeIsbn } from "@boekenwurm/ai";
import { bookProgress } from "@boekenwurm/books";
import { bookById, loadText, saveBook, saveCover, saveText, useStore } from "../lib/store.ts";
import {
  arrange, differs, flags, inSection as countInSection, isBusy, keepEarlierOrder, keepPosition, markNoText, missingPages, nextPage, nextSection,
  numberPages, SECTION_SIZE, stitchBook, type PageEntry, type Placed, type Range,
} from "../lib/pages.ts";
import { newBook, readCover, readPhotoPage, toParagraphs } from "../lib/books.ts";
import { GOOGLE_PAGES, PAGE_READS_PER_DAY } from "../lib/features.ts";
import { downscale, COVER_SIDE, OCR_SIDE } from "../lib/images.ts";
import { checkBook } from "../lib/text.ts";
import { db } from "../lib/db.ts";
import { stopReader } from "../lib/ocr.ts";
import { AiError } from "../lib/claude.ts";
import { close, open } from "../nav.ts";
import { Icon, LevelPicker, plural, toast } from "../ui.tsx";

const EXPLAINED = "boekenwurm-camera-explained";
const explained = () => {
  try {
    return localStorage.getItem(EXPLAINED) === "1";
  } catch {
    return false;
  }
};

export function PhotoBook({ bookId }: { bookId?: string }) {
  const existing = bookId ? bookById(bookId) : null;
  const [step, setStep] = useState<"why" | "cover" | "details" | "pages">(existing ? "pages" : explained() ? "cover" : "why");
  const [cover, setCover] = useState<Blob | null>(null);
  const [details, setDetails] = useState<Details>({ title: "", author: "", isbn: "", firstPage: "1", lastPage: "", level: null });
  const [id, setId] = useState<string | null>(existing?.id ?? null);

  useEffect(() => () => void stopReader(), []);

  return (
    <main className="screen full">
      <div className="topbar">
        <button className="back" type="button" onClick={close}>
          <span style={{ width: 22, height: 22, display: "inline-block" }}><Icon.back /></span> {id ? "Done" : "Cancel"}
        </button>
        <span className="grow" />
        {!existing && (
          <div className="steps" style={{ width: 120 }} aria-label="Steps">
            {["cover", "details", "pages"].map((s, i) => <i key={s} className={["cover", "details", "pages"].indexOf(step) >= i ? "on" : ""} />)}
          </div>
        )}
      </div>
      {step === "why" && <Why onNext={() => setStep("cover")} />}
      {step === "cover" && (
        <CoverStep
          onDone={(blob, read) => {
            setCover(blob);
            setDetails((d) => ({ ...d, title: read?.title || d.title, author: read?.author || d.author, isbn: read?.isbn || d.isbn }));
            setStep("details");
          }}
        />
      )}
      {step === "details" && cover && (
        <DetailsStep
          cover={cover}
          details={details}
          onChange={setDetails}
          onRetake={() => setStep("cover")}
          onSave={async () => {
            const book = newBook({
              source: "photo", title: details.title.trim(), author: details.author.trim() || null, isbn: normalizeIsbn(details.isbn),
              firstPage: Number(details.firstPage), pageCount: Number(details.lastPage), level: details.level, levelSource: "reader", status: "processing", hasCover: true,
            });
            await saveCover(book.id, cover);
            await saveBook(book);
            setId(book.id);
            setStep("pages");
          }}
        />
      )}
      {step === "pages" && id && <PagesStep bookId={id} />}
    </main>
  );
}

// ---------------------------------------------------------------- 0. why the camera

function Why({ onNext }: { onNext: () => void }) {
  return (
    <section className="panel">
      <div className="tile" style={{ border: 0, padding: 0, cursor: "default" }}>
        <span className="ico"><Icon.camera /></span>
        <span><b>Boekenwurm will ask to use your camera</b></span>
      </div>
      <p>To add a printed book you own, you photograph its cover and then its pages. The photos turn into paragraphs to read.</p>
      <ul className="small muted" style={{ margin: 0, paddingLeft: "1.2em", display: "grid", gap: 6 }}>
        <li>Photos stay private: on this device, and their text in your own account when you're signed in.</li>
        <li>With your Claude key, Claude reads them. Without it, they're read on this device for free.</li>
        <li>If you'd rather not allow the camera, you can pick photos from your library instead.</li>
      </ul>
      <button
        className="btn primary"
        type="button"
        onClick={() => {
          try {
            localStorage.setItem(EXPLAINED, "1");
          } catch {
            /* ignore */
          }
          onNext();
        }}
      >
        Take photo
      </button>
    </section>
  );
}

// ---------------------------------------------------------------- the camera

type CamState = "starting" | "live" | "denied" | "unavailable";

/**
 * The back camera, live, so pages can be photographed one after another. Where live video isn't possible (or
 * permission is refused), the file input with capture="environment" opens the phone's own camera, and the
 * library picker always works.
 */
function useCamera(active: boolean) {
  const video = useRef<HTMLVideoElement | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const [state, setState] = useState<CamState>("starting");

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    if (!navigator.mediaDevices?.getUserMedia) {
      setState("unavailable");
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 3264 }, height: { ideal: 2448 } }, audio: false })
      .then((s) => {
        if (stopped) return s.getTracks().forEach((t) => t.stop());
        stream.current = s;
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play().catch(() => undefined);
        }
        setState("live");
      })
      .catch((e: DOMException) => setState(e.name === "NotAllowedError" || e.name === "SecurityError" ? "denied" : "unavailable"));
    return () => {
      stopped = true;
      stream.current?.getTracks().forEach((t) => t.stop());
      stream.current = null;
    };
  }, [active]);

  const capture = useCallback(async (): Promise<Blob | null> => {
    const v = video.current;
    const track = stream.current?.getVideoTracks()[0];
    // ImageCapture takes a full-resolution still where the browser supports it (Android Chrome).
    const IC = (window as unknown as { ImageCapture?: new (t: MediaStreamTrack) => { takePhoto(): Promise<Blob> } }).ImageCapture;
    if (IC && track) {
      try {
        return await new IC(track).takePhoto();
      } catch {
        /* fall back to a video frame */
      }
    }
    if (!v || !v.videoWidth) return null;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    return new Promise((resolve) => c.toBlob((b) => resolve(b), "image/jpeg", 0.92));
  }, []);

  return { video, state, capture };
}

function Camera({ onPhoto, busy, hint }: { onPhoto: (b: Blob) => void; busy?: boolean; hint: string }) {
  const { video, state, capture } = useCamera(true);
  const pick = (files: FileList | null) => {
    for (const f of Array.from(files ?? [])) onPhoto(f);
  };
  return (
    <div className="stack">
      {state === "live" || state === "starting" ? (
        <div className="camera">
          <video ref={video} playsInline muted autoPlay aria-label="Camera view" />
          <div className="guide" />
        </div>
      ) : (
        <div className="panel">
          <p>
            {state === "denied"
              ? "Camera access was refused. You can allow it in your browser's settings for this site, or take photos with your phone's camera below."
              : "Live camera isn't available here. Take a photo with your phone's camera, or pick one from your library."}
          </p>
        </div>
      )}
      <p className="small muted" style={{ margin: 0, textAlign: "center" }}>{hint}</p>
      <div className="camrow">
        <label className="btn small ghost" style={{ position: "relative", justifySelf: "start" }}>
          Library
          <input type="file" accept="image/*" multiple style={{ position: "absolute", inset: 0, opacity: 0 }} onChange={(e) => (pick(e.target.files), (e.target.value = ""))} />
        </label>
        {state === "live" ? (
          <button className="shutter" type="button" aria-label="Take photo" disabled={busy} onClick={async () => {
            const b = await capture();
            if (b) onPhoto(b);
            else toast("The camera isn't ready yet.");
          }} />
        ) : (
          <label className="btn primary" style={{ position: "relative" }}>
            Take photo
            <input type="file" accept="image/*" capture="environment" style={{ position: "absolute", inset: 0, opacity: 0 }} onChange={(e) => (pick(e.target.files), (e.target.value = ""))} />
          </label>
        )}
        <span />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 1. cover

function CoverStep({ onDone }: { onDone: (b: Blob, read: { title: string; author: string; isbn: string | null } | null) => void }) {
  const hasKey = useStore((s) => s.hasKey);
  const [busy, setBusy] = useState(false);
  const take = async (photo: Blob) => {
    setBusy(true);
    const blob = await downscale(photo, COVER_SIDE).catch(() => photo);
    let read: { title: string; author: string; isbn: string | null } | null = null;
    if (hasKey) {
      try {
        read = await readCover(photo);
      } catch (e) {
        toast(e instanceof AiError ? e.message : "Couldn't read the cover; type the title instead.", 5000);
      }
    }
    setBusy(false);
    onDone(blob, read);
  };
  return (
    <>
      <h1 className="big">The cover</h1>
      {busy ? (
        <section className="panel"><div className="row"><span className="spinner" /><span>{hasKey ? "Reading the title and author…" : "Saving the cover…"}</span></div></section>
      ) : (
        <Camera onPhoto={(b) => void take(b)} hint={hasKey ? "Fill the frame with the front cover. Claude reads the title and author." : "Fill the frame with the front cover."} />
      )}
    </>
  );
}

// ---------------------------------------------------------------- 2. details

interface Details {
  title: string;
  author: string;
  isbn: string;
  firstPage: string;
  lastPage: string;
  level: CefrLevel | null;
}

function DetailsStep({ cover, details, onChange, onRetake, onSave }: {
  cover: Blob;
  details: Details;
  onChange: (d: Details) => void;
  onRetake: () => void;
  onSave: () => Promise<void>;
}) {
  const [url] = useState(() => URL.createObjectURL(cover));
  const [saving, setSaving] = useState(false);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const first = Number(details.firstPage);
  const last = Number(details.lastPage);
  const firstOk = Number.isInteger(first) && first >= 1 && first <= 5000;
  const lastOk = Number.isInteger(last) && last >= 1 && last <= 5000;
  const orderOk = !firstOk || !lastOk || first <= last;
  const isbnOk = !details.isbn.trim() || normalizeIsbn(details.isbn) != null;
  const ok = details.title.trim() && firstOk && lastOk && orderOk && details.level && isbnOk;
  const set = (patch: Partial<Details>) => onChange({ ...details, ...patch });
  return (
    <>
      <h1 className="big">About this book</h1>
      <section className="panel">
        <div style={{ display: "grid", gridTemplateColumns: "96px 1fr", gap: 14, alignItems: "start" }}>
          <div className="stack" style={{ gap: 6 }}>
            <div className="cover"><img src={url} alt="Cover photo" /></div>
            <button className="btn small ghost" type="button" onClick={onRetake}>Retake</button>
          </div>
          <div className="stack">
            <label className="field"><span>Title</span><input value={details.title} onChange={(e) => set({ title: e.target.value })} maxLength={300} lang="nl" required /></label>
            <label className="field"><span>Author</span><input value={details.author} onChange={(e) => set({ author: e.target.value })} maxLength={200} /></label>
          </div>
        </div>
        <div className="row" style={{ alignItems: "start" }}>
          <label className="field grow" style={{ minWidth: 120 }}>
            <span>First page to read</span>
            <input type="number" inputMode="numeric" min={1} max={5000} value={details.firstPage} onChange={(e) => set({ firstPage: e.target.value })} />
          </label>
          <label className="field grow" style={{ minWidth: 120 }}>
            <span>Last page</span>
            <input type="number" inputMode="numeric" min={1} max={5000} value={details.lastPage} onChange={(e) => set({ lastPage: e.target.value })} placeholder="e.g. 212" />
          </label>
        </div>
        <span className="note">
          Start where you want to begin: skip the title pages and contents, and the prologue too if you like.{" "}
          {firstOk && lastOk && orderOk ? <b>That's {plural(last - first + 1, "page")} to read.</b> : null}
        </span>
        {!orderOk && <span className="error">The first page comes after the last page. Check both numbers.</span>}
        <div className="field">
          <span>The book's level</span>
          <LevelPicker value={details.level} onChange={(level) => set({ level })} label="The book's level" />
          <span className="note">How hard does it feel to you? You can change it later.</span>
        </div>
        <label className="field">
          <span>ISBN (optional)</span>
          <input inputMode="numeric" value={details.isbn} onChange={(e) => set({ isbn: e.target.value })} placeholder="On the back cover, above the barcode" />
          {!isbnOk && <span className="error">That ISBN doesn't check out. Leave it empty or check the digits.</span>}
        </label>
      </section>
      <button className="btn primary block" type="button" disabled={!ok || saving} onClick={async () => (setSaving(true), await onSave())}>
        Next: photograph the pages
      </button>
    </>
  );
}

// ---------------------------------------------------------------- 3. pages

function PagesStep({ bookId }: { bookId: string }) {
  const hasKey = useStore((s) => s.hasKey);
  const preferFree = useStore((s) => s.profile.settings.preferFreeReading);
  const book = useStore((s) => s.books.find((b) => b.id === bookId) ?? null);
  const useClaude = hasKey && !preferFree;
  const googlePages = useStore((s) => s.features.includes(GOOGLE_PAGES));
  const range: Range = { firstPage: book?.firstPage ?? 1, lastPage: book?.pageCount ?? null };
  const [pages, setPages] = useState<PageEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [section, setSection] = useState(1);
  const [progress, setProgress] = useState<string | null>(null);
  const [checking, setChecking] = useState<number | null>(null);
  const [retaking, setRetaking] = useState<number | null>(null);
  const [thumbVersion, setThumbVersion] = useState(0); // a retake changes the photo under the same slot
  // Missed pages being photographed now: each next photo takes the next of these numbers.
  const [fill, setFill] = useState<number[]>([]);
  const fillRef = useRef<number[]>([]);
  fillRef.current = fill;
  // The missed-page question: shown when a section ends, or before leaving with gaps; "Decide later" hides it.
  const [gapAsk, setGapAsk] = useState<{ then: (() => void) | null } | null>(null);
  const [gapsLater, setGapsLater] = useState(false);
  const queue = useRef<Array<{ seq: number; blob: Blob }>>([]);
  const working = useRef(false);
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const rangeRef = useRef(range);
  rangeRef.current = range;

  // Pages photographed before. This visit is a new section of up to 20 photos.
  useEffect(() => {
    void (async () => {
      let list = (await db.get<PageEntry[]>("kv", `pages:${bookId}`)) ?? [];
      // Photographed before pages were numbered by capture order: keep the order the reader already has.
      if (list.length && (await db.get<number>("kv", `pages-numbering:${bookId}`)) !== 2) {
        list = keepEarlierOrder(list, rangeRef.current);
        await db.put("kv", list, `pages:${bookId}`);
      }
      await db.put("kv", 2, `pages-numbering:${bookId}`);
      pagesRef.current = list;
      setPages(list);
      setSection(nextSection(list));
      setLoaded(true);
    })();
  }, [bookId]);

  const persist = useCallback(
    async (list: PageEntry[]) => {
      await db.put("kv", list, `pages:${bookId}`);
      const b = bookById(bookId);
      if (!b) return;
      // Pages are placed in reading order before stitching, so the book reads in order whatever was taken when.
      const stitched = stitchBook(list, rangeRef.current);
      // The same language and spelling check as files, on what was read.
      const verdict = checkBook(stitched.map((p) => p.text));
      const keep = new Set(verdict.paragraphs);
      const paragraphs = toParagraphs(stitched.filter((p) => keep.has(p.text.replace(/\s+/g, " ").trim()) || p.text.split(/\s+/).length < 8));
      // The reader stays on the paragraph they were at, even when an earlier page arrives later.
      const old = await loadText(bookId);
      const ord = keepPosition(old?.paragraphs ?? [], b.position.ord, paragraphs);
      await saveText({ bookId, paragraphs });
      await saveBook({
        ...b, paragraphCount: paragraphs.length, status: paragraphs.length ? "ready" : "processing", textSynced: false,
        position: { ...b.position, ord }, nextSeq: Math.max(b.nextSeq, ...list.map((p) => p.seq + 1)),
      });
    },
    [bookId],
  );

  const update = (seq: number, patch: Partial<PageEntry>) => {
    const next = pagesRef.current.map((p) => (p.seq === seq ? { ...p, ...patch } : p));
    pagesRef.current = next;
    setPages(next);
    return next;
  };

  const work = useCallback(async () => {
    if (working.current) return;
    working.current = true;
    while (queue.current.length) {
      const job = queue.current.shift()!;
      update(job.seq, { status: "reading" });
      try {
        const r = await readPhotoPage(job.blob, job.seq, useClaude, (p, s) => setProgress(s === "reading with Google" ? "Google is reading the page…" : s === "recognizing text" ? `Reading… ${Math.round(p * 100)}%` : "Getting the Dutch reading model ready…"), { lastPage: rangeRef.current.lastPage });
        // Unsure words don't hold a page back: it is used at once and flagged for an optional quick check.
        const status: PageEntry["status"] = r.problems.length ? "check" : "done";
        await persist(update(job.seq, { status, page: r.page, problems: r.problems, uncertain: r.uncertain, by: r.by, fallback: r.fallback }));
      } catch (e) {
        await persist(update(job.seq, { status: "failed", problems: [e instanceof AiError ? e.message : (e as Error).message || "Couldn't read this page."] }));
      }
      setProgress(null);
    }
    working.current = false;
  }, [persist, useClaude]);

  /**
   * A new photo: it claims the next slot in this visit's section at once (so several photos picked together get
   * distinct slots, in the order picked, and the section stops at 20), then is stored and read in the background.
   */
  const add = (photo: Blob) => {
    // A missed page: it takes its number and slots into place, outside the section's 20.
    const missed = fillRef.current[0];
    if (missed == null && countInSection(pagesRef.current, section) >= SECTION_SIZE) {
      toast(`This section is full: ${SECTION_SIZE} photos. Read them, then photograph the next section.`);
      return;
    }
    if (missed != null) {
      fillRef.current = fillRef.current.slice(1);
      setFill(fillRef.current);
    }
    const seq = Math.max(bookById(bookId)?.nextSeq ?? 0, ...pagesRef.current.map((p) => p.seq + 1));
    const entry: PageEntry = {
      seq, section, status: "queued", page: null, problems: [], uncertain: [], by: null, ...(missed != null ? { manualPage: missed, filled: true } : {}),
    };
    const next = [...pagesRef.current, entry];
    pagesRef.current = next;
    setPages(next);
    void (async () => {
      const small = await downscale(photo, OCR_SIDE, 0.9).catch(() => photo);
      await db.put("blobs", small, `page:${bookId}:${seq}`);
      setThumbVersion((v) => v + 1);
      const b = bookById(bookId);
      if (b && b.nextSeq <= seq) await saveBook({ ...b, nextSeq: seq + 1 }, { sync: false });
      queue.current.push({ seq, blob: small });
      queue.current.sort((x, y) => x.seq - y.seq);
      void work();
    })();
  };

  /** A retake: the new photo replaces the old one in the same slot, so its place in the book doesn't change. */
  const replace = async (seq: number, photo: Blob) => {
    setRetaking(null);
    const small = await downscale(photo, OCR_SIDE, 0.9).catch(() => photo);
    await db.put("blobs", small, `page:${bookId}:${seq}`);
    update(seq, { status: "queued", page: null, problems: [], uncertain: [], by: null, fallback: undefined });
    setThumbVersion((v) => v + 1);
    queue.current.push({ seq, blob: small });
    void work();
    toast("Photo replaced. It keeps its place in the book.");
  };

  const retry = async (seq: number) => {
    const blob = await db.get<Blob>("blobs", `page:${bookId}:${seq}`);
    if (!blob) return toast("That photo isn't on this device any more. Retake it.");
    update(seq, { status: "queued", problems: [] });
    queue.current.push({ seq, blob });
    void work();
  };

  /** Pages with no text to read (a picture, a map, or left out on purpose): no longer missing, and counted as read. */
  const markNoTextPages = async (run: number[]) => {
    const seq = Math.max(bookById(bookId)?.nextSeq ?? 0, ...pagesRef.current.map((p) => p.seq + 1));
    const next = markNoText(pagesRef.current, run, seq, section);
    pagesRef.current = next;
    setPages(next);
    await persist(next);
    const b = bookById(bookId);
    if (b) await saveBook({ ...b, pagesRead: [...new Set([...b.pagesRead, ...run])].sort((x, y) => x - y) });
  };

  /** Photograph missed pages now: the next photos take these numbers. */
  const photographMissed = (run: number[]) => {
    fillRef.current = run;
    setFill(run);
    setGapAsk(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  /** Undo a "no text" mark: the page is missing again (or is about to be photographed). */
  const unmarkNoText = async (seq: number, thenPhotograph: boolean) => {
    const n = pagesRef.current.find((p) => p.seq === seq)?.manualPage ?? null;
    const next = pagesRef.current.filter((p) => p.seq !== seq);
    pagesRef.current = next;
    setPages(next);
    setChecking(null);
    await persist(next);
    const b = bookById(bookId);
    if (b && n != null) await saveBook({ ...b, pagesRead: b.pagesRead.filter((x) => x !== n) });
    if (thenPhotograph && n != null) photographMissed([n]);
  };

  const remove = async (seq: number) => {
    const next = pagesRef.current.filter((p) => p.seq !== seq);
    pagesRef.current = next;
    setPages(next);
    setChecking(null);
    await db.del("blobs", `page:${bookId}:${seq}`);
    await persist(next);
  };

  const placed = arrange(pages, range);
  const flagged = placed.filter((p) => flags(p, placed, range).length);
  const inSection = countInSection(pages, section);
  const filling = fill.length > 0;
  const full = inSection >= SECTION_SIZE && !filling;
  const gaps = missingPages(pages, range);
  // Leaving with gaps (Start reading, Add more later): ask first, once per visit.
  const finish = (then: () => void) => (gaps.length && !gapsLater && !filling ? setGapAsk({ then }) : then());
  const askGaps = gaps.length > 0 && !filling && !retaking && (gapAsk != null || (full && !gapsLater));
  const ready = pages.filter((p) => p.status === "done").length;
  const busy = pages.filter(isBusy).length;
  const startAt = nextPage(pages, range);
  const retakeOf = retaking != null ? placed.find((p) => p.entry.seq === retaking) : null;
  // The page number the next photo will get.
  const upcoming = filling ? fill[0] : numberPages([...pages, { seq: Number.MAX_SAFE_INTEGER, section, status: "queued", page: null, problems: [], uncertain: [], by: null }], range).get(Number.MAX_SAFE_INTEGER)!;
  const read = book?.pageCount ? bookProgress(book.pageCount, placed.filter((p) => p.entry.status === "done" && p.pageNumber != null).map((p) => p.pageNumber!), range.firstPage) : null;

  const openNext = (afterSeq: number | null) => {
    const i = afterSeq == null ? -1 : flagged.findIndex((p) => p.entry.seq === afterSeq);
    const next = flagged[i + 1] ?? null;
    setChecking(next ? next.entry.seq : null);
  };

  if (!loaded) return <div className="spinner" />;

  return (
    <>
      <h1 className="big">The pages</h1>
      <p className="muted" style={{ margin: 0 }}>
        {retakeOf
          ? `Retake page ${retakeOf.pageNumber}. It goes back in the same place.`
          : filling
            ? `Photograph page ${fill[0]}${fill.length > 1 ? ` (then ${fill.slice(1).join(", ")})` : ""}. It goes into its place in the book.`
            : full
            ? `This section is done: ${SECTION_SIZE} photos.`
            : `Section ${section}: photograph up to ${SECTION_SIZE} pages in order${inSection ? "" : `, starting at page ${startAt}`}. ${useClaude ? "Claude reads each page (one request per page)." : googlePages ? `Google reads each page (${PAGE_READS_PER_DAY} a day, then this device).` : "Each page is read on this device, for free."}`}
      </p>

      {askGaps && (
        <GapPrompt
          runs={gaps}
          onPhotograph={photographMissed}
          onNoText={(run) => void markNoTextPages(run)}
          onLater={() => {
            const then = gapAsk?.then ?? null;
            setGapAsk(null);
            setGapsLater(true);
            then?.();
          }}
        />
      )}

      {retakeOf ? (
        <>
          <Camera key={`retake-${retaking}`} onPhoto={(b) => void replace(retakeOf.entry.seq, b)} hint="Flat, in good light, the whole page in the frame, with its page number." />
          <button className="btn ghost" type="button" onClick={() => setRetaking(null)}>Cancel the retake</button>
        </>
      ) : filling ? (
        <>
          <Camera key="missed" onPhoto={add} hint={`The missed page: page ${fill[0]}.`} />
          <button className="btn ghost" type="button" onClick={() => setFill([])}>Stop: decide later</button>
        </>
      ) : full ? (
        <section className="panel">
          <h2>{flagged.length ? `Check ${plural(flagged.length, "flagged page")}, then read` : "All set: time to read"}</h2>
          <p>
            Read these pages before photographing more. When you reach the end, Boekenwurm asks for the next {SECTION_SIZE}, from page {startAt}.
          </p>
          <div className="actions">
            {flagged.length > 0 && <button className="btn" type="button" onClick={() => openNext(null)}>Review flagged pages</button>}
            <button className="btn primary" type="button" disabled={!ready} onClick={() => finish(() => open({ name: "reader", bookId }))}>Start reading</button>
          </div>
        </section>
      ) : (
        <>
          <Camera key="camera" onPhoto={add} hint="One page per photo, flat and in good light, with the page number in the frame." />
          <p className="small muted num" style={{ margin: 0, textAlign: "center" }}>
            Next photo: <b>page {upcoming}</b> · {inSection} of {SECTION_SIZE} in this section
          </p>
        </>
      )}
      {progress && <p className="small muted" aria-live="polite" style={{ margin: 0 }}>{progress}</p>}

      {placed.length > 0 && (
        <div className="thumbs" aria-label="Photographed pages, in reading order">
          {placed.map((p) => {
            if (p.entry.noText)
              return (
                <button key={p.entry.seq} type="button" className="thumb notext" onClick={() => setChecking(p.entry.seq)}
                  style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }} aria-label={`Page ${p.pageNumber}, no text to read`}>
                  <span className="img"><span className="blank">no text</span></span>
                  <span className="pg">p. {p.pageNumber}</span>
                  <span className="seen">picture</span>
                </button>
              );
            const f = flags(p, placed, range);
            const off = differs(p, range);
            const seen = isBusy(p.entry) ? "reading…" : p.seen != null ? `read ${p.seen}` : "read –";
            return (
              <button key={p.entry.seq} type="button" className={`thumb ${p.entry.status}${f.length && p.entry.status === "done" ? " check" : ""}`}
                onClick={() => !isBusy(p.entry) && setChecking(p.entry.seq)} style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }}
                aria-label={`Page ${p.pageNumber}${p.typed ? " (typed)" : ""}, ${p.seen != null ? `read on the photo as ${p.seen}` : "no number read on the photo"}${f.length ? ", needs a look" : ""}`}>
                <PageThumb bookId={bookId} seq={p.entry.seq} spinning={isBusy(p.entry)} version={thumbVersion} />
                <span className="pg">p. {p.pageNumber}{p.typed ? "*" : ""}{p.entry.status === "failed" ? " ✗" : f.length ? " ⚑" : ""}</span>
                <span className={`seen${off ? " off" : ""}`}>{seen}</span>
              </button>
            );
          })}
        </div>
      )}
      {flagged.length > 0 && !full && (
        <p className="small" style={{ margin: 0 }}>
          ⚑ {plural(flagged.length, "page")} {flagged.length === 1 ? "needs" : "need"} a look.{" "}
          <button className="btn small ghost" type="button" onClick={() => openNext(null)}>Review</button>
        </p>
      )}
      {read && <p className="small muted" style={{ margin: 0 }}>{plural(read.pagesRead, "page")} of {read.pageCount} in the book so far.</p>}
      {placed.length > 0 && (
        <p className="small muted" style={{ margin: 0 }}>
          Pages are numbered in the order you take them. Under each: the number read from the photo. Tap a page to change its number;
          the pages after it follow.{placed.some((p) => p.typed) ? " * You typed this number." : ""}
        </p>
      )}
      {gaps.length > 0 && !askGaps && !filling && (
        <p className="small muted" style={{ margin: 0 }}>
          Missing so far: page {gaps.map((r) => (r.length === 1 ? r[0] : `${r[0]}–${r[r.length - 1]}`)).join(", ")}. Reading skips over gaps.{" "}
          <button className="btn small ghost" type="button" onClick={() => setGapAsk({ then: null })}>Photograph or mark them</button>
        </p>
      )}

      {checking != null && placed.find((p) => p.entry.seq === checking)?.entry.noText && (
        <section className="panel" aria-label="A page with no text">
          <b>Page {placed.find((p) => p.entry.seq === checking)!.pageNumber}</b>
          <p style={{ margin: 0 }}>Marked as having no text to read: a picture, a map, or left out on purpose. It counts as read.</p>
          <div className="actions">
            <button className="btn small" type="button" onClick={() => void unmarkNoText(checking, true)}>Photograph it instead</button>
            <button className="btn small ghost" type="button" onClick={() => void unmarkNoText(checking, false)}>Remove the mark</button>
            <button className="btn small ghost" type="button" onClick={() => setChecking(null)}>Close</button>
          </div>
        </section>
      )}
      {checking != null && placed.find((p) => p.entry.seq === checking) && !placed.find((p) => p.entry.seq === checking)!.entry.noText && (
        <CheckPage
          key={checking}
          placed={placed.find((p) => p.entry.seq === checking)!}
          reasons={flags(placed.find((p) => p.entry.seq === checking)!, placed, range)}
          position={flagged.findIndex((p) => p.entry.seq === checking)}
          total={flagged.length}
          bookId={bookId}
          version={thumbVersion}
          onSave={async (patch) => {
            await persist(update(checking, patch));
            openNext(checking);
          }}
          onRetake={() => {
            setRetaking(checking);
            setChecking(null);
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
          onRetry={() => (setChecking(null), void retry(checking))}
          onRemove={() => void remove(checking)}
          onNext={() => openNext(checking)}
          onClose={() => setChecking(null)}
        />
      )}

      {!full && !retakeOf && !filling && !askGaps && (
        <div className="actions">
          <button className="btn primary" type="button" disabled={!ready} onClick={() => finish(() => open({ name: "reader", bookId }))}>
            {busy ? `Start reading (${plural(busy, "page")} still reading)` : "Start reading"}
          </button>
          <button className="btn ghost" type="button" onClick={() => finish(close)}>Add more later</button>
        </div>
      )}
    </>
  );
}

/**
 * The end of a section with a gap in the page numbers: was a page missed (photograph it now, and it slots into its
 * place), or does it have no text to read (a picture, a map, or left out on purpose)? One gap at a time.
 */
function GapPrompt({ runs, onPhotograph, onNoText, onLater }: {
  runs: number[][];
  onPhotograph: (run: number[]) => void;
  onNoText: (run: number[]) => void;
  onLater: () => void;
}) {
  const run = runs[0];
  const name = run.length === 1 ? `page ${run[0]}` : `pages ${run[0]}–${run[run.length - 1]}`;
  return (
    <section className="panel gapask" role="group" aria-label="Missed a page?">
      <h2>Missed a page?</h2>
      <p style={{ margin: 0 }}>
        {name[0].toUpperCase() + name.slice(1)} {run.length === 1 ? "isn't" : "aren't"} in the book.
        {runs.length > 1 ? <span className="muted"> ({plural(runs.length, "gap")} to check.)</span> : null}
      </p>
      <div className="actions">
        <button className="btn primary small" type="button" onClick={() => onPhotograph(run)}>Photograph {name}</button>
        <button className="btn small" type="button" onClick={() => onNoText(run)}>
          No text: {run.length === 1 ? "it's" : "they're"} a picture, a map, or left out on purpose
        </button>
      </div>
      <button className="btn small ghost" type="button" style={{ justifySelf: "start" }} onClick={onLater}>Decide later</button>
    </section>
  );
}

function PageThumb({ bookId, seq, spinning, version = 0 }: { bookId: string; seq: number; spinning: boolean; version?: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null;
    void db.get<Blob>("blobs", `page:${bookId}:${seq}`).then((b) => b && setUrl((u = URL.createObjectURL(b))));
    return () => void (u && URL.revokeObjectURL(u));
  }, [bookId, seq, version]);
  return (
    <span className="img">
      {url && <img src={url} alt="" />}
      {spinning && <span className="spinner" />}
    </span>
  );
}

/**
 * One photo, opened from its thumbnail or the review (1 of N flagged, in reading order): its page number next to the
 * number read from the photo, to change when they differ (the pages after it follow), words the device reader was
 * unsure of, or a problem that needs a retake. A retake replaces the photo in its place.
 */
function CheckPage({ placed, reasons, position, total, bookId, version, onSave, onRetake, onRetry, onRemove, onNext, onClose }: {
  placed: Placed;
  reasons: string[];
  position: number;
  total: number;
  bookId: string;
  version: number;
  onSave: (patch: Partial<PageEntry>) => void;
  onRetake: () => void;
  onRetry: () => void;
  onRemove: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const entry = placed.entry;
  const [fixes, setFixes] = useState<Record<string, string>>(() => Object.fromEntries(entry.uncertain.map((w) => [w, w])));
  const [number, setNumber] = useState(String(placed.pageNumber));
  const [confirmRemove, setConfirmRemove] = useState(false);
  const typed = Number(number);
  const numberOk = !number.trim() || (Number.isInteger(typed) && typed >= 1 && typed <= 5000);
  const save = () => {
    const patch: Partial<PageEntry> = {};
    if (number.trim() && numberOk && typed !== placed.pageNumber) patch.manualPage = typed;
    if (entry.page) {
      const re = (w: string) => new RegExp(`(?<![\\p{L}])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}])`, "gu");
      const paragraphs = entry.page.paragraphs.map((t) => Object.entries(fixes).reduce((acc, [from, to]) => (to && to !== from ? acc.replace(re(from), to) : acc), t));
      patch.page = { ...entry.page, paragraphs };
      patch.uncertain = [];
      if (entry.status === "check") patch.status = "done";
    }
    onSave(patch);
  };
  const title = `Page ${placed.pageNumber}${placed.typed ? " (your number)" : ""}`;
  const seen = placed.seen;
  return (
    <section className="panel" aria-label="Check this page">
      <div className="row">
        <PageThumb bookId={bookId} seq={entry.seq} spinning={false} version={version} />
        <div className="grow">
          <b>{title}</b>
          <div className="small muted">
            {position >= 0 ? `${position + 1} of ${total} to check · ` : ""}
            {entry.status === "done" ? "Read" : entry.status === "failed" ? "Couldn't be read" : "Needs a retake"}
            {entry.by === "device" ? " on this device" : entry.by === "claude" ? " by Claude" : entry.by === "google" ? " by Google" : ""}
          </div>
        </div>
      </div>
      {reasons.map((r) => <p key={r} className="small" style={{ margin: 0, color: "var(--strike)" }}>{r}</p>)}
      <div className="pagenums num">
        <span><small>In order</small><b>{placed.pageNumber}</b></span>
        <span className={seen != null && seen !== placed.pageNumber ? "off" : ""}><small>Read on the photo</small><b>{entry.page ? (seen ?? "–") : "…"}</b></span>
      </div>
      <label className="field">
        <span>Page number</span>
        <input type="number" inputMode="numeric" min={1} max={5000} value={number} onChange={(e) => setNumber(e.target.value)} placeholder="As printed on the page" style={{ maxWidth: 160 }} />
        {!numberOk && <span className="error">Type the page number as a whole number.</span>}
        <span className="note">Change it and the pages taken after this one follow on from it.</span>
      </label>
      <div className="actions">
        {seen != null && seen !== placed.pageNumber && <button className="btn small" type="button" onClick={() => onSave({ manualPage: seen, keepOrder: false })}>Use {seen}</button>}
        {seen != null && seen !== placed.pageNumber && !placed.typed && !entry.keepOrder && (
          <button className="btn small" type="button" onClick={() => onSave({ keepOrder: true })}>Keep {placed.pageNumber}</button>
        )}
        {placed.typed && <button className="btn small ghost" type="button" onClick={() => onSave({ manualPage: null })}>Back to the order</button>}
      </div>
      {entry.uncertain.length > 0 && (
        <>
          <p>These words were hard to read. Correct any that are wrong:</p>
          <div className="uncertain">
            {entry.uncertain.slice(0, 40).map((w) => (
              <input key={w} lang="nl" value={fixes[w] ?? w} onChange={(e) => setFixes((f) => ({ ...f, [w]: e.target.value }))} aria-label={`Word read as ${w}`} style={{ width: `${Math.max(6, w.length + 3)}ch` }} />
            ))}
          </div>
        </>
      )}
      {entry.page && entry.page.paragraphs.length > 0 && (
        <details>
          <summary className="small">Show the text read from this photo</summary>
          {entry.page.paragraphs.map((t, i) => <p key={i} lang="nl" style={{ fontFamily: "var(--read)", color: "var(--ink)", marginTop: 8 }}>{t}</p>)}
        </details>
      )}
      <div className="actions">
        {(entry.page || number.trim()) && <button className="btn primary small" type="button" disabled={!numberOk} onClick={save}>{entry.status === "done" ? "Save" : "Use this photo anyway"}</button>}
        <button className="btn small" type="button" onClick={onRetake}>Retake photo</button>
        {entry.status === "failed" && <button className="btn small ghost" type="button" onClick={onRetry}>Read again</button>}
        {total > 1 && <button className="btn small ghost" type="button" onClick={onNext}>Next</button>}
        <button className="btn small ghost" type="button" onClick={onClose}>Close</button>
      </div>
      {confirmRemove ? (
        <button className="btn small danger" type="button" onClick={onRemove}>Remove this photo from the book</button>
      ) : (
        <button className="btn small ghost" type="button" style={{ justifySelf: "start", color: "var(--muted)" }} onClick={() => setConfirmRemove(true)}>
          Not a page of this book? Remove it…
        </button>
      )}
    </section>
  );
}
