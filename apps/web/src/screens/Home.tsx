import { useState } from "react";
import { bookProgress } from "@boekenwurm/books";
import { deleteBook, dueToday, reviewedTodayCount, saveBook, useStore } from "../lib/store.ts";
import { open, setTab } from "../nav.ts";
import type { Book } from "../lib/types.ts";
import { bookShare, Cover, LevelPicker, Sheet, toast } from "../ui.tsx";
import * as E from "@boekenwurm/engine";
import { RankBar, RankShield } from "../badges.tsx";
import { diaryRecord, todayLocal } from "../lib/play.ts";
import { t, useT } from "../lib/i18n.ts";

const greeting = () => {
  const h = new Date().getHours();
  return h < 6 ? "Goedenacht" : h < 12 ? "Goedemorgen" : h < 18 ? "Goedemiddag" : "Goedenavond";
};

function where(b: Book): string {
  if (b.source === "photo" && b.pageCount) {
    const p = bookProgress(b.pageCount, b.pagesRead, b.firstPage ?? 1);
    return p.furthestPage ? t("home.pageOf", { page: p.furthestPage, total: b.pageCount }) : t("home.pages", { first: b.firstPage ?? 1, last: b.pageCount });
  }
  if (!b.paragraphCount) return b.textRemote ? t("home.otherDevice") : "";
  return t("home.paragraphOf", { n: Math.min(b.position.ord + 1, b.paragraphCount), total: b.paragraphCount });
}

export function Home() {
  const tr = useT();
  const profile = useStore((s) => s.profile);
  const books = useStore((s) => s.books);
  const cards = useStore((s) => s.cards);
  const [details, setDetails] = useState<Book | null>(null);
  const noList = useStore((s) => !s.wordLists.length && !s.profile.settings.commonWords);
  // The weekly diary prompt: until an entry counts this week (packages/engine/src/diary.ts).
  const diaryDue = E.weeklyDue(diaryRecord(), todayLocal());
  const due = dueToday();
  // The Daily Challenge's progress: different words reviewed today (lib/store.ts), towards 90.
  const reviewed = Math.min(reviewedTodayCount(), E.REVIEW_DAY.maxDue);
  const totalCards = Object.keys(cards).length;
  const shelf = books.filter((b) => b.status !== "archived");
  const last = [...shelf].filter((b) => b.position.at).sort((a, b) => (b.position.at ?? 0) - (a.position.at ?? 0))[0] ?? shelf[0];

  return (
    <main className="screen">
      <header className="hello">
        <RankShield rank={E.rankOf(profile.progress.play).rank} size={52} />
        <div className="who">
          <h1>{greeting()}{profile.displayName ? `, ${profile.displayName}` : ""}</h1>
          <RankBar />
        </div>
      </header>

      {!shelf.length && (
        <section className="panel firstbook">
          <h2>{tr("home.firstBook")}</h2>
          <p>{tr("home.firstBookLead")}</p>
          <ul className="small muted" style={{ margin: 0, paddingInlineStart: "1.2em", display: "grid", gap: 4 }}>
            <li>{tr.rich("home.epub")}</li>
            <li>{tr.rich("home.pdf")}</li>
            <li>{tr.rich("home.printed")}</li>
          </ul>
          <button className="btn primary" type="button" onClick={() => open({ name: "add" })}>{tr("home.addBook")}</button>
        </section>
      )}

      {last && (
        <button className="continue" type="button" onClick={() => open({ name: "reader", bookId: last.id })}>
          <Cover book={last} showRing={false} />
          <span className="info">
            <span className="label">{last.position.at ? tr("home.continue") : tr("home.startHere")}</span>
            <b lang="nl">{last.title}</b>
            <span className="small muted">{where(last)}</span>
            <span className="bar" aria-label={tr("home.read", { n: Math.round(bookShare(last) * 100) })}>
              <i style={{ width: `${Math.round(bookShare(last) * 100)}%` }} />
            </span>
          </span>
        </button>
      )}

      {(totalCards > 0 || due > 0 || reviewed > 0) &&
        (reviewed >= E.REVIEW_DAY.maxDue ? (
          <div className="studycard challenge done" role="status">
            <b>{tr("challenge.done")}</b>
          </div>
        ) : (
          <button className="studycard challenge" type="button" onClick={() => open({ name: "study-session" })}>
            <b>{tr("challenge.title", { n: E.REVIEW_DAY.maxDue })}</b>
            <span className="xpbar" role="progressbar" aria-label={tr("challenge.aria")} aria-valuemin={0} aria-valuemax={E.REVIEW_DAY.maxDue} aria-valuenow={reviewed}>
              <i style={{ width: `${Math.round((reviewed / E.REVIEW_DAY.maxDue) * 100)}%` }} />
            </span>
            <span className="small muted num">{tr("challenge.progress", { n: reviewed, max: E.REVIEW_DAY.maxDue })}</span>
          </button>
        ))}

      {diaryDue && (
        <section className="panel weekly">
          <h2>{tr("home.diaryTitle")}</h2>
          <p>{tr("home.diaryText", { n: E.DIARY.minWordsPrompt })}</p>
          <button className="btn primary" type="button" onClick={() => setTab("study", "diary")}>{tr("home.diaryGo")}</button>
        </section>
      )}

      {noList && (
        <section className="panel">
          <h2>{tr("home.listTitle")}</h2>
          <p>{tr("home.listText")}</p>
          <button className="btn" type="button" onClick={() => setTab("words")}>{tr("home.listGo")}</button>
        </section>
      )}

      {shelf.length > 0 && <section className="stack">
        <div className="shelf-head">
          <h2>{tr("home.myBooks")}</h2>
          <span className="small muted">{tr("common.books", { n: shelf.length })}</span>
        </div>
        <div className="shelf">
          <button className="addtile" type="button" onClick={() => open({ name: "add" })} aria-label={tr("home.addBook")}>
            <span className="plus">+</span>
            {tr("home.addBook")}
          </button>
          {shelf.map((b) => (
            <BookTile key={b.id} book={b} onLong={() => setDetails(b)} />
          ))}
        </div>
        <p className="note">{tr("home.booksHint")}</p>
      </section>}

      {details && <BookDetails book={details} onClose={() => setDetails(null)} />}
    </main>
  );
}

