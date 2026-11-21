/**
 * The Hex-bound Collector: the secret Mörk Borg game mode (lib/hexbound.ts, docs/HEXBOUND.md). While it is open the
 * app shows nothing else. English only, for now.
 *
 * intro (black and yellow: the backstory and the class) → journey (the blank book) → turn (a random page to read,
 * tapping the words you don't know) → recap (blessed or cursed) → next turn … until the character dies.
 */
import { useEffect, useRef, useState } from "react";
import * as E from "@boekenwurm/engine";
import { bookById, getState, recordFinished, saveMeaning, useStore } from "../lib/store.ts";
import { anyPageLeft, bookText, die, endTurn, nextTurn, toJourney, type GameState, type TurnWord } from "../lib/hexbound.ts";
import { compoundMeaning, lookup } from "../lib/words.ts";
import { translateWord, type TranslateResult } from "../lib/translate.ts";
import { sentenceAround } from "../lib/text.ts";
import type { Meaning, Paragraph } from "../lib/types.ts";
import { WordPopover } from "./Reader.tsx";

export function Hexbound() {
  const game = useStore((s) => s.game)!;
  useEffect(() => {
    document.documentElement.dataset.game = game.phase === "intro" ? "intro" : "borg";
    window.scrollTo(0, 0);
    return () => void delete document.documentElement.dataset.game;
  }, [game.phase]);
  return (
    <div className="hexbound" lang="en" dir="ltr">
      {game.phase === "intro" ? <Intro /> : game.phase === "nobook" ? <NoBook /> : <Book game={game} />}
    </div>
  );
}

// ---------------------------------------------------------------- the backstory and the class

function Intro() {
  const [busy, setBusy] = useState(false);
  return (
    <main className="hb-intro">
      <h1>Hex-bound Collector</h1>
      <p className="hb-lede">Has it been months? Years? Hard to say.</p>
      <p>
        When the world still seemed to work, you collected books, tomes, maps and scrolls. As the sky darkened and
        blood-curdling screams echoed through the town, as the very world those books described lay in ruin, you hid in
        your shop. Luck was not on your side. One day you had to rest, to finally close your eyes. You woke to the heat of
        fire and the smell of ash and mould, and watched your glorious collection burn before your eyes. No one came to
        put out the fire. Not one book could be saved. You fought to stop it spreading, but now, kneeling in the ashes,
        you see there is nothing left but charred timber and ash.
      </p>
      <p>
        You wept, you cursed, and you combed through the ruins for even one trace of your treasures. And as you dug, a
        customer appeared. It had been years since anyone had entered your shop, long boarded up and hidden away, yet
        still smouldering in your heart, like the ruins around you, was the longing for one reminder of the past. The dark
        figure handed you a book. Feverishly you took it, aching to pore over its pages. It was beautiful, pristine, and
        yet something about it was wrong.
      </p>
      <p>
        You opened your mouth to say that surely you could not afford it. A haunting voice trickled from the strange
        figure: <i>“I have no need for your silver. Your life will be payment enough.”</i> With that, they vanished.
        Curious, you open the book. Its pages are blank, but as you turn them, a magic ink sometimes appears, for better or
        for worse.
      </p>
      <p>
        The cursed book is bound to you. If you can read its cryptic text, it blesses you; if you cannot, it curses you.
        Every turn you must read from it. Understand the words before you and you gain <b>+2</b> on your rolls that turn.
        Fail, and you suffer <b>−2</b> and take <b>2 damage</b>. Don’t worry: it won’t be long before you pay it off.
      </p>

      <section className="hb-block" aria-label="The class">
        <h2>The Hex-bound Collector</h2>
        <p>Begins with <b>1d4 × 10s</b> and <b>d2 Omens</b>. HP: <b>Toughness + d6</b>.</p>
        <p><b>A lifetime of reading:</b> 3d6+2 for Presence. <b>A shop-keeper’s arms:</b> 3d6−2 for Strength.</p>
        <h3>The Hexed Book</h3>
        <p>
          Bound to you. It must be in your inventory or you die instantly. It fills one of your two starting-equipment
          rolls for good and counts as one item you carry. For the other, roll <b>d2</b> for the table (1: Starting
          gear I, 2: Starting gear II), then <b>d12</b> on it.
        </p>
        <h3>The scroll</h3>
        <p>
          A single scroll tumbled out of the book. Choose sacred or unclean, or roll <b>d2</b> (1: unclean, 2: sacred),
          then <b>d10</b> on that table. Because you begin with a scroll, your weapon is <b>d6</b> instead of d10 and your
          armor <b>d2</b> instead of d4.
        </p>
        <h3>Reading the book</h3>
        <p>
          Every time you are given your turn, in combat or out of it, read from the book first. Reading uses no action; it
          decides how your action goes. <b>Understood:</b> +2 on every roll this turn. <b>Not understood:</b> −2 on every
          roll this turn, and 2 damage. No Omen can change what the book says: read like your life depends on it. The GM
          decides what counts as a scene, and may ask you to read aloud and tell the group what it meant.
        </p>
        <Table title="Before the fire, your shop was… (d6)" rows={SHOP} />
        <Table title="What you saved from the ashes (d6)" rows={SAVED} />
      </section>

      <p className="hb-note">
        In the app: each turn opens a random page you haven’t read, from one of your books above your reading level. Tap
        the words you don’t know. The fouten start at a quarter of the page and shrink every turn, whether you pass or
        fail.
      </p>
      <button className="hb-btn hb-take" type="button" disabled={busy}
        onClick={async () => (setBusy(true), (await anyPageLeft()) ? await toJourney() : await nextTurn())}>
        {busy ? "The pages stir…" : "Take up the book"}
      </button>
    </main>
  );
}

