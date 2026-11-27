/**
 * The app gate's reading: the next paragraph of the book the reader read last, full screen (docs/APP_GATE.md).
 *
 * By default lookups are unlimited and the paragraph's only rule is time: "Next" works after a reading time set by
 * its length (rules.ts, minReadMs). With Boekenwurm's rules (a gate setting) the reader's normal fouten apply,
 * tightening paragraph by paragraph as in the reader; a failed paragraph's time doesn't count towards the unlock.
 *
 * Either way the words tapped join the reader's word book and flashcards, and the reader's place in the book moves on,
 * as if they had read the paragraph in the reader. It earns no XP and no streak (store.ts, recordFinished `game`).
 */
import { useEffect, useRef, useState } from "react";
import * as E from "@boekenwurm/engine";
import { getState, recordFinished, saveMeaning } from "../lib/store.ts";
import { compoundMeaning, lookup } from "../lib/words.ts";
import { translateWord, type TranslateResult } from "../lib/translate.ts";
import { sentenceAround } from "../lib/text.ts";
import type { Meaning } from "../lib/types.ts";
import { WordPopover } from "../screens/Reader.tsx";
import { minReadMs, mmss, type ReadingRules } from "./rules.ts";
import { advancePlace, type NextParagraph } from "./state.ts";

type Found = Meaning | "pending" | "none" | "signin" | "limit" | "offline";

export interface ReadResult {
  passed: boolean;
  /** Time the paragraph was on screen. */
  spentMs: number;
}

export function GateReading({ next, rules, streak, onDone }: {
  next: NextParagraph;
  rules: ReadingRules;
  /** Paragraphs passed in a row at this gate, for Boekenwurm's rules (the fouten tighten as in the reader). */
  streak: number;
  onDone: (r: ReadResult) => void;
}) {
  const para = next.paragraph;
  const look = (surface: string) => lookup(surface, { meanings: getState().meanings });
  const words = para.tokens.filter((t) => t.k === "word");
  const [shownAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [session, setSession] = useState<E.Session>(() => {
    const base = rules === "boekenwurm"
      ? { ...E.startSession(E.rulesFor(getState().profile.settings.preset), { id: crypto.randomUUID() }), passesInARow: streak }
      : E.startSession(E.LOOKUP_MODE_RULES, { id: crypto.randomUUID(), tokenAtStreak: Number.MAX_SAFE_INTEGER });
    return E.beginParagraph(base, `gate-${next.book.id}-${next.ord}`, words.map((t) => look(t.t).lemma));
  });
  const [sel, setSel] = useState<number | null>(null);
  const [found, setFound] = useState<Record<string, Found>>({});
  const [busy, setBusy] = useState(false);
  const sentences = useRef<Record<string, string>>({});
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  const strict = rules === "boekenwurm";
  const st = E.status(session);
  const wait = minReadMs(words.length) - (now - shownAt);

  const count = (lemma: string, surface: string) =>
    setSession((s) => {
      if (!s.current) return s;
      sentences.current[lemma] ??= sentenceAround(para.text, surface);
      return E.reveal(s, { lemma, surface, at: Date.now() });
    });

  // A tap counts (a fout, a word to study) only when a meaning is found, as in the reader (lib/meaning.ts).
  const tap = async (i: number) => {
    const tok = para.tokens[i];
    setSel(i);
    if (tok.k !== "word") return;
    const d = look(tok.t);
    if (d.meaning) return count(d.lemma, tok.t);
    if (found[d.lemma] === "pending" || found[d.lemma] === "none") return;
    setFound((f) => ({ ...f, [d.lemma]: "pending" }));
    const t = await translateWord(tok.t).catch((): TranslateResult => ({ ok: false, reason: "offline" }));
    const m: Meaning | null = t.ok ? { en: t.text, nl: null, from: "translation", word: tok.t.toLowerCase() } : compoundMeaning(tok.t);
    if (m) {
      await saveMeaning(d.lemma, m);
      setFound((f) => ({ ...f, [d.lemma]: m }));
      count(d.lemma, tok.t);
    } else setFound((f) => ({ ...f, [d.lemma]: !t.ok && (t.reason === "signin" || t.reason === "limit" || t.reason === "offline") ? t.reason : "none" }));
  };

  const finish = async () => {
    setBusy(true);
    const out = E.turnPage(session);
    // The words join the word book and flashcards like any reading; no session row, XP or streak (`game`).
    await recordFinished({ session: out.session, book: next.book, startedAt: shownAt, endedBy: "left", sentences: sentences.current, lookupMode: !strict, game: true });
    await advancePlace(next);
    onDone({ passed: out.kind === "continue", spentMs: Date.now() - shownAt });
  };

  const tok = sel != null ? para.tokens[sel] : null;
  const d = tok && tok.k === "word" ? look(tok.t) : null;
  const f = d ? found[d.lemma] : undefined;
  const meaning = d?.meaning ?? (f && typeof f === "object" ? f : null);

  return (
    <section className="gate-read" aria-label="Read the next paragraph">
      <p className="gate-from small muted">
        <b>{next.book.title}</b> · paragraph {next.ord + 1} of {next.paragraphs.length}
      </p>
      {strict && (
        <p className="small gate-fouten" role="status">
          {st.used} of {st.allowed} {st.allowed === 1 ? "fout" : "fouten"}
          {st.used >= st.allowed && <span className="gate-warn"> · one more word and this paragraph doesn't count</span>}
        </p>
      )}
      <article className="gate-sheet">
        <div className="parawrap" ref={wrap}>
          <p className="para" lang="nl" dir="ltr">
            {para.tokens.map((t, i) =>
              t.k === "punct" || t.k === "number" ? <span key={i}>{t.t}</span> : (
                <button key={i} data-i={i} type="button" aria-expanded={sel === i}
                  className={`w ${t.k === "name" ? "name" : ""} ${sel === i ? "sel" : ""}`} onClick={() => void tap(i)}>{t.t}</button>
              ),
            )}
          </p>
          {sel != null && tok && (
            <WordPopover wrap={wrap} index={sel} onClose={() => setSel(null)}>
              <div className="def">
                <div className="head"><span className="word" lang="nl">{tok.t}</span>{d && d.lemma !== tok.t.toLowerCase() && <span className="lemma" lang="nl">{d.lemma}</span>}</div>
                {tok.k === "name" ? <span className="note">A name: it costs nothing.</span>
                  : meaning ? <div className="meaning" lang="en">{meaning.en ?? meaning.nl}</div>
                  : f === "pending" ? <span className="note">Looking it up…</span>
                  : f === "signin" ? <span className="note">Not in the dictionary. Sign in to look words up; this tap costs nothing.</span>
                  : f === "limit" ? <span className="note">Today’s lookups are used up; this tap costs nothing.</span>
                  : f === "offline" ? <span className="note">You’re offline; this tap costs nothing.</span>
                  : <span className="note">No meaning found; this tap costs nothing.</span>}
              </div>
            </WordPopover>
          )}
        </div>
      </article>
      <button className="btn primary block" type="button" disabled={busy || wait > 0} onClick={() => void finish()}>
        {wait > 0 ? `Keep reading · ${mmss(wait + 999)}` : "Next"}
      </button>
    </section>
  );
}