function BookTile({ book, onLong }: { book: Book; onLong: () => void }) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let long = false;
  const down = () => {
    long = false;
    timer = setTimeout(() => {
      long = true;
      onLong();
    }, 550);
  };
  const up = () => clearTimeout(timer);
  return (
    <div className="booktile">
    <button
      className="bookbtn"
      type="button"
      onPointerDown={down}
      onPointerUp={up}
      onPointerLeave={up}
      onContextMenu={(e) => {
        e.preventDefault();
        onLong();
      }}
      onClick={() => {
        if (long) return;
        if (book.status === "processing" && book.source === "photo") open({ name: "photo", bookId: book.id });
        else open({ name: "reader", bookId: book.id });
      }}
    >
      <Cover book={book} />
      <span className="t" lang="nl">{book.title}</span>
    </button>
    <button className="bookmore" type="button" onClick={onLong} aria-label={t("home.bookOptions", { title: book.title })}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
    </button>
    </div>
  );
}

function BookDetails({ book, onClose }: { book: Book; onClose: () => void }) {
  const tr = useT();
  const [confirm, setConfirm] = useState(false);
  const pct = Math.round(bookShare(book) * 100);
  return (
    <Sheet onClose={onClose} label={book.title}>
      <div style={{ display: "grid", gridTemplateColumns: "96px 1fr", gap: 14, alignItems: "start" }}>
        <Cover book={book} showRing={false} />
        <div className="stack" style={{ gap: 4 }}>
          <b style={{ font: "700 1.15rem/1.2 var(--display)" }} lang="nl">{book.title}</b>
          {book.author && <span className="muted">{book.author}</span>}
          <span className="small muted">{where(book)} · {tr("book.percentRead", { n: pct })}</span>
          {book.isbn && <span className="small muted num">ISBN {book.isbn}</span>}
          {book.scan?.level && <span className="small">{tr("book.graded", { level: book.scan.level })}</span>}
        </div>
      </div>
      <div className="field">
        <span>{tr("book.level")}</span>
        <LevelPicker
          label={tr("book.level")}
          value={book.level}
          onChange={(level) => void saveBook({ ...book, level, levelSource: "reader" }).then(() => toast(tr("book.levelSet", { level })))}
        />
      </div>
      {book.source === "photo" && <PageRange book={book} />}
      {book.source === "photo" && (
        <button className="btn" type="button" onClick={() => (onClose(), open({ name: "photo", bookId: book.id }))}>
          {tr("book.morePages")}
        </button>
      )}
      <button
        className="btn small ghost"
        type="button"
        onClick={() => void saveBook({ ...book, position: { ...book.position, ord: 0 }, pagesRead: [] }).then(() => toast(tr("book.restarted")))}
      >
        {tr("book.restart")}
      </button>
      {confirm ? (
        <div className="verdict bad">
          <b>{tr("book.deleteAsk", { title: book.title })}</b>
          <span className="small">{tr(book.source === "photo" ? "book.deletePhotoText" : "book.deleteText")}</span>
          <div className="actions">
            <button className="btn danger" type="button" onClick={() => void deleteBook(book.id).then(() => (toast(tr("book.deleted", { title: book.title })), onClose()))}>
              {tr("book.delete")}
            </button>
            <button className="btn ghost" type="button" onClick={() => setConfirm(false)}>{tr("book.keep")}</button>
          </div>
        </div>
      ) : (
        <button className="btn small ghost" type="button" onClick={() => setConfirm(true)} style={{ color: "var(--strike)" }}>
          {tr("book.deleteMenu")}
        </button>
      )}
      <div className="actions">
        <button className="btn primary" type="button" onClick={() => (onClose(), open({ name: "reader", bookId: book.id }))}>
          {tr("book.read")}
        </button>
        <button className="btn ghost" type="button" onClick={onClose}>{tr("common.close")}</button>
      </div>
    </Sheet>
  );
}

/** First page to read and last page of a photographed book; progress counts the pages between. */
function PageRange({ book }: { book: Book }) {
  const tr = useT();
  const [first, setFirst] = useState(String(book.firstPage ?? 1));
  const [last, setLast] = useState(String(book.pageCount ?? ""));
  const f = Number(first);
  const l = Number(last);
  const ok = Number.isInteger(f) && Number.isInteger(l) && f >= 1 && l >= f && l <= 5000;
  const changed = f !== (book.firstPage ?? 1) || l !== book.pageCount;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row" style={{ alignItems: "end" }}>
        <label className="field grow"><span>{tr("book.firstPage")}</span><input type="number" inputMode="numeric" min={1} value={first} onChange={(e) => setFirst(e.target.value)} /></label>
        <label className="field grow"><span>{tr("book.lastPage")}</span><input type="number" inputMode="numeric" min={1} value={last} onChange={(e) => setLast(e.target.value)} /></label>
        {changed && (
          <button className="btn small" type="button" disabled={!ok} onClick={() => void saveBook({ ...book, firstPage: f, pageCount: l }).then(() => toast(tr("book.pagesSaved", { first: f, last: l, n: l - f + 1 })))}>
            {tr("common.save")}
          </button>
        )}
      </div>
      {!ok && <span className="error">{tr("book.pageOrder")}</span>}
    </div>
  );
}