const SHOP = [
  "A cellar beneath a Galgenbeck pawnbroker’s, entered through a coffin lid.",
  "A narrow house in Grift that leaned on its neighbours like a drunk.",
  "A cart of crates trailing the armies of Wästland, selling maps of places already burned.",
  "A tower room in Sarkash, rented from a bishop who never asked what you sold.",
  "The back of a printing press in Bergen Chrypt, where the ink never quite dried.",
  "Nowhere. You carried every book on your back, until the night you set them down.",
];
const SAVED = [
  "A charred bookmark that still smells of your shop. Worthless to anyone but you.",
  "Spectacles with one cracked lens. While you wear them, Presence tests to make out fine detail are DR10.",
  "A brass key to a door that no longer exists.",
  "Half a burnt map. When you are lost, roll d6: on a 6 it shows a way out.",
  "An inkwell that is never empty. The ink is not always black.",
  "The ledger of everyone who owes you money. Most of them are dead.",
];

function Table({ title, rows }: { title: string; rows: string[] }) {
  return (
    <>
      <h3>{title}</h3>
      <ol className="hb-table">{rows.map((r) => <li key={r}>{r}</li>)}</ol>
    </>
  );
}

// ---------------------------------------------------------------- no book: the character dies

function NoBook() {
  return (
    <main className="hb-page hb-dead">
      <h1>The book stays blank</h1>
      <p>
        No ink rises from its pages. The bargain was your life, and the book has come to collect. <b>Your Hex-bound
        Collector is dead.</b>
      </p>
      <h2>What the book needs</h2>
      <ul>
        <li>A <b>Dutch book</b> added to Boekenwurm: an EPUB without copy protection, a PDF with text in it, or a book you photographed.</li>
        <li>Its <b>level</b> must be at least <b>one above your reading level</b> (the same level is enough from B2 up). Set a book’s level with its ••• button on Home.</li>
        <li>It must have <b>pages you haven’t read yet</b>, with paragraphs of <b>more than 20 words</b>. Pages before your place in the book count as read.</li>
      </ul>
      <p>Add such a book, then roll a new character: enter the code again under Account → Experimental → Access code.</p>
      <button className="hb-btn" type="button" onClick={() => void die()}>Return to the living</button>
    </main>
  );
}

