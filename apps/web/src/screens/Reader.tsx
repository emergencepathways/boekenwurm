/**
 * The reader, ported from the playtest (branch playtest-v1): tap-to-reveal, strikes, streaks, streak tokens,
 * the level-up offer and badges, the end-of-session study list, and, with the reader's own Claude key,
 * Match my level (with Show original) and words in their sentence.
 */
import { useEffect, useReducer, useRef } from "react";
import * as E from "@boekenwurm/engine";
import * as AI from "@boekenwurm/ai";
import { pagesFinished } from "@boekenwurm/books";
import { bookById, getState, loadText, recordFinished, recordToken, saveBook, saveMeaning, updateProfile, useStore } from "../lib/store.ts";
import { fetchRemoteText } from "../lib/sync.ts";
import { claude, AiError } from "../lib/claude.ts";
import { db } from "../lib/db.ts";
import { hash, isOldForm, langOf, nameTest, sentenceAround, tokenize, type Token } from "../lib/text.ts";
import { lookup, listLemmas } from "../lib/words.ts";
import { knownShare } from "../lib/books.ts";
import { knownLemmas } from "../lib/store.ts";
import { canPrompt, isStandalone, promptInstall } from "../lib/install.ts";
import { close, open, setTab } from "../nav.ts";
import type { Book, BookText, Paragraph } from "../lib/types.ts";
import { Icon, plural, Sheet, TokenPips, toast } from "../ui.tsx";

type Matched =
  | { status: "pending" }
  | { status: "done"; changed: boolean; text: string; tokens?: Token[]; originalLevel: string | null }
  | { status: "failed"; note: string };
type Explained = { status: "pending" } | { status: "done"; data: AI.Explanation } | { status: "error"; error: string };

interface RS {
  book: Book | null;
  text: BookText | null;
  loadError: string | null;
  isName: (w: string, start: boolean) => boolean;
  pos: number;
  session: E.Session | null;
  startedAt: number;
  sel: number | null;
  sentences: Record<string, string>;
  summary: { kind: "complete" | "ended"; streakLength: number; list: E.StudyItem[]; paragraphs: number } | null;
  matched: Map<number, Matched>;
  explained: Map<string, Explained>;
  waiting: boolean;
  showOriginal: boolean;
  modal: { kind: "offer" } | { kind: "badge"; badge: E.Badge } | { kind: "match" } | null;
}

