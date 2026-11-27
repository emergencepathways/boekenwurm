/**
 * The app gate's setup (docs/APP_GATE.md), at "/#gate-setup": the apps to gate, the review settings, the reader's own
 * cards, the iPhone Shortcuts to build, how often each app opened the gate, and deleting it all. English only.
 */
import { useEffect, useState } from "react";
import { useStore } from "../lib/store.ts";
import { ADMIN } from "../lib/features.ts";
import { setTab } from "../nav.ts";
import { toast } from "../ui.tsx";
import * as R from "./rules.ts";
import * as D from "./decks.ts";
import {
  addCard, addDeck, cameFromTest, countsFor, deleteGateData, importCards, leaveGate, removeCard, removeDeck, resetCheck, updateSettings, useGate, type GateApp,
} from "./state.ts";

const standalone = () =>
  typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);

export function GateSetup() {
  const verified = useGate((d) => d.check.verifiedAt != null);
  const [view, setView] = useState<"setup" | "settings" | null>(null);
  const shown = view ?? (verified && !cameFromTest() ? "settings" : "setup");
  return (
    <main className="screen full gate-setup">
      <div className="topbar">
        <button className="back" type="button" onClick={leaveGate}>‹ Boekenwurm</button>
        <span className="grow" />
      </div>
      <h1 className="gate-title">App gate</h1>
      <p className="muted">
        Opening an app you choose (TikTok, Instagram…) brings you here first. A few minutes of reading and cards unlock
        it: {R.unlockMinutes("quick")} minutes after a quick review, an hour after a deep one.
      </p>
      <Status />
      <div className="seg gate-views" role="tablist">
        <button type="button" role="tab" aria-selected={shown === "setup"} aria-pressed={shown === "setup"} onClick={() => setView("setup")}>Set up</button>
        <button type="button" role="tab" aria-selected={shown === "settings"} aria-pressed={shown === "settings"} onClick={() => setView("settings")}>Settings</button>
      </div>
      {shown === "setup" ? (
        <Wizard onDone={() => setView("settings")} />
      ) : (
        <div className="panels">
          <Apps />
          <Settings />
          <MyCards />
          <Stats />
          <PrivacyAndDelete />
        </div>
      )}
    </main>
  );
}

// ---------------------------------------------------------------- does it work?