// ---------------------------------------------------------------- the book: journey, turn and recap

function Book({ game }: { game: GameState }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <main className="hb-page">
      <header className="hb-bar">
        <span className="hb-turn">{game.phase === "journey" ? "The hexed book" : `Turn ${game.turn + (game.phase === "turn" ? 1 : 0)}`}</span>
        {confirm ? (
          <span className="hb-confirm">
            Your character is dead? <button type="button" onClick={() => void die()}>Yes, dead</button>
            <button type="button" onClick={() => setConfirm(false)}>No</button>
          </span>
        ) : (
          <button className="hb-deadbtn" type="button" onClick={() => setConfirm(true)}>Dead, exit game mode ›</button>
        )}
      </header>
      {game.phase === "journey" ? <Blank /> : game.phase === "turn" && game.current ? <Turn key={`${game.current.bookId}:${game.current.ord}`} game={game} /> : game.phase === "recap" ? <Recap game={game} /> : <Blank />}
    </main>
  );
}

function Blank() {
  const [busy, setBusy] = useState(false);
  return (
    <>
      <article className="hb-sheet hb-blank" aria-label="A blank page">
        <p>The pages are blank. For now.</p>
      </article>
      <button className="hb-btn" type="button" disabled={busy} onClick={() => (setBusy(true), void nextTurn())}>
        {busy ? "The ink rises…" : "Begin my journey"}
      </button>
    </>
  );
}

type Found = Meaning | "pending" | "none" | "signin" | "limit" | "offline";

