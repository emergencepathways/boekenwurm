/**
 * The reader, ported from the playtest (branch playtest-v1): tap-to-reveal, strikes, streaks, streak tokens,
 * the level-up offer and badges, the end-of-session study list, and, with the reader's own Claude key,
 * Match my level (with Show original) and words in their sentence.
 */
import { useEffect, useReducer, useRef, useState } from "react";
import * as E from "@boekenwurm/engine";
import * as AI from "@boekenwurm/ai";
import { pagesFinished } from "@boekenwurm/books";
import { bookById, getState, loadText, recordFinished, saveBook, saveMeaning, updateProfile, useStore } from "../lib/store.ts";
import { fetchRemoteText } from "../lib/sync.ts";
import { claude, AiError } from "../lib/claude.ts";
import { db } from "../lib/db.ts";
import { hash, isOldForm, langOf, nameTest, sentenceAround, tokenize, type Token } from "../lib/text.ts";
import { compoundMeaning, lookup, listLemmas } from "../lib/words.ts";
import { reportTranslation, translateWord, type TranslateResult } from "../lib/translate.ts";
import { bookFinished, checkAchievements, paragraphRead, rankNow } from "../lib/play.ts";
import { DAILY_TRANSLATIONS } from "../lib/usage.ts";
import { knownShare } from "../lib/books.ts";
import { knownLemmas } from "../lib/store.ts";
import { canPrompt, isStandalone, promptInstall } from "../lib/install.ts";
import { close, open, setTab } from "../nav.ts";
import { SECTION_SIZE } from "../lib/pages.ts";
import type { Book, BookText, Meaning, Paragraph } from "../lib/types.ts";
import { Icon, plural, Sheet, toast } from "../ui.tsx";

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
  /** Words being looked up (no dictionary meaning yet), or found to have none: base form -> state. */
  lookups: Map<string, "pending" | "none" | "offline" | "limit" | "signin">;
  explaining: Map<string, Promise<AI.Explanation | null>>;
  modal: { kind: "offer" } | { kind: "badge"; badge: E.Badge } | { kind: "match" } | { kind: "goto" } | null;
  /**
   * Looking at a paragraph without penalty: one before the current one ("Previous"), or the one just finished, from
   * the session summary ("Re-read"). Taps show meanings but cost no strike and don't count; the session is untouched.
   */
  look: { ord: number; kind: "previous" | "reread"; selBefore: number | null } | null;
  /** The paragraph read last (before the latest page turn): the one "Re-read" opens. */
  lastRead: number | null;
  /** XP earned since the reader opened this book. */
  xp: number;
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
    sel: null, sentences: {}, summary: null, matched: new Map(), explained: new Map(), explaining: new Map(), lookups: new Map(), waiting: false, showOriginal: false, modal: null, look: null, lastRead: null, xp: 0,
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
  /** The paragraph on screen: the current one, or the one being looked back at. */
  const at = (): number => r.look?.ord ?? r.pos;
  const original = (): Paragraph => r.text!.paragraphs[at()];
  const para = (): { text: string; tokens: Token[]; matched: boolean } => {
    const m = mode === "match" ? r.matched.get(at()) : null;
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
  /**
   * A tap reveals a word. It counts (a strike, a word to study) only when a meaning is found: the dictionary or the
   * reader's word list at once, otherwise Google Translate, the word's two parts as a compound, or Claude with the
   * reader's key. When none finds one, the tap is free (lib/meaning.ts).
   */
  function tap(i: number) {
    if (!r.session?.current && !r.look) return;
    const tok = para().tokens[i];
    r.sel = i;
    if (tok.k === "word") {
      const d = look(tok.t);
      // Looking back: the meaning is shown, nothing counts.
      if (r.look) {
        if (d.meaning) void explain(i);
        else void findMeaning(i, d.lemma, tok.t, { free: true });
      } else if (d.meaning) countTap(i, d.lemma, tok.t);
      else void findMeaning(i, d.lemma, tok.t);
    }
    bump();
  }

  /**
   * Colour-coded text (a setting, off by default): a word revealed before is coloured by how often it was revealed in
   * the last 14 days, counting this session's reveals too (E.wordColor). Names and new words stay plain.
   */
  function tint(t: Token): string {
    if (settings.colorText !== true || t.k !== "word") return "";
    const lemma = look(t.t).lemma;
    const s = r.session;
    const extra = s ? [...s.reveals, ...(s.current?.reveals ?? [])].filter((x) => x.lemma === lemma).map((x) => x.at) : [];
    const c = E.wordColor(wordbook[lemma], Date.now(), extra);
    return c ? ` c-${c}` : "";
  }

  /** "Previous": look at the paragraph before (or one more back), without penalty. */
  function lookBack(kind: "previous" | "reread", ord: number) {
    if (!r.text || ord < 0) return;
    r.look = { ord, kind, selBefore: r.look ? r.look.selBefore : r.sel };
    r.sel = null;
    if (r.book?.position.mode === "match") void ensureMatched(ord).then(bump);
    bump();
  }

  /** Back to where the reader was: the current paragraph, or the session summary. */
  function endLook() {
    if (!r.look) return;
    r.sel = r.look.selBefore;
    r.look = null;
    bump();
  }

  function countTap(i: number, lemma: string, surface: string) {
    if (!r.session?.current) return;
    const before = E.status(r.session).used;
    r.session = E.reveal(r.session, { lemma, surface, at: Date.now() });
    if (E.status(r.session).used > before) r.sentences[lemma] ??= sentenceAround(para().text, surface);
    void explain(i);
  }

  async function findMeaning(i: number, lemma: string, surface: string, opts: { free?: boolean } = {}) {
    const state = r.lookups.get(lemma);
    if (state === "pending" || state === "none") return; // "offline" tries again
    r.lookups.set(lemma, "pending");
    bump();
    const where = r.session?.current?.paragraphId;
    const word = surface.toLowerCase();
    let meaning: Meaning | null = null;
    // Saved meanings (this reader's, from any device) were already checked by look(); Google is next.
    const t = await translateWord(surface).catch((): TranslateResult => ({ ok: false, reason: "offline" }));
    if (t.ok) meaning = { en: t.text, nl: null, from: "translation", word, ...(t.shared ? { shared: true } : {}) };
    meaning ??= compoundMeaning(surface);
    if (!meaning && getState().hasKey) {
      const x = await explain(i);
      if (x && (x.meaningEn || x.meaningNl)) meaning = { en: x.meaningEn || null, nl: x.meaningNl || null, from: "claude", word };
    }
    if (meaning) {
      r.lookups.delete(lemma);
      // Saved for this reader (device and account), so the word is never looked up again.
      await saveMeaning(lemma, meaning);
      // Count it only if the reader is still on the paragraph they tapped in (never when looking back).
      if (!opts.free && !r.look && r.session?.current?.paragraphId === where) countTap(i, lemma, surface);
    } else if (!t.ok && (t.reason === "limit" || t.reason === "signin")) r.lookups.set(lemma, t.reason);
    else r.lookups.set(lemma, !t.ok && t.reason === "offline" && !navigator.onLine ? "offline" : "none");
    bump();
  }

  /** A Google translation reported as wrong: the reader's own meaning replaces it for them at once. */
  async function reported(lemma: string, surface: string, text: string) {
    const meaning = text.trim().slice(0, 300);
    if (!meaning) return;
    await saveMeaning(lemma, { en: meaning, nl: null, from: "manual", word: surface.toLowerCase() });
    const sent = await reportTranslation(surface, meaning);
    toast(sent ? "Thanks: reported. Your meaning is used from now on." : "Your meaning is used from now on. Sign in to send reports.", 4000);
    bump();
  }

  /** The reader typed a meaning: it is saved like any other, and the tap counts. */
  async function typedMeaning(i: number, lemma: string, surface: string, text: string) {
    const meaning = text.trim().slice(0, 300);
    if (!meaning) return;
    r.lookups.delete(lemma);
    if (!r.look) countTap(i, lemma, surface);
    bump();
    await saveMeaning(lemma, { en: meaning, nl: null, from: "manual", word: surface.toLowerCase() });
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
      hasPages()
        ? [...new Set([...b.pagesRead, ...pagesFinished(r.text.paragraphs.map((p) => ({ text: p.text, pageNumber: p.pageNumber, seqs: [] })), ord - 1)])].sort((x, y) => x - y)
        : b.pagesRead;
    r.book = await saveBook({ ...b, position: { ...b.position, ord, at: Date.now() }, pagesRead });
  }

  async function turn() {
    if (!r.session?.current || r.modal) return;
    const streak = E.inStreak(r.session.passesInARow, r.session.rules);
    const read = para();
    const out = E.turnPage(r.session);
    r.session = out.session;
    r.lastRead = r.pos;
    r.pos++;
    const atEnd = r.pos >= r.text!.paragraphs.length;
    void savePosition(atEnd ? r.text!.paragraphs.length : r.pos);
    // XP for the paragraph read: double on a streak, a quarter when it ends the run, × 1.5 above the reader's rank.
    const textLevel = (read.matched ? getState().profile.progress.level : r.book?.level ?? null) as E.CefrLevel | null;
    r.xp += await paragraphRead({
      book: r.book!, textLevel, failed: out.kind === "ended", streak, words: read.tokens.filter((t) => t.k === "word").length,
      bookHasPages: hasPages(), bestStreak: out.session.bestStreak,
    });
    if (atEnd && (r.book?.source !== "photo" || nextUnphotographed() == null)) r.xp += await bookFinished(r.book!);
    if (out.kind === "continue") {
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
    void checkAchievements(); // words looked up count once the session is recorded
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
    void checkAchievements();
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

  function explain(i: number): Promise<AI.Explanation | null> {
    const tok = para().tokens[i];
    const k = `${at()}|${i}|${para().matched ? "m" : "o"}`;
    if (!getState().hasKey || tok.k !== "word") return Promise.resolve(null);
    const have = r.explaining.get(k);
    if (have) return have;
    const sentence = sentenceAround(para().text, tok.t);
    const level = getState().profile.progress.level;
    const model = getState().profile.settings.models.words;
    const cacheKey = `x|${hash(sentence)}|${tok.t.toLowerCase()}|${level}|${model}`;
    const lemma = look(tok.t).lemma;
    r.explained.set(k, { status: "pending" });
    const job = (async () => {
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
        return data;
      })
      .catch((e) => {
        r.explained.set(k, { status: "error", error: e instanceof AiError ? e.message : "Couldn't explain this word." });
        return null;
      })
      .finally(bump);
    r.explaining.set(k, job);
    return job;
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
      if (r.modal || /INPUT|SELECT|TEXTAREA/.test((ev.target as HTMLElement).tagName)) return;
      if (r.look) {
        if (ev.key === "Escape" || ev.key === "ArrowRight") (ev.preventDefault(), endLook());
        else if (ev.key === "ArrowLeft" && r.look.kind === "previous" && r.look.ord > 0) (ev.preventDefault(), lookBack("previous", r.look.ord - 1));
        return;
      }
      if (r.summary) return;
      if (ev.key === "ArrowLeft" && r.session?.current && r.pos > 0) {
        ev.preventDefault();
        return lookBack("previous", r.pos - 1);
      }
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
          <>
            <button className="btn small ghost" type="button" onClick={() => ((r.modal = { kind: "goto" }), bump())} aria-label="Go to a page">
              {hasPages() ? `p. ${pageAt(r.pos) ?? "?"}` : "Go to"}
            </button>
            {(above || mode === "match") && (
              <button className="btn small" type="button" onClick={() => ((r.modal = { kind: "match" }), bump())}>
                {mode === "match" ? `Matched to ${progress.level}` : "Match my level"}
              </button>
            )}
          </>
        }
      />
      {r.look ? (
        renderLook()
      ) : r.summary ? (
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
      {r.modal?.kind === "goto" && renderGoto()}
    </main>
  );

  // ---------------------------------------------------------------- pages: where the reader is, going to a page
  function hasPages(): boolean {
    return Boolean(r.text?.paragraphs.some((p) => p.pageNumber != null));
  }
  function pageAt(ord: number): number | null {
    const ps = r.text?.paragraphs ?? [];
    for (let i = Math.min(ord, ps.length - 1); i >= 0; i--) if (ps[i].pageNumber != null) return ps[i].pageNumber;
    return null;
  }
  /** The page after the last one photographed (photographed books), or null when the book is complete. */
  function nextUnphotographed(): number | null {
    const nums = (r.text?.paragraphs ?? []).map((p) => p.pageNumber).filter((n): n is number => n != null);
    const next = (nums.length ? Math.max(...nums) : (book?.firstPage ?? 1) - 1) + 1;
    return book?.pageCount != null && next > book.pageCount ? null : next;
  }
  /**
   * Jump to another place in the book. Reading is in order by default; a jump ends the current run (what was read
   * so far still counts) and starts a fresh one at the new paragraph. Skipped pages aren't marked as read.
   */
  async function jumpTo(ord: number) {
    r.modal = null;
    r.look = null;
    if (!r.text || ord === r.pos) return bump();
    await leave();
    r.pos = Math.max(0, Math.min(ord, r.text.paragraphs.length - 1));
    const b = bookById(bookId);
    if (b) r.book = await saveBook({ ...b, position: { ...b.position, ord: r.pos, at: Date.now() } });
    startNewSession();
    bump();
  }

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
          <span className="num"><span className="label">{rankNow().rank}</span> +{r.xp} XP</span>
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
            <span className="num">{pageAt(r.pos) != null ? `p. ${pageAt(r.pos)} · ` : ""}{r.pos + 1} / {r.text!.paragraphs.length}</span>
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
                  className={`w ${t.k === "name" ? "name" : revealed.has(look(t.t).lemma) ? "rev" : ""} ${r.sel === i ? "sel" : ""}${tint(t)}`}
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
          <div className="actions turnrow">
            <button className="btn ghost prevbtn" type="button" disabled={r.pos === 0} onClick={() => lookBack("previous", r.pos - 1)}>← Previous</button>
            <button className="btn primary nextbtn" type="button" onClick={() => void turn()}>Next page →</button>
          </div>
        </article>
        <p className="note" style={{ margin: 0 }}>Tap a word to see its meaning. Swipe left or press → to turn the page; Previous looks back without penalty.</p>
      </>
    );
  }

  /**
   * Looking back or re-reading: where the strikes are, a banner says plainly that nothing here costs anything. Taps
   * show meanings only; the session (or its summary) waits until the reader goes back.
   */
  function renderLook() {
    const l = r.look!;
    const p = para();
    const back = l.kind === "reread" ? "Back to the summary" : "Back to where I was →";
    return (
      <>
        <section className="strip nopenalty" role="status" aria-label="No penalty">
          <span className="mode">{l.kind === "reread" ? "Practice" : "Looking back"}</span>
          <b>No strikes here.</b>
          <span>Tap any word for its meaning: nothing counts against you.</span>
        </section>
        <article className="sheet calm">
          <div className="folio">
            <span>{book!.title}</span>
            <span className="num">{pageAt(l.ord) != null ? `p. ${pageAt(l.ord)} · ` : ""}{l.ord + 1} / {r.text!.paragraphs.length}</span>
          </div>
          {mode === "match" && renderMatchedLine(p.matched)}
          <p className="para" lang="nl">
            {p.tokens.map((t, i) =>
              t.k === "punct" || t.k === "number" ? (
                <span key={i}>{t.t}</span>
              ) : (
                <button key={i} type="button" className={`w ${t.k === "name" ? "name" : ""} ${r.sel === i ? "sel" : ""}${tint(t)}`} onClick={() => tap(i)}>
                  {t.t}
                </button>
              ),
            )}
          </p>
          <div className="def" aria-live="polite">{renderDefinition(false)}</div>
          <div className="actions turnrow">
            {l.kind === "previous" && (
              <button className="btn ghost prevbtn" type="button" disabled={l.ord === 0} onClick={() => lookBack("previous", l.ord - 1)}>← Previous</button>
            )}
            <button className="btn primary nextbtn" type="button" onClick={endLook}>{back}</button>
          </div>
        </article>
      </>
    );
  }

  function renderMatchedLine(matched: boolean) {
    const m = r.matched.get(at());
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
    const rev = r.look ? undefined : r.session?.current?.reveals.find((x) => x.lemma === d.lemma);
    const canUndo = rev && Date.now() - rev.at <= r.session!.undoWindowMs;
    const m = d.meaning;
    const lifetime = wordbook[d.lemma]?.reveals ?? 0;
    const why = lang === "nl" ? (onStreak ? "Dutch explanation: you're on a streak." : "Dutch explanation from B1.") : "";
    const k = `${at()}|${r.sel}|${para().matched ? "m" : "o"}`;
    const x = r.explained.get(k);
    const lookup = r.lookups.get(d.lemma);
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
              {m.from === "translation" && (
                <>
                  <span className="note">Not in the dictionary: translated by Google Translate{m.shared ? ", shared by Boekenwurm readers" : ""}.</span>
                  <ReportTranslation key={d.lemma} word={m.word ?? tok.t} onReported={(text) => void reported(d.lemma, tok.t, text)} />
                </>
              )}
              {m.from === "compound" && <span className="note">Not in the dictionary as one word: its two parts.</span>}
              {m.from === "manual" && <span className="note">Your own meaning.</span>}
              {lang === "nl" && <span className="note">No Dutch explanation for this word yet, so here is the English.</span>}
            </>
          ) : null
        ) : lookup === "pending" ? (
          <span className="note" aria-live="polite">Not in the dictionary. Looking it up…</span>
        ) : lookup === "offline" ? (
          <span className="note">You're offline, so this word couldn't be looked up. This tap doesn't count; tap it again when you're back online.</span>
        ) : lookup === "limit" || lookup === "signin" ? (
          <LimitPrompt
            why={lookup}
            word={tok.t}
            hasKey={hasKey}
            onSave={(text) => void typedMeaning(r.sel!, d.lemma, tok.t, text)}
            onAddKey={() => setTab("me", "claude")}
            onSignIn={() => setTab("me", "account")}
          />
        ) : lookup === "none" && x?.status !== "done" ? (
          <>
            <span className="note">No meaning found for this word, so this tap doesn't count: no strike, and nothing to study.</span>
            <TypeMeaning word={tok.t} onSave={(text) => void typedMeaning(r.sel!, d.lemma, tok.t, text)} />
          </>
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
            ? atBookEnd ? (nextUnphotographed() == null ? "You've read the whole book. Gefeliciteerd!" : "You've read every page photographed so far.") : `You read to the end. ${plural(s.streakLength, "paragraph")} passed in a row.`
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
            nextUnphotographed() != null && (
              <button className="btn" type="button" onClick={() => open({ name: "photo", bookId })}>
                Photograph the next pages
              </button>
            )
          ) : (
            <button className="btn" type="button" onClick={() => (startNewSession(), bump())}>Keep reading</button>
          )}
          {r.lastRead != null && (
            <button className="btn ghost" type="button" onClick={() => lookBack("reread", r.lastRead!)}>Re-read the last paragraph</button>
          )}
        </div>
        {atBookEnd && nextUnphotographed() != null && (
          <div className="verdict">
            <b>Next section: up to {SECTION_SIZE} pages, from page {nextUnphotographed()}</b>
            <span className="small">Photograph them in order; each one slots into its place in the book.</span>
          </div>
        )}
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

  function renderGoto() {
    return (
      <GotoSheet
        paragraphs={r.text!.paragraphs}
        current={r.pos}
        isPhoto={book!.source === "photo"}
        noText={book!.pagesRead}
        onGo={(ord) => void jumpTo(ord)}
        onClose={() => ((r.modal = null), bump())}
        onPhotograph={() => open({ name: "photo", bookId })}
      />
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

/**
 * Google Translate can't be asked: today's 200 lookups are used up (they come back at midnight), or the reader isn't
 * signed in (the allowance belongs to an account). The reader can sign in, add their Claude key, or look the word
 * up themselves and type its meaning. Until then this tap stays free.
 */
function LimitPrompt({ why, word, hasKey, onSave, onAddKey, onSignIn }: {
  why: "limit" | "signin";
  word: string;
  hasKey: boolean;
  onSave: (text: string) => void;
  onAddKey: () => void;
  onSignIn: () => void;
}) {
  return (
    <div className="limit stack" style={{ gap: 8 }}>
      {why === "limit" ? (
        <span className="note">
          <b>You've used today's {DAILY_TRANSLATIONS} Google Translate lookups.</b> They come back at midnight. Until then this tap doesn't
          count, unless you add the meaning:
        </span>
      ) : (
        <span className="note">
          <b>Not in the dictionary.</b> Sign in to look words up with Google Translate ({DAILY_TRANSLATIONS} a day). Until then this tap
          doesn't count, unless you add the meaning:
        </span>
      )}
      <div className="actions">
        {why === "signin" && <button className="btn small primary" type="button" onClick={onSignIn}>Sign in</button>}
        {!hasKey && <button className="btn small" type="button" onClick={onAddKey}>Connect Claude</button>}
        <a className="btn small" href={`https://translate.google.com/?sl=nl&tl=en&op=translate&text=${encodeURIComponent(word)}`} target="_blank" rel="noopener noreferrer">
          Look it up ↗
        </a>
      </div>
      <TypeMeaning word={word} onSave={onSave} open />
    </div>
  );
}

/**
 * "Wrong translation?": the reader types what the word means here. Their meaning is used from then on, and the
 * shared translation is reported for the owner to review (three readers hide it from everyone).
 */
function ReportTranslation({ word, onReported }: { word: string; onReported: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  if (!open)
    return (
      <button className="btn small ghost" type="button" style={{ justifySelf: "start" }} onClick={() => setOpen(true)}>
        Wrong translation? Report it
      </button>
    );
  return (
    <form className="stack" style={{ gap: 6 }} onSubmit={(e) => (e.preventDefault(), onReported(text))}>
      <span className="note">What does “{word}” mean here? Your meaning is used for you from now on, and the translation is sent for review.</span>
      <div className="row">
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={300} placeholder="The right meaning" aria-label={`Right meaning of ${word}`} style={{ flex: 1, minWidth: 0 }} />
        <button className="btn small primary" type="submit" disabled={!text.trim()}>Report</button>
      </div>
    </form>
  );
}

/** Type a meaning for a word: saved to the reader's own words, so it's never looked up again. */
function TypeMeaning({ word, onSave, open = false }: { word: string; onSave: (text: string) => void; open?: boolean }) {
  const [shown, setShown] = useState(open);
  const [text, setText] = useState("");
  if (!shown)
    return (
      <button className="btn small ghost" type="button" style={{ justifySelf: "start" }} onClick={() => setShown(true)}>
        Know it? Type the meaning
      </button>
    );
  return (
    <form className="row" onSubmit={(e) => (e.preventDefault(), onSave(text))}>
      <input value={text} onChange={(e) => setText(e.target.value)} maxLength={300} placeholder={`What does “${word}” mean?`} aria-label={`Meaning of ${word}`} style={{ flex: 1, minWidth: 0 }} />
      <button className="btn small primary" type="submit" disabled={!text.trim()}>Save</button>
    </form>
  );
}

function GotoSheet({ paragraphs, current, onGo, onClose, onPhotograph, isPhoto, noText = [] }: {
  paragraphs: Paragraph[];
  current: number;
  /** Pages counted as read without text of their own (marked as a picture or map), so not missing. */
  noText?: number[];
  onGo: (ord: number) => void;
  onClose: () => void;
  onPhotograph: () => void;
  isPhoto: boolean;
}) {
  const nums = paragraphs.map((p) => p.pageNumber).filter((n): n is number => n != null);
  const byPage = nums.length > 0;
  const [value, setValue] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const min = byPage ? Math.min(...nums) : 1;
  const max = byPage ? Math.max(...nums) : paragraphs.length;
  const textless = new Set(noText.filter((n) => !nums.includes(n)));
  const pages = [...new Set([...nums, ...textless])].sort((a, b) => a - b);
  const missing: string[] = [];
  for (let i = 1; i < pages.length; i++) if (pages[i] - pages[i - 1] > 1) missing.push(pages[i] - pages[i - 1] === 2 ? `${pages[i - 1] + 1}` : `${pages[i - 1] + 1}–${pages[i] - 1}`);
  const go = () => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1) return setNote(byPage ? "Type a page number." : "Type a paragraph number.");
    if (!byPage) return n > paragraphs.length ? setNote(`This book has ${paragraphs.length} paragraphs.`) : onGo(n - 1);
    if (n > max) return setNote(`Page ${n} isn't ${isPhoto ? "photographed" : "in this book"} yet. The furthest page is ${max}.`);
    const i = paragraphs.findIndex((p) => p.pageNumber != null && p.pageNumber >= n);
    if (i < 0) return setNote(`Page ${n} isn't in this book.`);
    const landed = paragraphs[i].pageNumber!;
    // Said as a toast: the sheet closes with the jump.
    if (landed !== n) toast(textless.has(n) ? `Page ${n} has no text to read; going to page ${landed}.` : `Page ${n} isn't ${isPhoto ? "photographed" : "available"}; going to page ${landed}.`);
    onGo(i);
  };
  return (
    <Sheet label="Go to a page" onClose={onClose}>
      <h2 className="big" style={{ fontSize: "1.35rem" }}>{byPage ? "Go to a page" : "Go to a paragraph"}</h2>
      <p className="muted" style={{ margin: 0 }}>
        {byPage ? `This book has pages ${min}–${max}${isPhoto ? " photographed" : ""}.` : `This book has ${paragraphs.length} paragraphs; you're at ${current + 1}.`}
        {missing.length > 0 && ` Missing: page ${missing.join(", ")}.`} Reading carries on in order from wherever you go.
      </p>
      <form className="row" onSubmit={(e) => (e.preventDefault(), go())}>
        <input type="number" inputMode="numeric" min={1} value={value} onChange={(e) => (setValue(e.target.value), setNote(null))} placeholder={byPage ? "Page" : "Paragraph"} style={{ maxWidth: 140 }} aria-label={byPage ? "Page number" : "Paragraph number"} autoFocus />
        <button className="btn primary" type="submit">Go</button>
      </form>
      {note && <p className="small" style={{ margin: 0 }}>{note}</p>}
      <div className="actions">
        <button className="btn small" type="button" onClick={() => onGo(0)}>Back to the start</button>
        {isPhoto && <button className="btn small ghost" type="button" onClick={onPhotograph}>Photograph more pages</button>}
        <button className="btn small ghost" type="button" onClick={onClose}>Close</button>
      </div>
    </Sheet>
  );
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
