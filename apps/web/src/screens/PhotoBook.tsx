/**
 * Photographing a printed book (ARCHITECTURE.md, "Photographing a book you own"):
 *   1. cover (Claude reads title, author and ISBN with a key; typed in free mode),
 *   2. details: page count, the book's level (both required), ISBN,
 *   3. pages: the camera stays open; each photo is read in the background, one Claude request per page with a key
 *      or on the device for free, where words it was unsure of are shown for a quick check.
 * Pages are stitched into paragraphs across page breaks, and progress counts printed pages.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { CefrLevel } from "@boekenwurm/engine";
import { normalizeIsbn } from "@boekenwurm/ai";
import { stitch, type PageText } from "@boekenwurm/books";
import { bookById, saveBook, saveCover, saveText, useStore } from "../lib/store.ts";
import { newBook, readCover, readPhotoPage, toParagraphs } from "../lib/books.ts";
import { downscale, COVER_SIDE, OCR_SIDE } from "../lib/images.ts";
import { checkBook } from "../lib/text.ts";
import { db } from "../lib/db.ts";
import { stopReader } from "../lib/ocr.ts";
import { AiError } from "../lib/claude.ts";
import { close, open } from "../nav.ts";
import { Icon, LevelPicker, plural, toast } from "../ui.tsx";

interface PageEntry {
  seq: number;
  status: "queued" | "reading" | "done" | "check" | "failed";
  page: PageText | null;
  problems: string[];
  uncertain: string[];
  by: "claude" | "device" | null;
}

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
  const [details, setDetails] = useState({ title: "", author: "", isbn: "", pages: "", level: null as CefrLevel | null });
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
              pageCount: Number(details.pages), level: details.level, levelSource: "reader", status: "processing", hasCover: true,
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

function DetailsStep({ cover, details, onChange, onRetake, onSave }: {
  cover: Blob;
  details: { title: string; author: string; isbn: string; pages: string; level: CefrLevel | null };
  onChange: (d: typeof details) => void;
  onRetake: () => void;
  onSave: () => Promise<void>;
}) {
  const [url] = useState(() => URL.createObjectURL(cover));
  const [saving, setSaving] = useState(false);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const pages = Number(details.pages);
  const isbnOk = !details.isbn.trim() || normalizeIsbn(details.isbn) != null;
  const ok = details.title.trim() && Number.isInteger(pages) && pages >= 1 && pages <= 5000 && details.level && isbnOk;
  const set = (patch: Partial<typeof details>) => onChange({ ...details, ...patch });
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
        <label className="field">
          <span>Number of pages</span>
          <input type="number" inputMode="numeric" min={1} max={5000} value={details.pages} onChange={(e) => set({ pages: e.target.value })} placeholder="The last printed page number" />
          <span className="note">For your progress: "page 34 of 212".</span>
        </label>
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
  const [pages, setPages] = useState<PageEntry[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [checking, setChecking] = useState<number | null>(null);
  const queue = useRef<Array<{ seq: number; blob: Blob }>>([]);
  const working = useRef(false);
  const pagesRef = useRef(pages);
  pagesRef.current = pages;

  // Pages read earlier (when adding more pages to a book).
  useEffect(() => {
    void db.get<PageEntry[]>("kv", `pages:${bookId}`).then((saved) => saved && setPages(saved));
  }, [bookId]);

  const persist = useCallback(
    async (list: PageEntry[]) => {
      await db.put("kv", list, `pages:${bookId}`);
      const accepted = list.filter((p) => p.status === "done" && p.page).map((p) => p.page!);
      const b = bookById(bookId);
      if (!b) return;
      const stitched = stitch(accepted);
      // The same language and spelling check as files, on what was read.
      const verdict = checkBook(stitched.paragraphs.map((p) => p.text));
      const keep = new Set(verdict.paragraphs);
      const paragraphs = toParagraphs(stitched.paragraphs.filter((p) => keep.has(p.text.replace(/\s+/g, " ").trim()) || p.text.split(/\s+/).length < 8));
      await saveText({ bookId, paragraphs });
      await saveBook({ ...b, paragraphCount: paragraphs.length, status: paragraphs.length ? "ready" : "processing", textSynced: false, nextSeq: Math.max(b.nextSeq, ...list.map((p) => p.seq + 1)) });
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
        const r = await readPhotoPage(job.blob, job.seq, useClaude, (p, s) => setProgress(s === "recognizing text" ? `Reading… ${Math.round(p * 100)}%` : "Getting the Dutch reading model ready…"));
        // Unsure words don't hold a page back: it is used at once and flagged for an optional quick check.
        const status: PageEntry["status"] = r.problems.length ? "check" : "done";
        await persist(update(job.seq, { status, page: r.page, problems: r.problems, uncertain: r.uncertain, by: r.by }));
      } catch (e) {
        update(job.seq, { status: "failed", problems: [e instanceof AiError ? e.message : (e as Error).message || "Couldn't read this page."] });
      }
      setProgress(null);
    }
    working.current = false;
  }, [persist, useClaude]);

  const add = async (photo: Blob) => {
    const seq = Math.max(bookById(bookId)?.nextSeq ?? 0, ...pagesRef.current.map((p) => p.seq + 1));
    const small = await downscale(photo, OCR_SIDE, 0.9).catch(() => photo);
    const entry: PageEntry = { seq, status: "queued", page: null, problems: [], uncertain: [], by: null };
    const next = [...pagesRef.current, entry];
    pagesRef.current = next;
    setPages(next);
    await db.put("blobs", small, `page:${bookId}:${seq}`);
    await saveBook({ ...bookById(bookId)!, nextSeq: seq + 1 }, { sync: false });
    queue.current.push({ seq, blob: small });
    void work();
  };

  const retry = async (seq: number) => {
    const blob = await db.get<Blob>("blobs", `page:${bookId}:${seq}`);
    if (!blob) return toast("That photo isn't on this device any more. Take it again.");
    update(seq, { status: "queued", problems: [] });
    queue.current.push({ seq, blob });
    void work();
  };

  const remove = async (seq: number) => {
    const next = pagesRef.current.filter((p) => p.seq !== seq);
    pagesRef.current = next;
    setPages(next);
    setChecking(null);
    await db.del("blobs", `page:${bookId}:${seq}`);
    await persist(next);
  };

  const done = pages.filter((p) => p.status === "done").length;
  const busy = pages.some((p) => p.status === "queued" || p.status === "reading");
  const needCheck = pages.filter((p) => p.status === "check" || p.status === "failed" || p.uncertain.length);
  const printed = pages.filter((p) => p.page?.pageNumber).map((p) => p.page!.pageNumber!);

  return (
    <>
      <h1 className="big">The pages</h1>
      <p className="muted" style={{ margin: 0 }}>
        Photograph pages in order, one after another. {useClaude ? "Claude reads each page (one request per page)." : "Each page is read on this device, for free."}
        {book?.pageCount ? ` ${plural(done, "page")} of ${book.pageCount} read so far.` : ""}
      </p>
      <Camera onPhoto={(b) => void add(b)} hint="One page per photo, flat and in good light, filling the frame." />
      {progress && <p className="small muted" aria-live="polite" style={{ margin: 0 }}>{progress}</p>}

      {pages.length > 0 && (
        <div className="thumbs" aria-label="Photographed pages">
          {pages.map((p) => (
            <button key={p.seq} type="button" className={`thumb ${p.status}`} onClick={() => p.status !== "queued" && p.status !== "reading" && setChecking(p.seq)} style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }}>
              <PageThumb bookId={bookId} seq={p.seq} spinning={p.status === "queued" || p.status === "reading"} />
              <span>{p.page?.pageNumber ? `p. ${p.page.pageNumber}` : `#${p.seq + 1}`}{p.status === "check" || (p.status === "done" && p.uncertain.length) ? " ⚑" : p.status === "failed" ? " ✗" : ""}</span>
            </button>
          ))}
        </div>
      )}
      {needCheck.length > 0 && <p className="small" style={{ margin: 0 }}>⚑ Tap a flagged page to check it: a few words were hard to read, or the photo needs retaking.</p>}
      {printed.length > 1 && <Gaps printed={printed} />}

      {checking != null && (
        <CheckPage
          entry={pages.find((p) => p.seq === checking)!}
          bookId={bookId}
          onAccept={async (page) => {
            setChecking(null);
            await persist(update(page.seq, { status: "done", page, problems: [], uncertain: [] }));
          }}
          onRetry={() => (setChecking(null), void retry(checking))}
          onRemove={() => void remove(checking)}
          onClose={() => setChecking(null)}
        />
      )}

      <div className="actions">
        <button className="btn primary" type="button" disabled={!done} onClick={() => open({ name: "reader", bookId })}>
          {busy ? `Start reading (${plural(pages.filter((p) => p.status === "queued" || p.status === "reading").length, "page")} still reading)` : "Start reading"}
        </button>
        <button className="btn ghost" type="button" onClick={close}>Add more later</button>
      </div>
    </>
  );
}

function Gaps({ printed }: { printed: number[] }) {
  const s = [...new Set(printed)].sort((a, b) => a - b);
  const gaps: string[] = [];
  for (let i = 1; i < s.length; i++) if (s[i] - s[i - 1] > 1) gaps.push(s[i] - s[i - 1] === 2 ? `${s[i - 1] + 1}` : `${s[i - 1] + 1}–${s[i] - 1}`);
  return gaps.length ? <p className="small muted" style={{ margin: 0 }}>Missing so far: page {gaps.join(", ")}. Reading skips over gaps.</p> : null;
}

function PageThumb({ bookId, seq, spinning }: { bookId: string; seq: number; spinning: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null;
    void db.get<Blob>("blobs", `page:${bookId}:${seq}`).then((b) => b && setUrl((u = URL.createObjectURL(b))));
    return () => void (u && URL.revokeObjectURL(u));
  }, [bookId, seq]);
  return (
    <span className="img">
      {url && <img src={url} alt="" />}
      {spinning && <span className="spinner" />}
    </span>
  );
}

/** A page that needs a look: problems to fix by retaking, or words the device reader was unsure of. */
function CheckPage({ entry, bookId, onAccept, onRetry, onRemove, onClose }: {
  entry: PageEntry;
  bookId: string;
  onAccept: (p: PageText & { seq: number }) => void;
  onRetry: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [fixes, setFixes] = useState<Record<string, string>>(() => Object.fromEntries(entry.uncertain.map((w) => [w, w])));
  const accept = () => {
    if (!entry.page) return;
    const re = (w: string) => new RegExp(`(?<![\\p{L}])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}])`, "gu");
    const paragraphs = entry.page.paragraphs.map((t) => Object.entries(fixes).reduce((acc, [from, to]) => (to && to !== from ? acc.replace(re(from), to) : acc), t));
    onAccept({ ...entry.page, paragraphs, seq: entry.seq });
  };
  return (
    <section className="panel" aria-label="Check this page">
      <div className="row">
        <PageThumb bookId={bookId} seq={entry.seq} spinning={false} />
        <div className="grow">
          <b>{entry.page?.pageNumber ? `Page ${entry.page.pageNumber}` : `Photo ${entry.seq + 1}`}</b>
          <div className="small muted">{entry.status === "done" ? "Read" : entry.status === "failed" ? "Couldn't be read" : "Needs a quick check"}{entry.by === "device" ? " · read on this device" : entry.by === "claude" ? " · read by Claude" : ""}</div>
        </div>
      </div>
      {entry.problems.map((p) => <p key={p} className="error" style={{ margin: 0 }}>{p}</p>)}
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
          <summary className="small">Show the text read from this page</summary>
          {entry.page.paragraphs.map((t, i) => <p key={i} lang="nl" style={{ fontFamily: "var(--read)", color: "var(--ink)", marginTop: 8 }}>{t}</p>)}
        </details>
      )}
      <div className="actions">
        {entry.page && entry.page.paragraphs.length > 0 && (entry.status !== "done" || entry.uncertain.length > 0) && (
          <button className="btn primary small" type="button" onClick={accept}>{entry.status === "done" ? "Save corrections" : "Use this page anyway"}</button>
        )}
        <button className="btn small" type="button" onClick={onRetry}>Read again</button>
        <button className="btn small ghost" type="button" onClick={onRemove}>Remove (retake it)</button>
        <button className="btn small ghost" type="button" onClick={onClose}>Close</button>
      </div>
    </section>
  );
}