function Turn({ game }: { game: GameState }) {
  const { bookId, ord } = game.current!;
  const [para, setPara] = useState<Paragraph | null>(null);
  const [session, setSession] = useState<E.Session | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [found, setFound] = useState<Record<string, Found>>({});
  const [busy, setBusy] = useState(false);
  const sentences = useRef<Record<string, string>>({});
  const wrap = useRef<HTMLDivElement>(null);
  const look = (surface: string) => lookup(surface, { meanings: getState().meanings });

  useEffect(() => {
    void (async () => {
      const b = bookById(bookId);
      const p = b ? (await bookText(b))?.[ord] : undefined;
      if (!p) return void nextTurn(); // the book went away: another page
      setPara(p);
      // Every turn tightens the fouten, passed or failed: the session starts as if `turn` pages had passed.
      const s: E.Session = { ...E.startSession(E.HEXBOUND_RULES, { tokenAtStreak: Number.MAX_SAFE_INTEGER }), passesInARow: game.turn };
      setSession(E.beginParagraph(s, `hb-${bookId}-${ord}`, p.tokens.filter((t) => t.k === "word").map((t) => look(t.t).lemma)));
    })();
  }, [bookId, ord, game.turn]);

  if (!para || !session?.current) return <article className="hb-sheet"><span className="spinner" /></article>;
  const st = E.status(session);

  const count = (lemma: string, surface: string) =>
    setSession((s) => {
      if (!s?.current) return s;
      sentences.current[lemma] ??= sentenceAround(para.text, surface);
      return E.reveal(s, { lemma, surface, at: Date.now() });
    });

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
    } else setFound((f) => ({ ...f, [d.lemma]: !t.ok && (t.reason === "signin" || t.reason === "limit") ? t.reason : !t.ok && t.reason === "offline" ? "offline" : "none" }));
  };

  const close = async () => {
    setBusy(true);
    const out = E.turnPage(session);
    const book = bookById(bookId);
    let words: TurnWord[] = [];
    if (book) {
      // The words join the word book and the reviews, like any reading; nothing else is recorded.
      const { list } = await recordFinished({ session: out.session, book, startedAt: Date.now(), endedBy: "left", sentences: sentences.current, game: true });
      words = list.filter((w) => w.sessionReveals > 0).map((w) => {
        const m = lookup(w.forms[0], { meanings: getState().meanings }).meaning;
        return { lemma: w.lemma, forms: w.forms, meaning: m?.en ?? m?.nl ?? null };
      });
    }
    const result = out.session.results[out.session.results.length - 1];
    await endTurn({ passed: result?.passed ?? out.kind === "continue", revealed: result?.revealed ?? st.used, allowed: result?.allowed ?? st.allowed, words });
  };

  const tok = sel != null ? para.tokens[sel] : null;
  const d = tok && tok.k === "word" ? look(tok.t) : null;
  const f = d ? found[d.lemma] : undefined;
  const meaning = d?.meaning ?? (f && typeof f === "object" ? f : null);

  return (
    <>
      <div className="hb-strip" role="status">
        <span className="hb-fouten">{st.used} of {st.allowed} {st.allowed === 1 ? "fout" : "fouten"}</span>
        {st.used >= st.allowed && <span className="hb-warn">One more word and the book curses you.</span>}
      </div>
      <article className="hb-sheet">
        <div className="parawrap" ref={wrap}>
          <p className="para hb-para" lang="nl" dir="ltr">
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
                {tok.k === "name" ? <span className="note">A name. It costs nothing.</span>
                  : meaning ? <div className="meaning" lang="en">{meaning.en ?? meaning.nl}</div>
                  : f === "pending" ? <span className="note">The ink stirs…</span>
                  : f === "signin" ? <span className="note">Not in the dictionary. Sign in to look words up; this tap costs nothing.</span>
                  : f === "limit" ? <span className="note">Today’s lookups are used up; this tap costs nothing.</span>
                  : f === "offline" ? <span className="note">You’re offline; this tap costs nothing. Tap again when you’re back.</span>
                  : <span className="note">No meaning found; this tap costs nothing.</span>}
              </div>
            </WordPopover>
          )}
        </div>
      </article>
      <button className="hb-btn" type="button" disabled={busy} onClick={() => void close()}>Close the book</button>
    </>
  );
}

function Recap({ game }: { game: GameState }) {
  const r = game.recap!;
  const [busy, setBusy] = useState(false);
  return (
    <section className={`hb-recap ${r.passed ? "hb-blessed" : "hb-cursed"}`}>
      {r.passed ? (
        <>
          <h1>The ink obeys</h1>
          <p>You understood the cursed book. <b>+2 on every roll this turn.</b></p>
        </>
      ) : (
        <>
          <h1>You failed to read the cursed book</h1>
          <p>Take <b>2 damage</b>, and <b>−2 on all rolls this turn.</b></p>
        </>
      )}
      <p className="hb-small">{r.revealed > r.allowed
          ? `${r.revealed} words looked up; the book allowed ${r.allowed}.`
          : `${r.revealed} of ${r.allowed} ${r.allowed === 1 ? "fout" : "fouten"} used.`}{" "}
        The next page will forgive less.</p>
      {r.words.length > 0 ? (
        <div className="tablewrap">
          <table>
            <thead><tr><th>Word</th><th>Meaning</th></tr></thead>
            <tbody>
              {r.words.map((w) => (
                <tr key={w.lemma}><td lang="nl"><b>{w.lemma}</b>{w.forms.some((x) => x !== w.lemma) && <div className="forms">{w.forms.join(", ")}</div>}</td><td>{w.meaning ?? "—"}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="hb-small">You revealed no words.</p>}
      <div className="hb-actions">
        <button className="hb-btn" type="button" disabled={busy} onClick={() => (setBusy(true), void nextTurn())}>Next turn</button>
        <button className="hb-btn hb-ghost" type="button" onClick={() => void die()}>I died</button>
      </div>
    </section>
  );
}