function ago(t: number): string {
  const m = Math.round((Date.now() - t) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

function Status() {
  const check = useGate((d) => d.check);
  const apps = useGate((d) => d.settings.apps.length);
  if (check.verifiedAt == null && check.lastArrival == null) return null;
  return (
    <p className={`gate-status ${check.verifiedAt != null ? "ok" : ""}`} role="status">
      {check.verifiedAt != null ? <><b>✓ Working.</b> The Shortcut answered the test {ago(check.verifiedAt)}.</> : <b>Not tested yet.</b>}
      {check.lastArrival != null && <> Last sent here by an app {ago(check.lastArrival)}.</>}
      {apps === 0 && <> No apps chosen yet.</>}
    </p>
  );
}

// ---------------------------------------------------------------- the wizard

const STEPS = ["Safari", "Apps", "Shortcut", "Test"] as const;

function Wizard({ onDone }: { onDone: () => void }) {
  const verified = useGate((d) => d.check.verifiedAt != null);
  // Back from the Shortcut's test: straight to "It works", also when Safari opened a new tab (the gate's data loads
  // a moment after the page).
  const [step, setStep] = useState(verified || cameFromTest() ? 3 : 0);
  useEffect(() => {
    if (verified && cameFromTest()) setStep(3);
  }, [verified]);
  const go = (n: number) => (setStep(n), window.scrollTo(0, 0));
  return (
    <section className="gate-wizard" aria-label="Set up the app gate">
      <ol className="gate-stepper">
        {STEPS.map((label, i) => (
          <li key={label} aria-current={step === i ? "step" : undefined} className={i < step ? "done" : ""}>
            <button type="button" onClick={() => go(i)}><span>{i + 1}</span>{label}</button>
          </li>
        ))}
      </ol>
      {step === 0 && <StepSafari onNext={() => go(1)} />}
      {step === 1 && <StepApps onNext={() => go(2)} />}
      {step === 2 && <StepShortcut onNext={() => go(3)} />}
      {step === 3 && <StepTest onDone={onDone} />}
    </section>
  );
}

function StepSafari({ onNext }: { onNext: () => void }) {
  const user = useStore((s) => s.user);
  const books = useStore((s) => s.books.length);
  return (
    <div className="panel gate-step">
      <h2>Use Safari, and sign in</h2>
      {standalone() ? (
        <p className="chip warn gate-chipline">
          This is the app from your home screen. Open <b>{location.host}/#gate-setup</b> in <b>Safari</b> instead: the
          Shortcut opens Safari, and Safari keeps its own copy of Boekenwurm.
        </p>
      ) : (
        <p>✓ You’re in the browser. Apps you gate will open Boekenwurm here.</p>
      )}
      {user ? (
        <p>✓ Signed in{user.email ? ` as ${user.email}` : ""}, with {books} {books === 1 ? "book" : "books"}: the gate reads and reviews the same ones as the app.</p>
      ) : (
        <>
          <p>Sign in so the gate has your books and words. Without it, the gate still works with your own cards.</p>
          <button className="btn small" type="button" onClick={() => (leaveGate(), setTab("me"))}>Sign in</button>
        </>
      )}
      <button className="btn primary block" type="button" onClick={onNext}>Next: choose apps</button>
    </div>
  );
}

function StepApps({ onNext }: { onNext: () => void }) {
  const apps = useGate((d) => d.settings.apps);
  const on = (name: string) => apps.some((a) => a.name.toLowerCase() === name.toLowerCase());
  const toggle = (k: GateApp) =>
    void updateSettings((s) => ({ ...s, apps: on(k.name) ? s.apps.filter((a) => a.name.toLowerCase() !== k.name.toLowerCase()) : [...s.apps, k] }));
  const custom = apps.filter((a) => !R.KNOWN_APPS.some((k) => k.name.toLowerCase() === a.name.toLowerCase()));
  return (
    <div className="panel gate-step">
      <h2>Which apps?</h2>
      <p>Tap the ones to gate. You’ll tick the same apps once more in Apple’s screen in the next step.</p>
      <div className="gate-appgrid" role="group" aria-label="Apps to gate">
        {[...R.KNOWN_APPS, ...custom].map((k) => (
          <button key={k.name} type="button" aria-pressed={on(k.name)} onClick={() => toggle(k)}>{on(k.name) ? "✓ " : ""}{k.name}</button>
        ))}
      </div>
      <details>
        <summary className="small">Another app</summary>
        <AddApp />
      </details>
      <button className="btn primary block" type="button" disabled={!apps.length} onClick={onNext}>
        {apps.length ? `Next: add the Shortcut (${apps.length} ${apps.length === 1 ? "app" : "apps"})` : "Choose at least one app"}
      </button>
    </div>
  );
}

function StepShortcut({ onNext }: { onNext: () => void }) {
  const setup = useGate((d) => d.settings.shortcut);
  const owner = useStore((s) => s.features.includes(ADMIN));
  const setSetup = (shortcut: R.ShortcutSetup) => void updateSettings((s) => ({ ...s, shortcut }));
  if (setup === "pair")
    return (
      <div className="panel gate-step">
        <h2>Build the Shortcuts by hand</h2>
        <p>For iPhones on iOS 26 or older, which can’t add automations from a link.</p>
        <LegacyGuide />
        <button className="btn primary block" type="button" onClick={onNext}>Next: test it</button>
        <button className="linklike small" type="button" onClick={() => setSetup("single")}>My iPhone has iOS 27 or later</button>
      </div>
    );
  return (
    <div className="panel gate-step">
      <h2>Add the Shortcut</h2>
      {R.SHARED_SHORTCUT_URL ? (
        <>
          <a className="btn primary block" href={R.SHARED_SHORTCUT_URL}>Add to Shortcuts</a>
          <ol className="gate-howto">
            <li>Apple’s Shortcuts screen opens. In the set-up questions, <b>tick your apps</b> (the same ones).</li>
            <li>Make sure <b>the automation is turned on</b>, then tap <b>Add Shortcut</b>.</li>
            <li>Come back here to Safari.</li>
          </ol>
          <p className="note">
            If “Add Shortcut” doesn’t respond (a known iOS 27 bug), tap <b>Skip Setup</b>, then open the new shortcut
            and turn its automation on.
          </p>
        </>
      ) : (
        <>
          <p>
            The ready-made Shortcut isn’t shared yet.{" "}
            {owner ? "Build it once with the recipe below and share its iCloud link; after that, setting up is one tap." : "Ask the app owner for its link."}
          </p>
          {owner && <BuildRecipe />}
        </>
      )}
      <p className="note">
        Built “{R.SHORTCUT_GATE}” and “{R.SHORTCUT_UNLOCK}” by hand before? Delete both, and their automations, first:
        otherwise the new one is renamed “{R.SHORTCUT_GATE} 1” and this page can’t find it.
      </p>
      <button className="btn block" type="button" onClick={onNext}>I added it: test it</button>
      <button className="linklike small" type="button" onClick={() => setSetup("pair")}>My iPhone has iOS 26 or older</button>
    </div>
  );
}

function StepTest({ onDone }: { onDone: () => void }) {
  const check = useGate((d) => d.check);
  const setup = useGate((d) => d.settings.shortcut);
  const first = useGate((d) => d.settings.apps[0]?.name ?? "TikTok");
  if (check.verifiedAt != null)
    return (
      <div className="panel gate-step gate-success">
        <h2>✓ It works</h2>
        <p>
          The Shortcut answered. Open {first} to see the gate. Everything else (review length, reading rules, your own
          cards) has sensible defaults; change them any time under Settings.
        </p>
        <button className="btn primary block" type="button" onClick={onDone}>Done</button>
        <button className="linklike small" type="button" onClick={() => void resetCheck()}>Test again</button>
      </div>
    );
  return (
    <div className="panel gate-step">
      <h2>Test it</h2>
      {setup === "single" ? (
        <>
          <p>Tap the button. Shortcuts runs “{R.SHORTCUT_GATE}”, which brings you straight back here with a ✓. Allow it if Safari asks.</p>
          <a className="btn primary block" href={R.testUrl()}>Test the Shortcut</a>
          <p className="note">Nothing happens, or Shortcuts says it can’t find the shortcut? Go back a step and add it again.</p>
        </>
      ) : (
        <>
          <p>Open {first}: you should land on the gate. Then finish a review and tap Unlock: {first} should open.</p>
          <button className="btn primary block" type="button" onClick={() => (location.hash = `#gate=${encodeURIComponent(first)}`)}>Or try the gate here</button>
        </>
      )}
      <div className="row">
        <a className="btn small ghost" href={R.unlockUrl(1, null, setup)}>Unlock for 1 minute</a>
        <a className="btn small ghost" href={R.unlockUrl(0, null, setup)}>Lock again now</a>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- the apps

function Apps() {
  const apps = useGate((d) => d.settings.apps);
  const add = (a: GateApp) => void updateSettings((s) => ({ ...s, apps: [...s.apps.filter((x) => x.name.toLowerCase() !== a.name.toLowerCase()), a] }));
  const remove = (n: string) => void updateSettings((s) => ({ ...s, apps: s.apps.filter((x) => x.name !== n) }));
  const suggestions = R.KNOWN_APPS.filter((k) => !apps.some((a) => a.name.toLowerCase() === k.name.toLowerCase()));
  return (
    <section className="panel" id="gate-apps">
      <h2>Apps to gate</h2>
      <p>
        The apps the Shortcut gates are chosen in Apple’s Shortcuts app; keep this list the same, so the gate can name
        them and reopen them after a review (with their link).
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
      <AddApp />
    </section>
  );
}

/** Add an app that isn't in the list: its name and, optionally, its own link to reopen it. */
function AddApp() {
  const [name, setName] = useState("");
  const [link, setLink] = useState("");
  const add = () => {
    const n = name.replace(/[^\p{L}\p{N} .\-_&]/gu, "").replace(/\s+/g, " ").trim().slice(0, 40);
    if (!n) return;
    if (link.trim() && !R.safeAppLink(link)) return toast("That link doesn't look like an app's link (it should look like tiktok://).");
    void updateSettings((s) => ({ ...s, apps: [...s.apps.filter((x) => x.name.toLowerCase() !== n.toLowerCase()), { name: n, link: R.safeAppLink(link) }] }));
    setName("");
    setLink("");
  };
  return (
    <div className="gate-form">
      <label className="field"><span>Another app</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Tumblr" /></label>
      <label className="field"><span>Its link (optional)</span><input value={link} onChange={(e) => setLink(e.target.value)} placeholder="e.g. tumblr://" autoCapitalize="none" autoCorrect="off" /></label>
      <button className="btn small" type="button" disabled={!name.trim()} onClick={add}>Add</button>
    </div>
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

/** iOS 26 and earlier: the two Shortcuts and one automation per app, built by hand. */
function LegacyGuide() {
  const gateUrl = R.gatePageUrl(location.origin);
  const example = useGate((d) => d.settings.apps[0]?.name ?? "TikTok");
  return (
    <div className="gate-guide">
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
          <li>New blank automation: add <b>Text</b> with the app&apos;s name exactly as in your list, e.g. <code>{example}</code>.</li>
          <li>Add <b>Run Shortcut</b> → {R.SHORTCUT_GATE}, with the Text as its input.</li>
          <li>Turn off <b>Notify When Run</b>.</li>
        </ol>
      </details>
    </div>
  );
}

/**
 * The owner's one-time job (iOS 27): build the shared "Boekenwurm Gate" Shortcut, with its automation inside, and share
 * its iCloud link. The link then goes into rules.ts (SHARED_SHORTCUT_URL) and every later setup is one tap.
 * The same recipe is in docs/APP_GATE.md.
 */
function BuildRecipe() {
  const host = location.origin.replace(/\/$/, "");
  return (
    <details className="gate-steps gate-recipe" open>
      <summary><b>Build the shared Shortcut once</b> (about 10 actions)</summary>
      <p className="small">One Shortcut does everything, told apart by what it receives: an app opening, <code>unlock|15|tiktok://</code> from this page, or <code>test</code>.</p>
      <ol>
        <li>New shortcut, named exactly <Copy text={R.SHORTCUT_GATE} />. In its details, let it receive <b>Text</b> (and Apps, if offered); if there’s no input, <b>Continue</b>.</li>
        <li><b>Add a trigger</b> (action library → <b>Automation</b>): <b>App</b> → choose TikTok, Instagram… → <b>Is Opened</b> → <b>Run Immediately</b>, notifications off.</li>
        <li><b>If</b> Shortcut Input <b>begins with</b> <code>unlock|</code>:
          <ol>
            <li><b>Split Text</b> Shortcut Input by Custom <code>|</code>.</li>
            <li><b>Get Item from List</b>: item at index <b>2</b> → <b>Adjust Date</b>: add that many <b>minutes</b> to Current Date → <b>Format Date</b>: ISO 8601, with time.</li>
            <li><b>Save File</b>: Formatted Date, to <b>Shortcuts</b>, path <Copy text="boekenwurm-unlocked-until.txt" />, Ask Where to Save off, Overwrite on.</li>
            <li><b>Get Item from List</b>: item at index <b>3</b> of Split Text → <b>If</b> it has any value: <b>Open URLs</b> it.</li>
            <li><b>Stop This Shortcut</b>.</li>
          </ol>
        End If.</li>
        <li><b>If</b> Shortcut Input <b>is</b> <code>test</code>: <b>Open URLs</b> <Copy text={`${host}/#gate-setup=ok`} />, then <b>Stop This Shortcut</b>. End If.</li>
        <li><b>Get File from Folder</b>: Shortcuts, <code>boekenwurm-unlocked-until.txt</code>, Error If Not Found off → <b>Get Dates from Input</b> → <b>If</b> Dates <b>is after</b> Current Date: <b>Stop This Shortcut</b>. End If.</li>
        <li><b>URL Encode</b> Shortcut Input → <b>Open URLs</b>: <Copy text={`${host}/#gate=`} /> followed by URL Encoded Text.</li>
        <li><b>Setup</b> (in its details): add an import question on the trigger’s apps, “Which apps should open Boekenwurm first?”</li>
        <li>Share → <b>Copy iCloud Link</b>, with the automation included. Send the link to be put behind “Add to Shortcuts”.</li>
      </ol>
      <p className="note">Check, while building: does Shortcut Input carry the app’s name when the trigger fires? If not, the gate says “a gated app” and counts all apps together.</p>
    </details>
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
