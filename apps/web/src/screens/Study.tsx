import { useMemo, useState } from "react";
import * as E from "@boekenwurm/engine";
import { dueCards, getState, reviewCard, useStore } from "../lib/store.ts";
import { meaningOf } from "../lib/words.ts";
import { preview, span, type Rating } from "../lib/srs.ts";
import { close, open } from "../nav.ts";
import { Icon, plural } from "../ui.tsx";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function Study() {
  const cards = useStore((s) => s.cards);
  const wordbook = useStore((s) => s.wordbook);
  const meanings = useStore((s) => s.meanings);
  const due = dueCards();
  const all = Object.values(cards);
  const nextDue = all.filter((c) => c.due > Date.now()).sort((a, b) => a.due - b.due)[0];
  const stuck = E.notSticking(wordbook);
  const revealed = Object.values(wordbook).filter((w) => w.reveals > 0).sort((a, b) => b.reveals - a.reveals || a.lemma.localeCompare(b.lemma));

  const exportCsv = () => {
    const rows = [["word", "meaning", "sentence", "revealed", "met"]];
    for (const w of revealed) {
      const m = meaningOf(w.lemma, meanings);
      rows.push([w.lemma, m?.en ?? m?.nl ?? "", getState().examples[w.lemma] ?? "", String(w.reveals), String(w.encounters)]);
    }
    const csv = rows.map((r) => r.map((c) => (/[",\n\t]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = "boekenwurm-words.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  return (
    <main className="screen">
      <div className="topbar"><h1>Study</h1></div>
      <section className="panel">
        <h2>{due.length ? `${plural(due.length, "word")} due` : all.length ? "All caught up" : "No flashcards yet"}</h2>
        <p>
          {all.length
            ? due.length
              ? "Each card shows a word with the sentence you met it in. Say what it means, then check."
              : nextDue ? `The next card is due in ${span(nextDue.due - Date.now())}.` : ""
            : "Every word you tap while reading becomes a flashcard, scheduled the way modern Anki does it (FSRS)."}
        </p>
        {due.length > 0 && (
          <button className="btn primary block" type="button" onClick={() => open({ name: "study-session" })}>
            Start review
          </button>
        )}
        {all.length > 0 && <p className="small">{plural(all.length, "card")} in total.</p>}
      </section>

      <section className="panel">
        <h2>Not sticking yet</h2>
        <p>Words you've met at least 3 times and still revealed in half of them or more.</p>
        {stuck.length ? (
          <>
            <WordTable words={stuck} />
            <button className="btn" type="button" onClick={() => open({ name: "study-session", lemmas: stuck.map((w) => w.lemma) })}>
              Review these {plural(stuck.length, "word")}
            </button>
          </>
        ) : (
          <p className="empty">Nothing yet. Words appear here once they keep coming back.</p>
        )}
      </section>

      <section className="panel">
        <h2>Every word you've revealed</h2>
        {revealed.length ? <WordTable words={revealed} /> : <p className="empty">Read a page and tap a word to start your list.</p>}
        {revealed.length > 0 && (
          <div className="actions">
            <button className="btn small" type="button" onClick={exportCsv}>Export CSV</button>
            <span className="note">Opens in Anki, Quizlet, Mochi, RemNote and spreadsheets.</span>
          </div>
        )}
      </section>
    </main>
  );
}

function WordTable({ words }: { words: E.WordStats[] }) {
  return (
    <div className="tablewrap">
      <table>
        <thead><tr><th>Word</th><th>Revealed</th><th>Met</th><th>Reveal rate</th></tr></thead>
        <tbody>
          {words.slice(0, 200).map((w) => {
            const rate = E.revealRate(w);
            return (
              <tr key={w.lemma}>
                <td><b lang="nl">{w.lemma}</b></td>
                <td className="n">{w.reveals}</td>
                <td className="n">{w.encounters}</td>
                <td><div className="rate" title={`${Math.round(rate * 100)}% of encounters revealed`}><i style={{ width: `${Math.round(rate * 100)}%` }} /></div></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** A review: due cards first, or the words from a session summary / the "not sticking" list. */
export function StudySession({ lemmas }: { lemmas?: string[] }) {
  const cards = useStore((s) => s.cards);
  const meanings = useStore((s) => s.meanings);
  const examples = useStore((s) => s.examples);
  // The queue is fixed when the session opens; "again" puts a card at the back.
  const initial = useMemo(() => (lemmas ? lemmas.filter((l) => getState().cards[l]) : dueCards().slice(0, 50).map((c) => c.lemma)), [lemmas]);
  const [queue, setQueue] = useState(initial);
  const [done, setDone] = useState(0);
  const [flipped, setFlipped] = useState(false);

  const lemma = queue[0];
  const card = lemma ? cards[lemma] : null;
  const answer = (rating: Rating) => {
    void reviewCard(lemma, rating);
    setFlipped(false);
    if (rating === "again") setQueue((q) => [...q.slice(1), q[0]]);
    else {
      setQueue((q) => q.slice(1));
      setDone((n) => n + 1);
    }
  };

  return (
    <main className="screen full">
      <div className="topbar">
        <button className="back" type="button" onClick={close}><span style={{ width: 22, height: 22, display: "inline-block" }}><Icon.back /></span> Back</button>
        <span className="grow" />
        {lemma && <span className="num muted">{done + 1} of {done + queue.length}</span>}
      </div>
      {!card ? (
        <section className="panel">
          <h2 className="big">{done ? `Done: ${plural(done, "word")} reviewed.` : "Nothing to review right now."}</h2>
          <p>Cards come back when they're due. Words that keep needing a tap show up under Study → Not sticking yet.</p>
          <button className="btn primary" type="button" onClick={close}>Back</button>
        </section>
      ) : (
        <>
          <div className="flash">
            <div className="front" lang="nl">{lemma}</div>
            {examples[lemma] && (
              <div
                className="ctxline"
                lang="nl"
                // The sentence comes from the reader's own book; it is escaped before the word is highlighted.
                dangerouslySetInnerHTML={{ __html: highlight(examples[lemma], lemma) }}
              />
            )}
            {flipped && (
              <div className="answer">
                {(() => {
                  const m = meaningOf(lemma, meanings);
                  if (!m) return <span className="muted">No meaning saved for this word yet. With your Claude key, tapping it while reading saves its meaning in that sentence.</span>;
                  return (
                    <>
                      {m.article && <span className="muted">{m.article} </span>}
                      {m.en && <div>{m.en}</div>}
                      {m.nl && <div lang="nl" style={{ fontStyle: "italic", color: "var(--muted)" }}>{m.nl}</div>}
                    </>
                  );
                })()}
              </div>
            )}
          </div>
          {flipped ? (
            <div className="grades">
              {(() => {
                const p = preview(card, Date.now());
                return (["again", "hard", "good", "easy"] as Rating[]).map((r) => (
                  <button key={r} className={`btn ${r === "good" ? "primary" : ""}`} type="button" onClick={() => answer(r)}>
                    {r[0].toUpperCase() + r.slice(1)}
                    <small>{p[r]}</small>
                  </button>
                ));
              })()}
            </div>
          ) : (
            <button className="btn primary block" type="button" onClick={() => setFlipped(true)}>Show meaning</button>
          )}
        </>
      )}
    </main>
  );
}

function highlight(sentence: string, lemma: string): string {
  const esc = sentence.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  // Highlight forms that share the first letters with the base form (liep/lopen won't, loopt/lopen will).
  const stem = escapeRe(lemma.slice(0, Math.max(3, Math.min(lemma.length - 1, 5))));
  return esc.replace(new RegExp(`(^|[^\\p{L}])(${stem}\\p{L}*)`, "giu"), "$1<b>$2</b>");
}
