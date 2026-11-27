/**
 * The app gate's setup (docs/APP_GATE.md), at "/#gate-setup": the apps to gate, the review settings, the reader's own
 * cards, the iPhone Shortcuts to build, how often each app opened the gate, and deleting it all. English only.
 */
import { useState } from "react";
import { useStore } from "../lib/store.ts";
import { setTab } from "../nav.ts";
import { toast } from "../ui.tsx";
import * as R from "./rules.ts";
import * as D from "./decks.ts";
import {
  addCard, addDeck, countsFor, deleteGateData, importCards, leaveGate, removeCard, removeDeck, updateSettings, useGate, type GateApp,
} from "./state.ts";

const standalone = () =>
  typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);

export function GateSetup() {
  return (
    <main className="screen full gate-setup">
      <div className="topbar">
        <button className="back" type="button" onClick={leaveGate}>‹ Boekenwurm</button>
        <span className="grow" />
      </div>
      <h1 className="gate-title">App gate</h1>
      <p className="muted">
        Opening an app you chose (TikTok, Instagram…) sends you here first. A quick review unlocks it for{" "}
        {R.unlockMinutes("quick")} minutes, a deep review for an hour. Reading the next paragraph of your book and your due
        cards count. An experiment for the owner&apos;s own use.
      </p>
      {standalone() && (
        <p className="chip warn gate-chipline">
          You opened this from the home screen. Set the gate up in Safari instead: the Shortcut opens Safari, and Safari
          keeps its own copy of this page&apos;s data.
        </p>
      )}
      <div className="panels">
        <Account />
        <Apps />
        <Settings />
        <MyCards />
        <Shortcuts />
        <Stats />
        <PrivacyAndDelete />
      </div>
    </main>
  );
}

// ---------------------------------------------------------------- signed in?