export function Reader({ bookId }: { bookId: string }) {
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const progress = useStore((s) => s.profile.progress);
  const settings = useStore((s) => s.profile.settings);
  const hasKey = useStore((s) => s.hasKey);
  const meanings = useStore((s) => s.meanings);
  const wordbook = useStore((s) => s.wordbook);
  const r = useRef<RS>({
    book: bookById(bookId), text: null, loadError: null, isName: () => false, pos: 0, session: null, startedAt: Date.now(),
    sel: null, sentences: {}, summary: null, matched: new Map(), explained: new Map(), waiting: false, showOriginal: false, modal: null,
  }).current;
  const inflight = useRef(new Map<number, Promise<void>>()).current;

  // ---------------------------------------------------------------- loading
  useEffect(() => {
    let live = true;
    (async () => {
      const book = bookById(bookId);
      if (!book) return void ((r.loadError = "This book isn't on this device any more."), bump());
      let text = await loadText(bookId);
      if (!text && book.textRemote) {
        try {
          text = (await fetchRemoteText(bookId)) ?? undefined;
        } catch {
          r.loadError = "This book's text is on your account but couldn't be downloaded. Check your connection and try again.";
        }
      }
      if (!live) return;
      if (!text?.paragraphs.length) {
        r.loadError ??= book.source === "photo" ? "No pages read yet. Add pages to start reading." : "This book has no paragraphs to read.";
        return bump();
      }
      r.book = bookById(bookId);
      r.text = text;
      const names = text.paragraphs.flatMap((p) => p.tokens.filter((t) => t.k === "name").map((t) => t.t));
      r.isName = nameTest(text.paragraphs.map((p) => p.text), names);
      r.pos = Math.min(r.book!.position.ord, text.paragraphs.length - 1);
      r.book = await saveBook({ ...r.book!, position: { ...r.book!.position, at: Date.now() } });
      startNewSession();
      bump();
    })();
    return () => {
      live = false;
      void leave();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  // Keep the "Undo tap" button honest: it disappears when the 5 seconds are up.
  useEffect(() => {
    const t = setInterval(() => r.sel != null && r.session?.current && bump(), 1000);
    return () => clearInterval(t);
  }, [r]);

  // ---------------------------------------------------------------- helpers
  const book = r.book;
  const mode = book?.position.mode ?? "original";
  const look = (surface: string) => lookup(surface, { meanings: getState().meanings });
  const original = (): Paragraph => r.text!.paragraphs[r.pos];
  const para = (): { text: string; tokens: Token[]; matched: boolean } => {
    const m = mode === "match" ? r.matched.get(r.pos) : null;
    return m && m.status === "done" && m.changed && m.tokens ? { text: m.text, tokens: m.tokens, matched: true } : { ...original(), matched: false };
  };
  const lemmasOf = (p: { tokens: Token[] }) => p.tokens.filter((t) => t.k === "word").map((t) => look(t.t).lemma);
  const rules = () => E.rulesFor(getState().profile.settings.preset);

  function startNewSession() {
    r.session = E.startSession(rules(), { id: crypto.randomUUID() });
    r.startedAt = Date.now();
    r.sentences = {};
    r.summary = null;
    r.sel = null;
    beginCurrent();
  }

  function beginCurrent() {
    if (!r.text) return;
    if (r.pos >= r.text.paragraphs.length) r.pos = 0;
    r.sel = null;
    r.showOriginal = false;
    if (r.book?.position.mode === "match") {
      for (const ahead of [1, 2]) void ensureMatched(r.pos + ahead); // the next pages are prepared while this one is read
      const m = r.matched.get(r.pos);
      if (!m || m.status === "pending") {
        r.waiting = true;
        const pos = r.pos;
        void ensureMatched(pos).then(() => {
          if (r.pos !== pos || !r.waiting || !r.session) return;
          r.waiting = false;
          r.session = E.beginParagraph(r.session, `p${pos}`, lemmasOf(para()));
          bump();
        });
        return;
      }
    }
    r.waiting = false;
    r.session = E.beginParagraph(r.session!, `p${r.pos}`, lemmasOf(para()));
  }

  // ---------------------------------------------------------------- tapping and turning
  function tap(i: number) {
    if (!r.session?.current) return;
    const tok = para().tokens[i];
    r.sel = i;
    if (tok.k === "word") {
      const d = look(tok.t);
      const before = E.status(r.session).used;
      r.session = E.reveal(r.session, { lemma: d.lemma, surface: tok.t, at: Date.now() });
      if (E.status(r.session).used > before) r.sentences[d.lemma] ??= sentenceAround(para().text, tok.t);
      explain(i);
    }
    bump();
  }

  function undo() {
    if (r.sel == null || !r.session?.current) return;
    r.session = E.undoReveal(r.session, look(para().tokens[r.sel].t).lemma, Date.now());
    bump();
  }

  async function savePosition(ord: number) {
    const b = bookById(bookId);
    if (!b || !r.text) return;
    const pagesRead =
      b.source === "photo"
        ? [...new Set([...b.pagesRead, ...pagesFinished(r.text.paragraphs.map((p) => ({ text: p.text, pageNumber: p.pageNumber, seqs: [] })), ord - 1)])].sort((x, y) => x - y)
        : b.pagesRead;
    r.book = await saveBook({ ...b, position: { ...b.position, ord, at: Date.now() }, pagesRead });
  }

  async function turn() {
    if (!r.session?.current || r.modal) return;
    const out = E.turnPage(r.session);
    r.session = out.session;
    r.pos++;
    const atEnd = r.pos >= r.text!.paragraphs.length;
    void savePosition(atEnd ? r.text!.paragraphs.length : r.pos);
    if (out.kind === "continue") {
      if (out.tokenEarnedNow) {
        const offer = await recordToken(r.session);
        toast("Streak token earned: 10 paragraphs in a row!");
        if (offer) r.modal = { kind: "offer" };
      }
      if (atEnd) return finish("complete", out.session.passesInARow);
      beginCurrent();
      bump();
    } else {
      void finish("ended", out.streakLength);
    }
  }

  async function finish(kind: "complete" | "ended", streakLength: number) {
    const s = r.session!;
    r.session = null;
    const { list, offer } = await recordFinished({ session: s, book: r.book!, startedAt: r.startedAt, endedBy: kind === "complete" ? "end_of_book" : "strike", sentences: r.sentences });
    r.summary = { kind, streakLength, list, paragraphs: s.results.length };
    if (r.pos >= r.text!.paragraphs.length && r.book?.source !== "photo") r.pos = 0;
    if (offer) r.modal = { kind: "offer" };
    bump();
  }

  /** Leaving mid-session still counts what was read (ended_by "left"). */
  async function leave() {
    const s = r.session;
    if (!s || !r.book) return;
    r.session = null;
    if (!s.results.length && !s.reveals.length && !s.current?.reveals.length) return;
    const withCurrent = s.current ? { ...s, reveals: [...s.reveals, ...s.current.reveals], current: null } : s;
    await recordFinished({ session: withCurrent, book: r.book, startedAt: r.startedAt, endedBy: "left", sentences: r.sentences });
  }

  // ---------------------------------------------------------------- Claude: Match my level and words in context
  function knownShareOf(t: string) {
    return knownShare(t, knownLemmas(listLemmas()));
  }

  function ensureMatched(pos: number): Promise<void> {
    if (!r.text || pos >= r.text.paragraphs.length || r.book?.position.mode !== "match") return Promise.resolve();
    const have = r.matched.get(pos);
    if (have && have.status !== "pending") return Promise.resolve();
    if (inflight.has(pos)) return inflight.get(pos)!;
    const target = getState().profile.progress.level;
    const model = getState().profile.settings.models.match;
    const orig = r.text.paragraphs[pos];
    const key = `m|${bookId}|${hash(orig.text)}|${target}|${model}`;
    r.matched.set(pos, { status: "pending" });
    const job = (async (): Promise<Matched> => {
      const cached = await db.get<Matched>("cache", key);
      if (cached) return cached;
      const names = orig.tokens.filter((t) => t.k === "name").map((t) => t.t);
      const checks: AI.MatchChecks = { names, language: (t) => langOf(t).lang, isOldForm, knownShare: knownShareOf };
      let prompt = AI.matchPrompt(orig.text, target as AI.Cefr, names);
      let problems: string[] = [];
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = AI.parseMatch(await claude(prompt, model), orig.text);
        problems = AI.validateMatch(orig.text, result, checks);
        if (!problems.length) {
          const value: Matched = { status: "done", changed: result.changed, text: result.text, originalLevel: result.originalLevel };
          await db.put("cache", value, key);
          return value;
        }
        prompt = { ...prompt, user: `${prompt.user}\n\nYour previous version had these problems: ${problems.join(" ")} Fix them.` };
      }
      return { status: "failed", note: `Couldn't match this paragraph to ${target}: ${problems.join(" ")} Showing the original.` };
    })()
      .catch((e): Matched => ({ status: "failed", note: e instanceof AiError ? e.message : "Something went wrong while matching this paragraph. Showing the original." }))
      .then((v) => {
        if (v.status === "done" && v.changed) v = { ...v, tokens: tokenize(v.text, r.isName) };
        r.matched.set(pos, v);
        inflight.delete(pos);
        if (v.status === "failed" && pos === r.pos) toast(v.note, 5000);
      });
    inflight.set(pos, job);
    return job;
  }

  function explain(i: number) {
    const tok = para().tokens[i];
    const k = `${r.pos}|${i}|${para().matched ? "m" : "o"}`;
    if (!getState().hasKey || tok.k !== "word" || r.explained.has(k)) return;
    const sentence = sentenceAround(para().text, tok.t);
    const level = getState().profile.progress.level;
    const model = getState().profile.settings.models.words;
    const cacheKey = `x|${hash(sentence)}|${tok.t.toLowerCase()}|${level}|${model}`;
    const lemma = look(tok.t).lemma;
    r.explained.set(k, { status: "pending" });
    (async () => {
      const cached = await db.get<AI.Explanation>("cache", cacheKey);
      if (cached) return cached;
      const data = AI.parseExplanation(await claude(AI.explainPrompt(tok.t, sentence, level as AI.Cefr), model), tok.t);
      await db.put("cache", data, cacheKey);
      return data;
    })()
      .then((data) => {
        r.explained.set(k, { status: "done", data });
        // The meaning in this sentence becomes the back of the word's flashcard.
        void saveMeaning(lemma, { en: data.meaningEn || null, nl: data.meaningNl || null, from: "claude" });
      })
      .catch((e) => r.explained.set(k, { status: "error", error: e instanceof AiError ? e.message : "Couldn't explain this word." }))
      .finally(bump);
  }

  async function setMode(next: "original" | "match") {
    const b = bookById(bookId)!;
    r.book = await saveBook({ ...b, position: { ...b.position, mode: next } });
    r.modal = null;
    r.matched.clear();
    void leave();
    startNewSession();
    bump();
  }

  // ---------------------------------------------------------------- keys and swipes
  useEffect(() => {
    const key = (ev: KeyboardEvent) => {
      if (r.summary || r.modal || /INPUT|SELECT|TEXTAREA/.test((ev.target as HTMLElement).tagName)) return;
      if (ev.key === "ArrowRight" || (ev.key === " " && !(ev.target as HTMLElement).closest("button"))) {
        ev.preventDefault();
        void turn();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  const touchX = useRef<number | null>(null);

  // ---------------------------------------------------------------- render
  if (r.loadError)
    return (
      <main className="screen full reader">
        <TopBar title={book?.title ?? "Book"} />
        <section className="panel">
          <p>{r.loadError}</p>
          {book?.source === "photo" && <button className="btn primary" type="button" onClick={() => open({ name: "photo", bookId })}>Add pages</button>}
        </section>
      </main>
    );
  if (!book || !r.text) return <main className="screen full reader"><TopBar title={book?.title ?? ""} /><div className="spinner" /></main>;

  const levelIdx = (l: string | null) => (l ? E.LEVELS.indexOf(l as E.CefrLevel) : -1);
  const above = book.level != null && levelIdx(book.level) > levelIdx(progress.level);

  return (
    <main className="screen full reader">
      <TopBar
        title={book.title}
        right={
          above || mode === "match" ? (
            <button className="btn small" type="button" onClick={() => ((r.modal = { kind: "match" }), bump())}>
              {mode === "match" ? `Matched to ${progress.level}` : "Match my level"}
            </button>
          ) : null
        }
      />
      {r.summary ? (
        renderSummary()
      ) : r.waiting || !r.session?.current ? (
        <article className="sheet">
          <div className="folio"><span>{book.title}</span><span className="num">{r.pos + 1} / {r.text.paragraphs.length}</span></div>
          <p className="para muted" aria-live="polite">Matching this paragraph to {progress.level}…</p>
          <div className="actions"><button className="btn small ghost" type="button" onClick={() => void setMode("original")}>Read the original instead</button></div>
        </article>
      ) : (
        renderPage()
      )}
      {r.modal?.kind === "offer" && progress.offer && renderOffer()}
      {r.modal?.kind === "badge" && renderBadge(r.modal.badge)}
      {r.modal?.kind === "match" && renderMatch()}
    </main>
  );

  function renderPage() {
    const s = r.session!;
    const st = E.status(s);
    const lastStrike = s.rules.failWhen === "reaches";
    const p = para();
    const revealed = new Set(s.current!.reveals.map((x) => x.lemma));
    const onStreak = E.inStreak(s.passesInARow, s.rules);
    return (
      <>
        <section className="strip" aria-label="Checkpoint">
          <span>
            <span className="label">Strikes</span>{" "}
            <span className="strikes" aria-label={`${st.used} of ${st.allowed} used`}>
              {Array.from({ length: Math.min(st.allowed, 30) }, (_, i) => (
                <i key={i} className={`pip ${i < st.used ? "used" : ""} ${lastStrike && i === st.allowed - 1 && i >= st.used ? "last" : ""}`} />
              ))}
            </span>
          </span>
          <span className="num">{st.percent}% · {plural(st.allowed, "strike")}</span>
          {onStreak && <span className="streak">Streak {st.streak}</span>}
          <span className="grow" />
          <span><span className="label">Level</span> <TokenPips progress={progress} /></span>
        </section>
        {st.strikesLeft === 0 && lastStrike && <div className="warnline">No strikes left: one more reveal ends the run at the page turn.</div>}
        <article
          className="sheet"
          onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
          onTouchEnd={(e) => {
            if (touchX.current == null) return;
            const dx = e.changedTouches[0].clientX - touchX.current;
            touchX.current = null;
            if (dx < -70) void turn();
          }}
        >
          <div className="folio">
            <span>{book!.title}</span>
            <span className="num">{r.pos + 1} / {r.text!.paragraphs.length}</span>
          </div>
          {mode === "match" && renderMatchedLine(p.matched)}
          <p className="para" lang="nl">
            {p.tokens.map((t, i) =>
              t.k === "punct" || t.k === "number" ? (
                <span key={i}>{t.t}</span>
              ) : (
                <button
                  key={i}
                  type="button"
                  className={`w ${t.k === "name" ? "name" : revealed.has(look(t.t).lemma) ? "rev" : ""} ${r.sel === i ? "sel" : ""}`}
                  onClick={() => tap(i)}
                >
                  {t.t}
                </button>
              ),
            )}
          </p>
          {r.showOriginal && p.matched && (
            <div className="original"><span className="label">Original</span><p lang="nl">{original().text}</p></div>
          )}
          <div className="def" aria-live="polite">{renderDefinition(onStreak)}</div>
          <div className="actions">
            <button className="btn primary nextbtn" type="button" onClick={() => void turn()}>Next page →</button>
          </div>
        </article>
        <p className="note" style={{ margin: 0 }}>Tap a word to see its meaning. Swipe left or press → to turn the page.</p>
      </>
    );
  }

  function renderMatchedLine(matched: boolean) {
    const m = r.matched.get(r.pos);
    if (matched)
      return (
        <div className="matched">
          <span className="chip">Matched to {progress.level}</span>
          {m?.status === "done" && m.originalLevel && <span className="muted">original about {m.originalLevel}</span>}
          <button className="btn small ghost" type="button" onClick={() => ((r.showOriginal = !r.showOriginal), bump())}>
            {r.showOriginal ? "Hide original" : "Show original"}
          </button>
        </div>
      );
    if (m?.status === "done") return <div className="matched"><span className="chip">Already at your level</span></div>;
    if (m?.status === "failed") return <div className="matched"><span className="chip warn">Original</span><span className="muted small">{m.note}</span></div>;
    return null;
  }

  function renderDefinition(onStreak: boolean) {
    if (r.sel == null) return <span className="note">Tap any word you don't know. Names and numbers never count.</span>;
    const tok = para().tokens[r.sel];
    if (tok.k === "name")
      return (
        <>
          <div className="head"><span className="word">{tok.t}</span><span className="lemma">name</span></div>
          <span className="note">A name stays as it is. It doesn't use a strike.</span>
        </>
      );
    const d = look(tok.t);
    const lang = E.definitionLanguage({ level: progress.level, preference: settings.defPref, onStreak });
    const rev = r.session!.current!.reveals.find((x) => x.lemma === d.lemma);
    const canUndo = rev && Date.now() - rev.at <= r.session!.undoWindowMs;
    const m = d.meaning;
    const lifetime = wordbook[d.lemma]?.reveals ?? 0;
    const why = lang === "nl" ? (onStreak ? "Dutch explanation: you're on a streak." : "Dutch explanation from B1.") : "";
    const k = `${r.pos}|${r.sel}|${para().matched ? "m" : "o"}`;
    const x = r.explained.get(k);
    return (
      <>
        <div className="head">
          <span className="word" lang="nl">{tok.t}</span>
          {d.lemma !== tok.t.toLowerCase() ? <span className="lemma">{m?.article ? `${m.article} ` : ""}{d.lemma}</span> : m?.article ? <span className="lemma">{m.article}</span> : null}
          {lifetime > 0 && <span className="lemma">revealed {lifetime}× before</span>}
          {canUndo && <button className="btn small ghost undo" type="button" onClick={undo}>Undo tap</button>}
        </div>
        {m && m.from !== "claude" ? (
          lang === "nl" && m.nl ? <div className="meaning nl" lang="nl">{m.nl}</div> : m.en ? (
            <>
              <div className="meaning">{m.en}</div>
              {lang === "nl" && <span className="note">No Dutch explanation for this word yet, so here is the English.</span>}
            </>
          ) : null
        ) : !x ? (
          <span className="note">
            {hasKey ? "Not in the dictionary. The reveal still counts, and the word goes on your list." : "Not in the dictionary. The reveal still counts and the word goes on your list. With your Claude key (Me → Claude), you see what it means in this sentence."}
          </span>
        ) : null}
        {why && <span className="note">{why}</span>}
        {x?.status === "pending" && <span className="note">Checking this sentence…</span>}
        {x?.status === "error" && <span className="note">{x.error}</span>}
        {x?.status === "done" && (
          <div className="ctx">
            <span className="label">In this sentence</span>
            <div className={`meaning ${lang === "nl" && x.data.meaningNl ? "nl" : ""}`}>
              {x.data.lemma && <b lang="nl">{x.data.lemma}: </b>}
              {lang === "nl" && x.data.meaningNl ? <span lang="nl">{x.data.meaningNl}</span> : x.data.meaningEn || x.data.meaningNl}
            </div>
            {x.data.note && <span className="note">{x.data.note}</span>}
          </div>
        )}
      </>
    );
  }

  function renderSummary() {
    const s = r.summary!;
    const atBookEnd = r.book?.source === "photo" && r.pos >= r.text!.paragraphs.length;
    return (
      <section className="panel">
        <h2 className="big">
          {s.kind === "complete"
            ? atBookEnd ? "You've read every page photographed so far." : `You read to the end. ${plural(s.streakLength, "paragraph")} passed in a row.`
            : s.streakLength >= 2 ? `Your streak lasted ${s.streakLength} paragraphs.` : s.streakLength === 1 ? "You passed 1 paragraph this time." : "That paragraph used your last strike."}
        </h2>
        <p>{s.list.length ? `You revealed ${plural(s.list.length, "word")}. The ones you've needed most often come first.` : "You didn't reveal a single word."}</p>
        {s.list.length > 0 && (
          <div className="tablewrap">
            <table>
              <thead><tr><th>Word</th><th>Meaning</th><th>Today</th><th>All time</th></tr></thead>
              <tbody>
                {s.list.map((w) => {
                  const m = lookup(w.forms[0], { meanings }).meaning;
                  return (
                    <tr key={w.lemma}>
                      <td><b lang="nl">{w.lemma}</b><div className="forms">{w.forms.join(", ")}</div></td>
                      <td>{m?.en ?? m?.nl ?? "—"}</td>
                      <td className="n">{w.sessionReveals}</td>
                      <td className="n">{w.lifetimeReveals}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="actions">
          {s.list.length > 0 && (
            <button className="btn primary" type="button" onClick={() => open({ name: "study-session", lemmas: s.list.map((w) => w.lemma) })}>
              Study these {plural(s.list.length, "word")}
            </button>
          )}
          {atBookEnd ? (
            <button className="btn" type="button" onClick={() => open({ name: "photo", bookId })}>Add pages</button>
          ) : (
            <button className="btn" type="button" onClick={() => (startNewSession(), bump())}>Keep reading</button>
          )}
        </div>
        {canPrompt() && !isStandalone() && (
          <div className="verdict">
            <b>Keep Boekenwurm on your home screen</b>
            <span className="small">It opens like an app and works offline.</span>
            <button className="btn small" type="button" onClick={() => void promptInstall()}>Install</button>
          </div>
        )}
      </section>
    );
  }

  function renderOffer() {
    const o = progress.offer!;
    const accept = async () => {
      const res = E.acceptLevelUp(getState().profile.progress, Date.now());
      await updateProfile((p) => ({ ...p, progress: res.progress }));
      r.matched.clear();
      r.modal = res.newBadges.length ? { kind: "badge", badge: res.newBadges[res.newBadges.length - 1] } : null;
      bump();
    };
    const decline = async () => {
      await updateProfile((p) => ({ ...p, progress: E.declineLevelUp(p.progress) }));
      r.modal = null;
      bump();
    };
    return (
      <Sheet label="Move up a level">
        <div className="medal lg">{o.to}</div>
        <h2 className="big" style={{ fontSize: "1.45rem", textAlign: "center" }}>Move up from {o.from} to {o.to}?</h2>
        <p className="muted" style={{ textAlign: "center", margin: 0 }}>
          Three sessions with a 10-paragraph streak. At {o.to} you'll get harder paragraphs{o.to === "B1" ? ", and explanations in Dutch" : ""}.
        </p>
        <div className="actions" style={{ justifyContent: "center" }}>
          <button className="btn primary" type="button" onClick={() => void accept()}>Yes, move up</button>
          <button className="btn" type="button" onClick={() => void decline()}>Not yet</button>
        </div>
      </Sheet>
    );
  }

  function renderBadge(badge: E.Badge) {
    const info = E.BADGES[badge.level];
    return (
      <Sheet label="New badge" onClose={() => ((r.modal = null), bump())}>
        <div className="medal lg">{badge.level}</div>
        <span className="label" style={{ textAlign: "center" }}>New badge</span>
        <h2 className="big" style={{ textAlign: "center" }} lang="nl">{info.title}</h2>
        <p className="muted" style={{ textAlign: "center", margin: 0 }}>{info.meaning}. You're now reading at {badge.level}.</p>
        <button className="btn primary block" type="button" onClick={() => ((r.modal = null), bump())}>Keep reading</button>
      </Sheet>
    );
  }

  function renderMatch() {
    const sc = book!.scan;
    return (
      <Sheet label="Match my level" onClose={() => ((r.modal = null), bump())}>
        <h2 className="big" style={{ fontSize: "1.35rem" }}>Read this book at {progress.level}</h2>
        {sc?.level && (
          <div className="stats">
            <div className="stat"><span className="label">Book level</span><b>About {sc.level}</b></div>
            {sc.wordMatch != null && <div className="stat"><span className="label">Words you know</span><b className="num">{Math.round(sc.wordMatch * 100)}%</b></div>}
            <div className="stat"><span className="label">At your level</span><b className="num">{Math.round(sc.withinReach * 100)}%</b></div>
          </div>
        )}
        {hasKey ? (
          <p className="muted" style={{ margin: 0 }}>
            Each paragraph above {progress.level} is rewritten at your level when you reach it, using your Claude key: about one request per
            paragraph, prepared two ahead so there's no waiting. Every rewrite is checked (names kept, nothing added, modern Dutch), and the original
            is always one tap away.
          </p>
        ) : (
          <p className="muted" style={{ margin: 0 }}>Matching paragraphs to your level uses your own Claude key. Add it under Me → Claude.</p>
        )}
        <div className="actions">
          {hasKey && mode !== "match" && <button className="btn primary" type="button" onClick={() => void setMode("match")}>Match my level</button>}
          {mode === "match" && <button className="btn" type="button" onClick={() => void setMode("original")}>Read the original</button>}
          {!hasKey && <button className="btn primary" type="button" onClick={() => setTab("me", "claude")}>Add my key</button>}
          <button className="btn ghost" type="button" onClick={() => ((r.modal = null), bump())}>Close</button>
        </div>
      </Sheet>
    );
  }
}

function TopBar({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div className="topbar">
      <button className="back" type="button" onClick={close} aria-label="Back to Home">
        <span style={{ width: 22, height: 22, display: "inline-block" }}><Icon.back /></span> Home
      </button>
      <span className="grow" />
      <span className="sr-only">{title}</span>
      {right}
    </div>
  );
}
