import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as E from "@boekenwurm/engine";
import { dueCards, getState, planReviewSet, reviewCard, reviewedTodayCount, unskipCard, useStore } from "../lib/store.ts";
import { meaningOf } from "../lib/words.ts";
import { checkDailyChallenge, studyFinished } from "../lib/play.ts";
import { inWords } from "../lib/cards.ts";
import { close, open, useNav } from "../nav.ts";
import { Diary } from "./Diary.tsx";
import { Icon } from "../ui.tsx";
import { useT, type Key } from "../lib/i18n.ts";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The Study tab: two categories, Review (flashcards) and Diary. Links can open one (setTab("study", "diary")). */
export function Study() {
  const t = useT();
  const nav = useNav();
  const [view, setView] = useState<"review" | "diary">(nav.section === "diary" ? "diary" : "review");
  useEffect(() => {
    if (nav.section === "diary" || nav.section === "review") setView(nav.section);
  }, [nav.section]);
  return (
    <main className="screen">
      <div className="topbar"><h1>{t("tab.study")}</h1></div>
      <div className="subtabs" role="tablist" aria-label={t("tab.study")}>
        {(["review", "diary"] as const).map((v) => (
          <button key={v} type="button" role="tab" id={`tab-${v}`} aria-selected={view === v} aria-controls={`view-${v}`} onClick={() => setView(v)}>
            {v === "review" ? t("study.review") : t("study.diary")}
          </button>
        ))}
      </div>
      <div className="panels" role="tabpanel" id={`view-${view}`} aria-labelledby={`tab-${view}`}>
        {view === "review" ? <ReviewView /> : <Diary />}
      </div>
    </main>
  );
}

function ReviewView() {
  const t = useT();
  const cards = useStore((s) => s.cards);
  const wordbook = useStore((s) => s.wordbook);
  const meanings = useStore((s) => s.meanings);
  const all = Object.values(cards).filter((c) => c.pool !== "skipped");
  const skipped = Object.values(cards).filter((c) => c.pool === "skipped").sort((a, b) => a.lemma.localeCompare(b.lemma));
  // Today: at most 90 cards (new common words included); the rest of the pool waits for the days after.
  const plan = planReviewSet();
  const reviewed = Math.min(reviewedTodayCount(), E.REVIEW_DAY.maxDue);
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
    <>

      <section className="panel">
        <h2>{t("challenge.title", { n: E.REVIEW_DAY.maxDue })}</h2>
        <p>{t("challenge.lead", { n: E.REVIEW_DAY.maxDue })}</p>
        <div className="xpbar" role="progressbar" aria-label={t("challenge.aria")} aria-valuemin={0} aria-valuemax={E.REVIEW_DAY.maxDue} aria-valuenow={reviewed}>
          <i style={{ width: `${Math.round((reviewed / E.REVIEW_DAY.maxDue) * 100)}%` }} />
        </div>
        <p className="small num">{reviewed >= E.REVIEW_DAY.maxDue ? t("challenge.progressDone", { n: reviewed, max: E.REVIEW_DAY.maxDue, xp: E.XP.fullDayReview }) : t("challenge.progress", { n: reviewed, max: E.REVIEW_DAY.maxDue })}</p>
        {plan.lemmas.length > 0 ? (
          <button className="btn primary block" type="button" onClick={() => open({ name: "study-session" })}>
            {t("review.go", { n: plan.lemmas.length })}
          </button>
        ) : reviewed < E.REVIEW_DAY.maxDue && (
          <p className="small muted">{all.length ? t("review.none") : t("review.noneYet")}</p>
        )}
      </section>

      <section className="panel">
        <h2>{t("review.stuckTitle")}</h2>
        <p>{t("review.stuckLead")}</p>
        {stuck.length ? (
          <>
            <WordTable words={stuck} />
            <button className="btn" type="button" onClick={() => open({ name: "study-session", lemmas: stuck.map((w) => w.lemma) })}>
              {t("review.stuckGo", { n: stuck.length })}
            </button>
          </>
        ) : (
          <p className="empty">{t("review.stuckNone")}</p>
        )}
      </section>

      {skipped.length > 0 && (
        <section className="panel">
          <h2>{t("review.skippedTitle")}</h2>
          <p>{t("review.skippedLead")}</p>
          <div className="chips">
            {skipped.map((c) => (
              <button key={c.lemma} className="btn small ghost" type="button" lang="nl" onClick={() => void unskipCard(c.lemma)} aria-label={t("review.bringBack", { word: c.lemma })}>
                {c.lemma} ↺
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="panel">
        <h2>{t("review.revealedTitle")}</h2>
        {revealed.length > 0 && (
          <div className="actions">
            <button className="btn small" type="button" onClick={exportCsv}>{t("review.export")}</button>
            <span className="note">{t("review.exportNote")}</span>
          </div>
        )}
        {revealed.length ? <RevealedWords words={revealed} plan={plan.lemmas} /> : <p className="empty">{t("review.revealedNone")}</p>}
      </section>
    </>
  );
}

/**
 * Every revealed word, searchable, in study order: the next review set first, then the rest of the pool in review
 * order, then Easy words by their check-back date, then words with no card and skipped words.
 */
function RevealedWords({ words, plan }: { words: E.WordStats[]; plan: string[] }) {
  const t = useT();
  const cards = useStore((s) => s.cards);
  const meanings = useStore((s) => s.meanings);
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);
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
    if (inPlan.has(l)) return t("review.next.set");
    if (!c) return t("review.next.noCard");
    if (c.pool === "skipped") return t("review.next.skipped");
    if (c.pool === "hard") return t("review.next.hard");
    if (c.pool === "medium") return t("review.next.medium");
    return c.due <= now ? t("review.next.checkDue") : t("review.next.check", { when: inWords(c.due - now) });
  };
  return (
    <>
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("review.search")} aria-label={t("review.searchLabel")} />
      <p className="small muted">
        {query ? `${t("review.found", { n: found.length })} ` : ""}{t("review.sorted")}
      </p>
      {found.length ? <WordTable words={found} next={next} limit={all ? found.length : FIRST_WORDS} /> : <p className="empty">{t("review.noMatch", { q: q.trim() })}</p>}
      {found.length > FIRST_WORDS && (
        <button className="btn small ghost" type="button" aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? t("review.showFirst", { n: FIRST_WORDS }) : t("review.showAll", { n: found.length })}
        </button>
      )}
    </>
  );
}