function Account() {
  const user = useStore((s) => s.user);
  const books = useStore((s) => s.books.length);
  return (
    <section className="panel">
      <h2>Your books and words here</h2>
      {user ? (
        <p>Signed in{user.email ? ` as ${user.email}` : ""}: {books} {books === 1 ? "book" : "books"} on this page. Reading at the gate moves your place in the book, on every device.</p>
      ) : (
        <>
          <p>Sign in here in Safari once, so the gate reads the same books and reviews the same words as the app on your home screen.</p>
          <button className="btn small" type="button" onClick={() => (leaveGate(), setTab("me"))}>Sign in</button>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- the apps

function Apps() {
  const apps = useGate((d) => d.settings.apps);
  const [name, setName] = useState("");
  const [link, setLink] = useState("");
  const add = (a: GateApp) => {
    const n = a.name.replace(/[^\p{L}\p{N} .\-_&]/gu, "").replace(/\s+/g, " ").trim().slice(0, 40);
    if (!n) return;
    if (a.link && !R.safeAppLink(a.link)) return toast("That link doesn't look like an app's link (it should look like tiktok://).");
    void updateSettings((s) => ({ ...s, apps: [...s.apps.filter((x) => x.name.toLowerCase() !== n.toLowerCase()), { name: n, link: R.safeAppLink(a.link) }] }));
    setName("");
    setLink("");
  };
  const remove = (n: string) => void updateSettings((s) => ({ ...s, apps: s.apps.filter((x) => x.name !== n) }));
  const suggestions = R.KNOWN_APPS.filter((k) => !apps.some((a) => a.name.toLowerCase() === k.name.toLowerCase()));
  return (
    <section className="panel" id="gate-apps">
      <h2>Apps to gate</h2>
      <p>
        Each app needs its own automation on your iPhone (see below), with the same name as here. The link reopens the app
        after a review; without one, open it yourself.
      </p>
      {apps.length > 0 && (
        <ul className="gate-list">
          {apps.map((a) => (
            <li key={a.name}>
              <span className="grow"><b>{a.name}</b> <span className="muted small">{a.link ?? "no link"}</span></span>
              <button className="btn small ghost" type="button" onClick={() => remove(a.name)} aria-label={`Remove ${a.name}`}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      {suggestions.length > 0 && (
        <div className="row gate-suggest">
          {suggestions.map((k) => <button key={k.name} className="btn small" type="button" onClick={() => add(k)}>+ {k.name}</button>)}
        </div>
      )}
      <div className="gate-form">
        <label className="field"><span>Another app</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Tumblr" /></label>
        <label className="field"><span>Its link (optional)</span><input value={link} onChange={(e) => setLink(e.target.value)} placeholder="e.g. tumblr://" autoCapitalize="none" autoCorrect="off" /></label>
        <button className="btn small" type="button" disabled={!name.trim()} onClick={() => add({ name, link: link.trim() || null })}>Add</button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- the review

function Settings() {
  const s = useGate((d) => d.settings);
  const quick = R.clampQuickMinutes(s.quickMinutes);
  const set = (patch: Partial<typeof s>) => void updateSettings((x) => ({ ...x, ...patch }));
  const source = (k: keyof typeof s.sources, on: boolean) => void updateSettings((x) => ({ ...x, sources: { ...x.sources, [k]: on } }));
  return (
    <section className="panel">
      <h2>The review</h2>
      <div className="field">
        <span>Quick review: {quick} minutes → {R.unlockMinutes("quick")} minutes free</span>
        <div className="seg gate-seg">
          {Array.from({ length: R.QUICK_MINUTES.max - R.QUICK_MINUTES.min + 1 }, (_, i) => R.QUICK_MINUTES.min + i).map((m) => (
            <button key={m} type="button" aria-pressed={quick === m} onClick={() => set({ quickMinutes: m })}>{m}</button>
          ))}
        </div>
      </div>
      <p className="small">Deep review: {R.TIERS.deep.reviewMinutes} minutes → an hour free.</p>

      <div className="field">
        <span>What counts</span>
        <label className="gate-check"><input type="checkbox" checked={s.sources.reading} onChange={(e) => source("reading", e.target.checked)} /> The next paragraph of the book you read last</label>
        <label className="gate-check"><input type="checkbox" checked={s.sources.reviews} onChange={(e) => source("reviews", e.target.checked)} /> Your Boekenwurm flashcards (words you looked up)</label>
        <label className="gate-check"><input type="checkbox" checked={s.sources.myCards} onChange={(e) => source("myCards", e.target.checked)} /> My cards (below)</label>
      </div>

      <div className="field">
        <span>Reading rules</span>
        <label className="gate-check"><input type="radio" name="gate-rules" checked={s.reading === "unlimited"} onChange={() => set({ reading: "unlimited" })} /> Look up as many words as you like; each paragraph stays up for a short reading time</label>
        <label className="gate-check"><input type="radio" name="gate-rules" checked={s.reading === "boekenwurm"} onChange={() => set({ reading: "boekenwurm" })} /> Boekenwurm&apos;s fouten (stricter): a paragraph past its fouten doesn&apos;t count towards the time</label>
      </div>

      <label className="gate-check"><input type="checkbox" checked={s.multipleChoice} onChange={(e) => set({ multipleChoice: e.target.checked })} /> Show my cards as multiple choice (when a deck has at least 4 different answers)</label>
    </section>
  );
}

// ---------------------------------------------------------------- the reader's own cards

function MyCards() {
  const decks = useGate((d) => d.decks);
  const cards = useGate((d) => d.cards);
  const [open, setOpen] = useState<string | null>(null);
  const [name, setName] = useState("");
  const now = Date.now();
  return (
    <section className="panel" id="gate-cards">
      <h2>My cards</h2>
      <p>
        Cards on any subject, kept only on this device. Paste from Quizlet (Export → tab between term and definition,
        new line between cards), a spreadsheet, or type “front - back” per line.
      </p>
      {decks.length > 0 && (
        <ul className="gate-list">
          {decks.map((d) => {
            const mine = cards.filter((c) => c.deck === d.id);
            const due = D.dueCards(mine, now).length;
            return (
              <li key={d.id}>
                <button className="linklike grow" type="button" aria-expanded={open === d.id} onClick={() => setOpen(open === d.id ? null : d.id)}>
                  <b>{d.name}</b> <span className="muted small">{mine.length} cards · {due} due</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {open && decks.some((d) => d.id === open) && <DeckEditor deckId={open} onRemoved={() => setOpen(null)} />}
      <div className="gate-form">
        <label className="field"><span>New deck</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Grammar, Capitals, Exam terms" /></label>
        <button className="btn small" type="button" disabled={!name.trim()} onClick={() => void addDeck(name).then((d) => (setName(""), d && setOpen(d.id)))}>Add deck</button>
      </div>
    </section>
  );
}

function DeckEditor({ deckId, onRemoved }: { deckId: string; onRemoved: () => void }) {
  const deck = useGate((d) => d.decks.find((x) => x.id === deckId));
  const cards = useGate((d) => d.cards);
  const mine = cards.filter((c) => c.deck === deckId);
  const [paste, setPaste] = useState("");
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [confirm, setConfirm] = useState(false);
  const found = D.parseCards(paste).length;
  if (!deck) return null;
  return (
    <div className="gate-deck">
      <label className="field">
        <span>Paste cards into “{deck.name}”</span>
        <textarea value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={"de hond\tthe dog\nhet huis - the house"} />
      </label>
      <button className="btn small" type="button" disabled={!found}
        onClick={() => void importCards(deckId, paste).then((n) => (toast(n ? `${n} ${n === 1 ? "card" : "cards"} added.` : "Those cards are already in the deck."), setPaste("")))}>
        {found ? `Add ${found} ${found === 1 ? "card" : "cards"}` : "Add cards"}
      </button>
      <div className="gate-form">
        <label className="field"><span>Front</span><input value={front} onChange={(e) => setFront(e.target.value)} /></label>
        <label className="field"><span>Back</span><input value={back} onChange={(e) => setBack(e.target.value)} /></label>
        <button className="btn small" type="button" disabled={!front.trim() || !back.trim()}
          onClick={() => void addCard(deckId, front, back).then((ok) => (ok ? (setFront(""), setBack("")) : toast("That card is already in the deck.")))}>Add card</button>
      </div>
      {mine.length > 0 && (
        <ul className="gate-list gate-cardlist">
          {mine.slice(0, 200).map((c) => (
            <li key={c.id}>
              <span className="grow"><b>{c.front}</b> <span className="muted">· {c.back}</span></span>
              <button className="btn small ghost" type="button" onClick={() => void removeCard(c.id)} aria-label={`Delete ${c.front}`}>Delete</button>
            </li>
          ))}
          {mine.length > 200 && <li className="muted small">… and {mine.length - 200} more</li>}
        </ul>
      )}
      {confirm ? (
        <div className="row"><span className="small grow">Delete “{deck.name}” and its {mine.length} cards?</span>
          <button className="btn small danger" type="button" onClick={() => void removeDeck(deckId).then(onRemoved)}>Delete deck</button>
          <button className="btn small ghost" type="button" onClick={() => setConfirm(false)}>Keep</button>
        </div>
      ) : (
        <button className="btn small ghost" type="button" onClick={() => setConfirm(true)}>Delete this deck</button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- the iPhone side

function Copy({ text }: { text: string }) {
  return (
    <span className="gate-copy">
      <code>{text}</code>
      <button className="btn small ghost" type="button" onClick={() => void navigator.clipboard?.writeText(text).then(() => toast("Copied."), () => toast("Copy it by hand."))}>Copy</button>
    </span>
  );
}

function Shortcuts() {
  const gateUrl = R.gatePageUrl(location.origin);
  const example = useGate((d) => d.settings.apps[0]?.name ?? "TikTok");
  return (
    <section className="panel" id="gate-shortcuts">
      <h2>Set up your iPhone</h2>
      <p>
        Two Shortcuts and one automation per app, in Apple&apos;s Shortcuts app. They keep the unlock time in a file in
        your own iCloud Drive; Boekenwurm never sees it. Menus move a little between iOS versions: the names below are
        what to search for.
      </p>

      <details className="gate-steps" open>
        <summary><b>0.</b> Make a folder</summary>
        <p>In the Files app: iCloud Drive → <b>Shortcuts</b> → new folder <b>Boekenwurm</b>.</p>
      </details>

      <details className="gate-steps">
        <summary><b>1.</b> Shortcut “{R.SHORTCUT_UNLOCK}”</summary>
        <p className="small">Run by this page after a review. It receives text like <code>15|tiktok://</code>: minutes, then the app&apos;s link.</p>
        <ol>
          <li>New shortcut, named exactly <Copy text={R.SHORTCUT_UNLOCK} /></li>
          <li><b>Split Text</b>: Shortcut Input, by <b>Custom</b> <code>|</code> (set it to receive <b>Text</b> if asked).</li>
          <li><b>Get Item from List</b>: <b>First Item</b> of Split Text.</li>
          <li><b>Adjust Date</b>: <b>Add</b> [Item from List] <b>minutes</b> to <b>Current Date</b>.</li>
          <li><b>Format Date</b>: Adjusted Date, format <b>ISO 8601</b>, with the time.</li>
          <li><b>Save File</b>: Formatted Date, to <b>Shortcuts</b>, subpath <Copy text="Boekenwurm/unlocked-until.txt" />, <b>Ask Where to Save</b> off, <b>Overwrite If File Exists</b> on.</li>
          <li><b>Get Item from List</b>: <b>Last Item</b> of Split Text.</li>
          <li><b>If</b> [Item from List] <b>has any value</b>: <b>Open URLs</b> [Item from List]. End If.</li>
        </ol>
      </details>

      <details className="gate-steps">
        <summary><b>2.</b> Shortcut “{R.SHORTCUT_GATE}”</summary>
        <p className="small">Run every time a gated app opens. It lets you through while the unlock lasts, otherwise opens this page.</p>
        <ol>
          <li>New shortcut, named exactly <Copy text={R.SHORTCUT_GATE} /></li>
          <li><b>Get File from Folder</b>: <b>Shortcuts</b>, path <Copy text="Boekenwurm/unlocked-until.txt" />, <b>Error If Not Found</b> off.</li>
          <li><b>Get Dates from Input</b>: File.</li>
          <li><b>If</b> [Dates] <b>is after</b> <b>Current Date</b>: <b>Stop This Shortcut</b>. End If.</li>
          <li><b>URL Encode</b>: Shortcut Input (set it to receive <b>Text</b> if asked).</li>
          <li><b>Open URLs</b>: <Copy text={gateUrl} /> followed by the <b>URL Encoded Text</b> variable, in the same field.</li>
        </ol>
      </details>

      <details className="gate-steps">
        <summary><b>3.</b> One automation per app</summary>
        <ol>
          <li>Shortcuts → <b>Automation</b> → <b>+</b> → <b>App</b> → choose the app (e.g. {example}) → <b>Is Opened</b> → <b>Run Immediately</b> → Next.</li>
          <li>New blank automation: add <b>Text</b> with the app&apos;s name exactly as in “Apps to gate”, e.g. <code>{example}</code>.</li>
          <li>Add <b>Run Shortcut</b> → {R.SHORTCUT_GATE}, with the Text as its input.</li>
          <li>Turn off <b>Notify When Run</b>.</li>
        </ol>
      </details>

      <div className="row">
        <button className="btn small" type="button" onClick={() => (location.hash = `#gate=${encodeURIComponent(example)}`)}>Try the gate</button>
        <a className="btn small ghost" href={R.unlockUrl(1)}>Test Unlock (1 minute)</a>
        <a className="btn small ghost" href={R.unlockUrl(0)}>Lock again now</a>
      </div>
      <p className="note">
        This is the soft version: turning an automation off gets round it, as with one sec. A hard block needs Apple&apos;s
        Screen Time permission and a native app, for later.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------- how often

function Stats() {
  const log = useGate((d) => d.log);
  const apps = R.appsInLog(log);
  return (
    <section className="panel">
      <h2>How often the gate opened</h2>
      {!apps.length ? <p>Nothing yet.</p> : (
        <div className="tablewrap">
          <table className="gate-table">
            <thead><tr><th>App</th><th>Today</th><th>7 days</th><th>30 days</th></tr></thead>
            <tbody>
              {apps.map((a) => {
                const cell = (days: number) => {
                  const c = countsFor(a, days);
                  return <td>{c.shown}<span className="muted small"> · {c.passed} unlocked</span></td>;
                };
                return <tr key={a}><td><b>{a}</b></td>{cell(1)}{cell(7)}{cell(R.KEEP_DAYS)}</tr>;
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="note">Counted on this device only, and forgotten after {R.KEEP_DAYS} days.</p>
    </section>
  );
}

// ---------------------------------------------------------------- privacy

function PrivacyAndDelete() {
  const [confirm, setConfirm] = useState(false);
  return (
    <section className="panel">
      <h2>What the gate keeps</h2>
      <ul className="small">
        <li><b>Only on this device:</b> the apps you gate, how often each one opened the gate (last {R.KEEP_DAYS} days), these settings and your own cards. Never synced or sent anywhere.</li>
        <li>The app&apos;s name reaches this page after “#” in the address, which browsers don&apos;t send to a server.</li>
        <li>The unlock time is in your own iCloud Drive, kept by your Shortcut.</li>
        <li>Paragraphs read and Boekenwurm flashcards answered at the gate count like any reading and review, with your other progress.</li>
      </ul>
      {confirm ? (
        <div className="row">
          <span className="small grow">Delete the gate&apos;s apps, counts, settings and your own cards from this device?</span>
          <button className="btn small danger" type="button" onClick={() => void deleteGateData().then(() => (setConfirm(false), toast("App gate data deleted from this device.")))}>Delete</button>
          <button className="btn small ghost" type="button" onClick={() => setConfirm(false)}>Keep</button>
        </div>
      ) : (
        <button className="btn small danger" type="button" onClick={() => setConfirm(true)}>Delete all app gate data</button>
      )}
    </section>
  );
}
