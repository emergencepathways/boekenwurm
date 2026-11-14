import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as E from "@boekenwurm/engine";
import { dueCards, getState, reviewCard, unskipCard, useStore } from "../lib/store.ts";
import { meaningOf } from "../lib/words.ts";
import { studyFinished } from "../lib/play.ts";
import { inWords } from "../lib/cards.ts";
import { close, open } from "../nav.ts";
import { Icon, plural } from "../ui.tsx";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function Study() {
  const cards = useStore((s) => s.cards);
  const wordbook = useStore((s) => s.wordbook);
  const meanings = useStore((s) => s.meanings);
  const setSize = useStore((s) => E.clampSetSize(s.profile.settings.reviewSetSize));
  const due = dueCards();
  const all = Object.values(cards).filter((c) => c.pool !== "skipped");
  const skipped = Object.values(cards).filter((c) => c.pool === "skipped").sort((a, b) => a.lemma.localeCompare(b.lemma));
  const pool = { hard: due.filter((c) => c.pool === "hard").length, medium: due.filter((c) => c.pool === "medium").length, easy: due.filter((c) => c.pool === "easy").length };
  const nextCheck = all.filter((c) => c.pool === "easy" && c.due > Date.now()).sort((a, b) => a.due - b.due)[0];
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
        <h2>{due.length ? `${plural(due.length, "word")} to review` : all.length ? "All caught up" : "No flashcards yet"}</h2>
        <p>
          {all.length
            ? due.length
              ? `${[pool.hard && `${pool.hard} hard`, pool.medium && `${pool.medium} medium`, pool.easy && `${pool.easy} to check`].filter(Boolean).join(", ")}. A review takes ${Math.min(setSize, due.length)} of them, hard first, and repeats each until you rate it Easy.`
              : nextCheck ? `Your next check-back is ${inWords(nextCheck.due - Date.now())}.` : ""
            : "Every word you tap while reading becomes a flashcard. Rate it Hard, Medium or Easy; Hard and Medium words wait here for review."}
        </p>
        {due.length > 0 && (
          <button className="btn primary block" type="button" onClick={() => open({ name: "study-session" })}>
            Review {plural(Math.min(setSize, due.length), "word")}
          </button>
        )}
        {all.length > 0 && <p className="small">{plural(all.length, "card")} in total · sets of {setSize} (change it under Me → Reading).</p>}
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

      {skipped.length > 0 && (
        <section className="panel">
          <h2>Skipped words</h2>
          <p>Words you skipped as not worth learning. They never come up in reviews; bring one back if you change your mind.</p>
          <div className="chips">
            {skipped.map((c) => (
              <button key={c.lemma} className="btn small ghost" type="button" lang="nl" onClick={() => void unskipCard(c.lemma)} aria-label={`Bring back ${c.lemma}`}>
                {c.lemma} ↺
              </button>
            ))}
          </div>
        </section>
      )}

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

const ANSWERS: Array<{ a: E.Answer; label: string; cls: string }> = [
  { a: "hard", label: "Hard", cls: "g-hard" },
  { a: "medium", label: "Medium", cls: "g-medium" },
  { a: "easy", label: "Easy", cls: "g-easy" },
];

/**
 * A flashcard session (packages/engine/src/review.ts):
 * - review (from Study or Home): a set from the pool, Hard first; Hard and Medium cards come round again until every
 *   card is rated Easy, and finishing the set earns the day's review reward;
 * - recap (a session summary's words, or "not sticking"): each word rated once, no repeats.
 * Skip drops a word that isn't worth learning; it can be brought back from Study.
 */
export function StudySession({ lemmas }: { lemmas?: string[] }) {
  const cards = useStore((s) => s.cards);
  const meanings = useStore((s) => s.meanings);
  const examples = useStore((s) => s.examples);
  const setSize = useStore((s) => E.clampSetSize(s.profile.settings.reviewSetSize));
  const recap = Boolean(lemmas);
  // The set is fixed when the session opens.
  const initial = useMemo(
    () => (lemmas ? lemmas.filter((l) => getState().cards[l]) : E.reviewSet(Object.values(getState().cards), Date.now(), setSize).map((c) => c.lemma)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [queue, setQueue] = useState(initial);
  const [settled, setSettled] = useState(0); // review: rated Easy or skipped; recap: rated
  const [flipped, setFlipped] = useState(false);

  // XP when the session ends (set finished, or the reader leaves): see lib/play.ts.
  const settledRef = useRef(0);
  settledRef.current = settled;
  const doneRef = useRef(false);
  doneRef.current = initial.length > 0 && queue.length === 0;
  const awarded = useRef(false);
  const award = useCallback(() => {
    if (awarded.current || !settledRef.current) return;
    awarded.current = true;
    void studyFinished({ cards: settledRef.current, dueAtStart: initial.length, completedSet: !recap && doneRef.current });
  }, [initial.length, recap]);
  useEffect(() => () => award(), [award]);
  useEffect(() => {
    if (!queue.length) award();
  }, [queue.length, award]);

  const lemma = queue[0];
  const card = lemma ? cards[lemma] : null;
  const answer = (a: E.Answer) => {
    void reviewCard(lemma, a);
    setFlipped(false);
    if (recap) {
      setQueue((q) => q.slice(1));
      setSettled((n) => n + 1);
    } else {
      setQueue((q) => E.requeue(q, a));
      if (a === "easy" || a === "skip") setSettled((n) => n + 1);
    }
  };

  return (
    <main className="screen full">
      <div className="topbar">
        <button className="back" type="button" onClick={close}><span style={{ width: 22, height: 22, display: "inline-block" }}><Icon.back /></span> Back</button>
        <span className="grow" />
        {lemma && <span className="num muted">{recap ? `${settled + 1} of ${initial.length}` : `${settled} of ${initial.length} learned`}</span>}
      </div>
      {!recap && initial.length > 0 && (
        <div className="xpbar" role="progressbar" aria-label="Cards rated Easy" aria-valuemin={0} aria-valuemax={initial.length} aria-valuenow={settled}>
          <i style={{ width: `${Math.round((settled / initial.length) * 100)}%` }} />
        </div>
      )}
      {!card ? (
        <section className="panel">
          <h2 className="big">
            {!initial.length ? "Nothing to review right now." : recap ? `Done: ${plural(settled, "word")} rated.` : `Set done: all ${plural(initial.length, "word")} rated Easy.`}
          </h2>
          <p>
            {recap
              ? "Hard and Medium words wait in your review pool, Hard first. Easy ones come back for a quick check in 3 days."
              : "Easy words come back for a quick check after 3 days, then 1 week, 3 weeks and every 2 months."}
          </p>
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
                  if (!m) return <span className="muted">Not in the dictionary. With your Claude key, tapping this word while reading saves its meaning in that sentence.</span>;
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
            <>
              <div className="grades three">
                {ANSWERS.map(({ a, label, cls }) => (
                  <button key={a} className={`btn ${cls}`} type="button" onClick={() => answer(a)}>{label}</button>
                ))}
              </div>
              <button className="btn small ghost" type="button" style={{ justifySelf: "center" }} onClick={() => answer("skip")}>
                Skip: not worth learning
              </button>
              <p className="note" style={{ margin: 0, textAlign: "center" }}>
                {recap ? "Hard and Medium go to your review pool." : "Hard and Medium come round again in this set, until you know it: Easy."}
              </p>
            </>
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