/** The revealed-words list shows its first 40 (the words to study next) until the reader asks for all. */
const FIRST_WORDS = 40;

function WordTable({ words, next, limit = 200 }: { words: E.WordStats[]; next?: (lemma: string) => string; limit?: number }) {
  const t = useT();
  return (
    <div className="tablewrap">
      <table>
        <thead><tr><th>{t("review.col.word")}</th>{next && <th>{t("review.col.next")}</th>}<th>{t("review.col.revealed")}</th><th>{t("review.col.met")}</th><th>{t("review.col.rate")}</th></tr></thead>
        <tbody>
          {words.slice(0, limit).map((w) => {
            const rate = E.revealRate(w);
            return (
              <tr key={w.lemma}>
                <td><b lang="nl">{w.lemma}</b></td>
                {next && <td className="small">{next(w.lemma)}</td>}
                <td className="n">{w.reveals}</td>
                <td className="n">{w.encounters}</td>
                <td><div className="rate" title={t("review.rateTitle", { n: Math.round(rate * 100) })}><i style={{ width: `${Math.round(rate * 100)}%` }} /></div></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const ANSWERS: Array<{ a: E.Answer; label: Key; cls: string }> = [
  { a: "hard", label: "cards.hard", cls: "g-hard" },
  { a: "medium", label: "cards.medium", cls: "g-medium" },
  { a: "easy", label: "cards.easy", cls: "g-easy" },
];

/**
 * A flashcard session (packages/engine/src/review.ts):
 * - review (from Study or Home): a set from the pool, Hard first; Hard and Medium cards come round again until every
 *   card is rated Easy, and finishing the set earns the day's review reward;
 * - recap (a session summary's words, or "not sticking"): each word rated once, no repeats.
 * Skip drops a word that isn't worth learning; it can be brought back from Study.
 */
export function StudySession({ lemmas, afterLookupMode = false, bookId }: { lemmas?: string[]; afterLookupMode?: boolean; bookId?: string }) {
  const t = useT();
  // Studying a reading session's words: leaving goes back to the book, which opens at the page after the session.
  const book = useStore((s) => (bookId ? s.books.find((b) => b.id === bookId) : undefined));
  const leave = () => (book ? open({ name: "reader", bookId: book.id }) : close());
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
    void reviewCard(lemma, a, { inSet: !recap }).then(() => (recap ? 0 : checkDailyChallenge()));
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
        <button className="back" type="button" onClick={leave}><span style={{ width: 22, height: 22, display: "inline-block" }}><Icon.back /></span> {book ? t("cards.backToBook") : t("common.back")}</button>
        <span className="grow" />
        {lemma && <span className="num muted">{recap ? t("cards.ofTotal", { n: settled + 1, total: initial.length }) : t("cards.learned", { n: settled, total: initial.length })}</span>}
      </div>
      {!recap && initial.length > 0 && (
        <div className="xpbar" role="progressbar" aria-label={t("cards.easyAria")} aria-valuemin={0} aria-valuemax={initial.length} aria-valuenow={settled}>
          <i style={{ width: `${Math.round((settled / initial.length) * 100)}%` }} />
        </div>
      )}
      {!card ? (
        <section className="panel">
          <h2 className="big">
            {!initial.length ? t("cards.nothing") : recap ? t("cards.recapDone", { n: settled }) : t("cards.setDone", { n: initial.length })}
          </h2>
          <p>
            {recap
              ? t("cards.recapAfter")
              : t("cards.setAfter")}
          </p>
          {book ? (
            <div className="actions">
              <button className="btn primary" type="button" onClick={leave}>{t("cards.keepReading")}</button>
              <button className="btn ghost" type="button" onClick={close}>{t("tab.home")}</button>
            </div>
          ) : (
            <button className="btn primary" type="button" onClick={close}>{t("common.back")}</button>
          )}
        </section>
      ) : (
        <>
          <div className="flash">
            {isNew && <span className="chip" style={{ justifySelf: "center" }}>{t("cards.new")}</span>}
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
                  if (!m) return <span className="muted">{t("cards.noMeaning")}</span>;
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
                  <button key={a} className={`btn ${cls}`} type="button" onClick={() => answer(a)}>{t(label)}</button>
                ))}
              </div>
              <button className="btn small ghost" type="button" style={{ justifySelf: "center" }} onClick={() => answer("skip")}>
                {t("cards.skip")}
              </button>
              <p className="note" style={{ margin: 0, textAlign: "center" }}>
                {recap ? t("cards.recapNote") : t("cards.setNote")}
              </p>
            </>
          ) : (
            <button className="btn primary block" type="button" onClick={() => setFlipped(true)}>{t("cards.show")}</button>
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
