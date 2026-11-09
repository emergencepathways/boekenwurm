import { useState } from "react";
import { currentTitle, nextLevel } from "@boekenwurm/engine";
import { bookProgress } from "@boekenwurm/books";
import { deleteBook, dueCards, saveBook, SAMPLE_ID, useStore } from "../lib/store.ts";
import { open } from "../nav.ts";
import type { Book } from "../lib/types.ts";
import { bookShare, Cover, LevelPicker, plural, Sheet, TokenPips, toast } from "../ui.tsx";

const greeting = () => {
  const h = new Date().getHours();
  return h < 6 ? "Goedenacht" : h < 12 ? "Goedemorgen" : h < 18 ? "Goedemiddag" : "Goedenavond";
};

function where(b: Book): string {
  if (b.source === "photo" && b.pageCount) {
    const p = bookProgress(b.pageCount, b.pagesRead);
    return p.furthestPage ? `Page ${p.furthestPage} of ${p.pageCount}` : `${p.pageCount} pages`;
  }
  if (!b.paragraphCount) return b.textRemote ? "On your other device: opens here when you tap it" : "";
  return `Paragraph ${Math.min(b.position.ord + 1, b.paragraphCount)} of ${b.paragraphCount}`;
}

export function Home() {
  const profile = useStore((s) => s.profile);
  const books = useStore((s) => s.books);
  const cards = useStore((s) => s.cards);
  const [details, setDetails] = useState<Book | null>(null);
  const title = currentTitle(profile.progress.badges);
  const due = dueCards().length;
  const totalCards = Object.keys(cards).length;
  const shelf = books.filter((b) => b.status !== "archived");
  const last = [...shelf].filter((b) => b.position.at).sort((a, b) => (b.position.at ?? 0) - (a.position.at ?? 0))[0] ?? shelf.find((b) => b.id === SAMPLE_ID);
  const next = nextLevel(profile.progress.level);

  return (
    <main className="screen">
      <header className="hello">
        <div className="medal" aria-hidden="true">{profile.progress.level}</div>
        <div className="who">
          <h1>{greeting()}{profile.displayName ? `, ${profile.displayName}` : ""}</h1>
          <div className="title">
            {title && <><b lang="nl">{title.title}</b> · </>}
            <span>{next ? <>toward {next} <TokenPips progress={profile.progress} /></> : "top level"}</span>
          </div>
        </div>
      </header>

      {last && (
        <button className="continue" type="button" onClick={() => open({ name: "reader", bookId: last.id })}>
          <Cover book={last} showRing={false} />
          <span className="info">
            <span className="label">{last.position.at ? "Continue reading" : "Start here"}</span>
            <b lang="nl">{last.title}</b>
            <span className="small muted">{where(last)}</span>
            <span className="bar" aria-label={`${Math.round(bookShare(last) * 100)}% read`}>
              <i style={{ width: `${Math.round(bookShare(last) * 100)}%` }} />
            </span>
          </span>
        </button>
      )}

      <button className="studycard" type="button" onClick={() => open({ name: "study-session" })} disabled={!totalCards}>
        <span className="big">{due}</span>
        <span className="grow">
          <b>Study words</b>
          <span className="small muted">
            {totalCards ? (due ? `${plural(due, "word")} due for review` : "Nothing due right now. Well done.") : "Words you tap while reading become flashcards here."}
          </span>
        </span>
      </button>

      <section className="stack">
        <div className="shelf-head">
          <h2>My books</h2>
          <span className="small muted">{plural(shelf.length, "book")}</span>
        </div>
        <div className="shelf">
          <button className="addtile" type="button" onClick={() => open({ name: "add" })} aria-label="Add a book">
            <span className="plus">+</span>
            Add a book
          </button>
          {shelf.map((b) => (
            <BookTile key={b.id} book={b} onLong={() => setDetails(b)} />
          ))}
        </div>
        <p className="note">Tap a book to read. Press and hold for its details.</p>
      </section>

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
  );
}

function BookDetails({ book, onClose }: { book: Book; onClose: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const pct = Math.round(bookShare(book) * 100);
  return (
    <Sheet onClose={onClose} label={book.title}>
      <div style={{ display: "grid", gridTemplateColumns: "96px 1fr", gap: 14, alignItems: "start" }}>
        <Cover book={book} showRing={false} />
        <div className="stack" style={{ gap: 4 }}>
          <b style={{ font: "700 1.15rem/1.2 var(--display)" }} lang="nl">{book.title}</b>
          {book.author && <span className="muted">{book.author}</span>}
          <span className="small muted">{where(book)} · {pct}% read</span>
          {book.isbn && <span className="small muted num">ISBN {book.isbn}</span>}
          {book.scan?.level && <span className="small">Graded about {book.scan.level}</span>}
        </div>
      </div>
      {book.id !== SAMPLE_ID && (
        <>
          <div className="field">
            <span>Book level</span>
            <LevelPicker
              label="Book level"
              value={book.level}
              onChange={(level) => void saveBook({ ...book, level, levelSource: "reader" }).then(() => toast(`Level set to ${level}.`))}
            />
          </div>
          {book.source === "photo" && (
            <button className="btn" type="button" onClick={() => (onClose(), open({ name: "photo", bookId: book.id }))}>
              Add pages
            </button>
          )}
          <button
            className="btn small ghost"
            type="button"
            onClick={() => void saveBook({ ...book, position: { ...book.position, ord: 0 }, pagesRead: [] }).then(() => toast("Back to the start."))}
          >
            Start again from the beginning
          </button>
          {confirm ? (
            <button className="btn danger" type="button" onClick={() => void deleteBook(book.id).then(() => (toast("Book removed."), onClose()))}>
              Remove for good, on every device
            </button>
          ) : (
            <button className="btn small ghost" type="button" onClick={() => setConfirm(true)} style={{ color: "var(--strike)" }}>
              Remove this book…
            </button>
          )}
        </>
      )}
      <div className="actions">
        <button className="btn primary" type="button" onClick={() => (onClose(), open({ name: "reader", bookId: book.id }))}>
          Read
        </button>
        <button className="btn ghost" type="button" onClick={onClose}>Close</button>
      </div>
    </Sheet>
  );
}
