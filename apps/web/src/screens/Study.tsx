import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as E from "@boekenwurm/engine";
import { dueCards, dueToday, getState, planReviewSet, reviewCard, reviewedTodayCount, unskipCard, useStore, waitingAfterToday } from "../lib/store.ts";
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
  // Today: at most 90 cards (new common words included); the rest of the pool waits for the days after.
  const today = dueToday();
  const waiting = waitingAfterToday();
  const plan = planReviewSet();
  const fresh = plan.fresh.length;
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
        <h2>{today ? `${plural(today, "word")} due today` : due.length || reviewedTodayCount() >= E.REVIEW_DAY.maxDue ? "Done for today" : all.length ? "All caught up" : "No flashcards yet"}</h2>
        <p>
          {today
            ? `Up to 90 words a day. A review takes ${plan.lemmas.length}: your list words that need work first${fresh ? `, ${plural(fresh, "new common word")}` : ""}, then the rest of your pool, each repeated until you rate it Easy.${reviewedTodayCount() + today >= E.REVIEW_DAY.maxDue ? ` Review all ${E.REVIEW_DAY.maxDue} today for double review XP (+${E.XP.fullDayReview}).` : ""}`
            : due.length || reviewedTodayCount() >= E.REVIEW_DAY.maxDue
              ? `You've reviewed today's ${E.REVIEW_DAY.maxDue} words and earned double review XP. The rest come back tomorrow.`
              : all.length
                ? nextCheck ? `Your next check-back is ${inWords(nextCheck.due - Date.now())}.` : ""
                : "Every word you tap while reading becomes a flashcard. Rate it Hard, Medium or Easy; Hard and Medium words wait here for review."}
        </p>
        {due.length > 0 && <p className="small">In your pool: {[pool.hard && `${pool.hard} hard`, pool.medium && `${pool.medium} medium`, pool.easy && `${pool.easy} to check`].filter(Boolean).join(", ")}{waiting ? ` · ${plural(waiting, "word")} wait for the days after today` : ""}.</p>}
        {plan.lemmas.length > 0 && (
          <button className="btn primary block" type="button" onClick={() => open({ name: "study-session" })}>
            Review {plural(plan.lemmas.length, "word")}
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
        {revealed.length > 0 && (
          <div className="actions">
            <button className="btn small" type="button" onClick={exportCsv}>Export CSV</button>
            <span className="note">Opens in Anki, Quizlet, Mochi, RemNote and spreadsheets.</span>
          </div>
        )}
        {revealed.length ? <RevealedWords words={revealed} plan={plan.lemmas} /> : <p className="empty">Read a page and tap a word to start your list.</p>}
      </section>
    </main>
  );
}

/**
 * Every revealed word, searchable, in study order: the next review set first, then the rest of the pool in review
 * order, then Easy words by their check-back date, then words with no card and skipped words.
 */
function RevealedWords({ words, plan }: { words: E.WordStats[]; plan: string[] }) {
  const cards = useStore((s) => s.cards);
  const meanings = useStore((s) => s.meanings);
  const [q, setQ] = useState("");
  const now = Date.now();
  const planKey = plan.join("|");
  const rank = useMemo(() => {
    const r = new Map<string, number>();
    plan.forEach((l, i) => r.set(l, i));
    dueCards(now).forEach((c, i) => !r.has(c.lemma) && r.set(c.lemma, 1000 + i));
    Object.values(cards).filter((c) => c.pool === "easy" && !r.has(c.lemma)).sort((a, b) => a.due - b.due).forEach((c, i) => r.set(c.lemma, 100000 + i));
    return r;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, planKey]);
  const order = (l: string) => rank.get(l) ?? (cards[l]?.pool === "skipped" ? 3e6 : 2e6);
  const query = q.trim().toLowerCase();
  const found = words
    .filter((w) => !query || w.lemma.includes(query) || (meaningOf(w.lemma, meanings)?.en ?? "").toLowerCase().includes(query))
    .sort((a, b) => order(a.lemma) - order(b.lemma) || b.reveals - a.reveals || a.lemma.localeCompare(b.lemma));
  const inPlan = new Set(plan);
  const next = (l: string): string => {
    const c = cards[l];
    if (inPlan.has(l)) return "Next set";
    if (!c) return "No card";
    if (c.pool === "skipped") return "Skipped";
    if (c.pool === "hard") return "Hard";
    if (c.pool === "medium") return "Medium";
    return c.due <= now ? "Check due" : `Check ${inWords(c.due - now)}`;
  };
  return (
    <>
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your words or their meanings" aria-label="Search your words" />
      <p className="small muted">
        {query ? `${plural(found.length, "word")} found. ` : ""}Sorted by what you'll study next: your next review set first, then the rest of your pool.
      </p>
      {found.length ? <WordTable words={found} next={next} /> : <p className="empty">No word matches “{q.trim()}”.</p>}
      {found.length > 200 && <p className="note">Showing the first 200 of {found.length.toLocaleString()}. Search to find the others.</p>}
    </>
  );
}

function WordTable({ words, next }: { words: E.WordStats[]; next?: (lemma: string) => string }) {
  return (
    <div className="tablewrap">
      <table>
        <thead><tr><th>Word</th>{next && <th>Next</th>}<th>Revealed</th><th>Met</th><th>Reveal rate</th></tr></thead>
        <tbody>
          {words.slice(0, 200).map((w) => {
            const rate = E.revealRate(w);
            return (
              <tr key={w.lemma}>
                <td><b lang="nl">{w.lemma}</b></td>
                {next && <td className="small">{next(w.lemma)}</td>}
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
export function StudySession({ lemmas, afterLookupMode = false }: { lemmas?: string[]; afterLookupMode?: boolean }) {
  const cards = useStore((s) => s.cards);
  const meanings = useStore((s) => s.meanings);
  const examples = useStore((s) => s.examples);
  const recap = Boolean(lemmas);
  // The set is fixed when the session opens.
  const initial = useMemo(
    () => (lemmas ? lemmas.filter((l) => getState().cards[l]) : planReviewSet().lemmas),
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
    void studyFinished({ cards: settledRef.current, dueAtStart: initial.length, completedSet: !recap && doneRef.current, afterLookupMode });
  }, [initial.length, recap, afterLookupMode]);
  useEffect(() => () => award(), [award]);
  useEffect(() => {
    if (!queue.length) award();
  }, [queue.length, award]);

  const lemma = queue[0];
  // A new common word has no card until it is first rated.
  const card = lemma ? (cards[lemma] ?? (recap ? null : E.newReviewCard(lemma, Date.now()))) : null;
  const isNew = Boolean(lemma && !cards[lemma]);
  const answer = (a: E.Answer) => {
    void reviewCard(lemma, a, { inSet: !recap });
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
            {isNew && <span className="chip" style={{ justifySelf: "center" }}>New word</span>}
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
