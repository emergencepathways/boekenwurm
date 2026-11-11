import { useEffect, useState } from "react";
import * as E from "@boekenwurm/engine";
import { getState, importWordList, SAVED_SOURCES, updateProfile, useStore } from "../lib/store.ts";
import { lookupsToday } from "../lib/translate.ts";
import { DAILY_TRANSLATIONS } from "../lib/usage.ts";
import { MODELS, setClaudeKey, testKey, claudeKey } from "../lib/claude.ts";
import { parseWordList } from "../lib/words.ts";
import { sendSignInEmail, signOut, syncNow, verifyCode } from "../lib/sync.ts";
import { connectionCheck, type CheckReport } from "../lib/check.ts";
import { appUrl, supabase } from "../lib/supabase.ts";
import { db, wipeDevice } from "../lib/db.ts";
import { InstallRow } from "./InstallHelp.tsx";
import { plural, Sheet, TokenPips, toast } from "../ui.tsx";
import type { Settings } from "../lib/types.ts";

export function Me() {
  const profile = useStore((s) => s.profile);
  const p = profile.progress;
  const got = new Map(p.badges.map((b) => [b.level, b]));
  const next = E.nextLevel(p.level);
  const left = E.tokensToOffer(p);
  const setSettings = (patch: Partial<Settings>) => void updateProfile((x) => ({ ...x, settings: { ...x.settings, ...patch } }));

  return (
    <main className="screen">
      <div className="topbar"><h1>Me</h1></div>

      <section className="panel">
        <h2>Your badges</h2>
        <div className="badges">
          {E.LEVELS.map((l) => {
            const b = got.get(l);
            const info = E.BADGES[l];
            return (
              <div key={l} className={`badge ${b ? "got" : ""} ${b?.source === "placement" ? "placement" : ""}`}>
                <div className="medal">{l}</div>
                <div className="t" lang="nl">{info.title}</div>
                <div className="m">{info.meaning}{b?.source === "placement" ? " · placed" : ""}</div>
              </div>
            );
          })}
        </div>
        <div className="row">
          <span className="label">Toward {next ?? "—"}</span> <TokenPips progress={p} />
          <span className="small muted">
            {next ? (p.offer ? "An offer is waiting: open a book." : `${plural(left, "more token")}, each from a separate session with a 10-paragraph streak.`) : "Top level reached."}
          </span>
        </div>
        <p className="small">A dashed ring means the level was set, not earned in play. Tokens earned in total: <span className="num">{p.history.length}</span></p>
      </section>

      <Account />

      <section className="panel">
        <h2>Reading</h2>
        <label className="field">
          <span>Your level</span>
          <select
            value={p.level}
            onChange={(e) => {
              const r = E.setLevel(getState().profile.progress, e.target.value as E.CefrLevel, Date.now());
              void updateProfile((x) => ({ ...x, progress: r.progress }));
              if (r.newBadges.length) toast(`Badge: ${E.BADGES[r.newBadges[r.newBadges.length - 1].level].title} (placement)`);
            }}
          >
            {E.LEVELS.map((l) => <option key={l}>{l}</option>)}
          </select>
          <span className="note">Changing it by hand gives placement badges and restarts the token count.</span>
        </label>
        <label className="field">
          <span>Strikes per paragraph</span>
          <select value={profile.settings.preset} onChange={(e) => setSettings({ preset: e.target.value as E.Preset })}>
            {(["strict", "standard", "relaxed"] as const).map((k) => (
              <option key={k} value={k}>{k[0].toUpperCase() + k.slice(1)} · {E.PRESET_PERCENT[k]}%</option>
            ))}
          </select>
          <span className="note">Applies from your next session. Streaks tighten it as you go.</span>
        </label>
        <label className="field">
          <span>Meanings below B1</span>
          <select value={profile.settings.defPref} onChange={(e) => setSettings({ defPref: e.target.value as "en" | "nl" })}>
            <option value="en">English</option>
            <option value="nl">Dutch</option>
          </select>
          <span className="note">From B1, and during a streak, meanings are always in Dutch.</span>
        </label>
        <label className="field">
          <span>Name</span>
          <input
            defaultValue={profile.displayName ?? ""}
            maxLength={80}
            placeholder="What Home calls you"
            onBlur={(e) => {
              const v = e.target.value.trim() || null;
              if (v !== profile.displayName) void updateProfile((x) => ({ ...x, displayName: v }));
            }}
          />
        </label>
      </section>

      <LookupsSection />
      <ClaudeSection />
      <WordListSection />

      <section className="panel">
        <h2>On your home screen</h2>
        <InstallRow />
      </section>

      <ConnectionCheck />
      <YourData />

      <section className="panel">
        <h3>About</h3>
        <p className="small">Boekenwurm is a reading game for learners of Dutch. Your books stay private: on this device, and in your own account when you sign in.</p>
        <DictionaryCredit />
        <p className="small">On-device page reading by Tesseract.js and its Dutch model (Apache-2.0). Flashcard scheduling by ts-fsrs (MIT).</p>
      </section>
    </main>
  );
}

function DictionaryCredit() {
  const d = useStore((s) => s.dictionary);
  if (d === undefined) return <p className="small">Loading the dictionary…</p>;
  if (!d) return <p className="small">This build has no dictionary, so words show meanings only from your word list or Claude.</p>;
  return (
    <p className="small">
      Dictionary: {d.words.toLocaleString()} Dutch words and {d.forms.toLocaleString()} word forms, built {d.built}. Meanings and word forms from{" "}
      <a href="https://en.wiktionary.org" style={{ color: "var(--leaf)" }}>Wiktionary</a> via{" "}
      <a href="https://kaikki.org" style={{ color: "var(--leaf)" }}>wiktextract</a>; word frequencies from{" "}
      <a href="https://github.com/rspeer/wordfreq" style={{ color: "var(--leaf)" }}>wordfreq</a>. Both CC BY-SA 4.0; the dictionary is shared under the same licence.
    </p>
  );
}

// ---------------------------------------------------------------- account

function Account() {
  const user = useStore((s) => s.user);
  const sync = useStore((s) => s.sync);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [out, setOut] = useState(false);

  if (!supabase)
    return (
      <section className="panel">
        <h2>Account</h2>
        <p>Sign-in isn't set up in this build, so your books and progress stay on this device.</p>
      </section>
    );

  if (user)
    return (
      <section className="panel">
        <h2>Account</h2>
        <dl className="kv">
          <dt>Signed in</dt><dd>{user.email}</dd>
          <dt>Sync</dt>
          <dd>
            {sync.status === "syncing" ? "Syncing…" : sync.status === "offline" ? "Offline: changes wait on this device" : sync.status === "error" ? <span className="error">{sync.error}</span> : sync.lastAt ? `Up to date (${new Date(sync.lastAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})` : "Not synced yet"}
          </dd>
        </dl>
        <div className="actions">
          <button className="btn small" type="button" onClick={() => void syncNow()} disabled={sync.status === "syncing"}>Sync now</button>
          <button className="btn small ghost" type="button" onClick={() => setOut(true)}>Sign out</button>
        </div>
        {out && (
          <Sheet label="Sign out" onClose={() => setOut(false)}>
            <h2 className="big" style={{ fontSize: "1.3rem" }}>Sign out?</h2>
            <p className="muted" style={{ margin: 0 }}>Your books and progress stay safe in your account.</p>
            <button className="btn" type="button" onClick={() => void signOut(false).then(() => setOut(false))}>Sign out, keep books on this device</button>
            <button className="btn danger" type="button" onClick={() => void signOut(true).then(() => setOut(false))}>Sign out and remove them from this device</button>
            <button className="btn ghost" type="button" onClick={() => setOut(false)}>Cancel</button>
          </Sheet>
        )}
      </section>
    );

  const send = async () => {
    setBusy(true);
    setErr(null);
    try {
      await sendSignInEmail(email.trim(), appUrl());
      setSent(email.trim());
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  };
  const verify = async () => {
    setBusy(true);
    setErr(null);
    try {
      await verifyCode(sent!, code);
      toast("Signed in. Syncing your books…");
    } catch (e) {
      setErr(/expired|invalid/i.test((e as Error).message) ? "That code didn't work. Check it, or send a new email." : (e as Error).message);
    }
    setBusy(false);
  };

  return (
    <section className="panel" id="account">
      <h2>Keep your progress everywhere</h2>
      <p>Sign in to keep your books, words and badges on all your devices. No password: we email you a link and a code.</p>
      {!sent ? (
        <form className="stack" onSubmit={(e) => (e.preventDefault(), void send())}>
          <label className="field">
            <span>Email</span>
            <input type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <button className="btn primary" type="submit" disabled={busy || !/\S+@\S+\.\S+/.test(email)}>{busy ? "Sending…" : "Email me a sign-in link"}</button>
        </form>
      ) : (
        <form className="stack" onSubmit={(e) => (e.preventDefault(), void verify())}>
          <p>We sent an email to <b>{sent}</b>. Tap the link in it, or type the 6-digit code here (best for the Home Screen app on iPhone).</p>
          <label className="field">
            <span>Code</span>
            <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={10} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
          </label>
          <div className="actions">
            <button className="btn primary" type="submit" disabled={busy || code.length < 6}>{busy ? "Checking…" : "Sign in"}</button>
            <button className="btn ghost" type="button" onClick={() => (setSent(null), setCode(""))}>Use another email</button>
          </div>
        </form>
      )}
      {err && <p className="error">{err}</p>}
    </section>
  );
}

// ---------------------------------------------------------------- word lookups

function LookupsSection() {
  const t = useStore((s) => s.translations);
  const meanings = useStore((s) => s.meanings);
  const user = useStore((s) => s.user);
  useEffect(() => void lookupsToday(), [user]);
  const saved = Object.values(meanings).filter((m) => SAVED_SOURCES.includes(m.from)).length;
  const used = t?.used ?? 0;
  const limit = t?.limit ?? DAILY_TRANSLATIONS;
  return (
    <section className="panel">
      <h2>Word lookups</h2>
      <p>
        Words the dictionary doesn't know are looked up with Google Translate: up to {limit} a day, back at midnight. Every meaning found is saved
        {user ? " to your account" : " on this device"}, so a word is only ever looked up once.
      </p>
      <div className="row">
        <span className="label">Today</span>
        <span className="num">{used} of {limit}</span>
        <span className="bar grow" aria-label={`${used} of ${limit} lookups used today`}><i style={{ width: `${Math.min(100, (used / limit) * 100)}%` }} /></span>
      </div>
      <p className="small">Your saved meanings: <span className="num">{saved.toLocaleString()}</span> words (from Google, Claude, or typed by you).</p>
    </section>
  );
}

// ---------------------------------------------------------------- Claude

function ClaudeSection() {
  const hasKey = useStore((s) => s.hasKey);
  const models = useStore((s) => s.profile.settings.models);
  const preferFree = useStore((s) => s.profile.settings.preferFreeReading);
  const [key, setKey] = useState("");
  const [testing, setTesting] = useState(false);
  const setModel = (k: keyof Settings["models"], v: string) =>
    void updateProfile((x) => ({ ...x, settings: { ...x.settings, models: { ...x.settings.models, [k]: v } } }));
  return (
    <section className="panel" id="claude">
      <h2>Claude</h2>
      <p>
        Book levels, Match my level, word meanings in their sentence, and reading photographed pages use your own Claude API key. It stays on
        this device (never synced) and is sent only to Anthropic. Without it, everything else works for free.
      </p>
      <p className="small">
        Get a key at console.anthropic.com → API keys. API use is billed by Anthropic to your account, separately from a Claude.ai
        subscription. Set a monthly spending limit there (Settings → Limits).
      </p>
      <form className="row" onSubmit={(e) => (e.preventDefault(), setClaudeKey(key.trim()), setKey(""), toast(key.trim() ? "Key saved on this device." : "Key removed."))}>
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={hasKey ? `•••• ${claudeKey().slice(-4)} saved` : "sk-ant-…"}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          style={{ flex: 1, minWidth: 0 }}
          aria-label="Claude API key"
        />
        <button className="btn small" type="submit" disabled={!key.trim()}>Save</button>
      </form>
      {hasKey && (
        <div className="actions">
          <button
            className="btn small"
            type="button"
            disabled={testing}
            onClick={async () => {
              setTesting(true);
              try {
                await testKey(models.words);
                toast("Your Claude key works.");
              } catch (e) {
                toast((e as Error).message, 5000);
              }
              setTesting(false);
            }}
          >
            {testing ? "Testing…" : "Test key"}
          </button>
          <button className="btn small ghost" type="button" onClick={() => (setClaudeKey(""), toast("Key removed from this device."))}>Remove key</button>
        </div>
      )}
      {(
        [
          ["match", "Book level and matching"],
          ["words", "Words in context"],
          ["vision", "Reading photos"],
        ] as const
      ).map(([k, label]) => (
        <label key={k} className="field">
          <span>{label}</span>
          <select value={models[k]} onChange={(e) => setModel(k, e.target.value)}>
            {MODELS.map(([id, name, note]) => <option key={id} value={id}>{name}: {note}</option>)}
          </select>
        </label>
      ))}
      <label className="row small">
        <input type="checkbox" checked={preferFree} onChange={(e) => void updateProfile((x) => ({ ...x, settings: { ...x.settings, preferFreeReading: e.target.checked } }))} />
        Read photographed pages on this device even with a key (free, a little less accurate)
      </label>
    </section>
  );
}

// ---------------------------------------------------------------- word list

function WordListSection() {
  const list = useStore((s) => s.wordList);
  const [err, setErr] = useState<string | null>(null);
  return (
    <section className="panel">
      <h2>Word list</h2>
      <p>
        {list
          ? <>Using <b>{list.name}</b>: {list.size.toLocaleString()} words, for meanings and for knowing which words you've already learned.</>
          : "Import the word list made from your own textbook (wordlist.json from the textbook tool). It stays on this device and is never uploaded."}
      </p>
      <div className="actions">
        <label className="btn small" style={{ position: "relative" }}>
          {list ? "Replace…" : "Import wordlist.json…"}
          <input
            type="file"
            accept=".json,application/json"
            style={{ position: "absolute", inset: 0, opacity: 0 }}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                const parsed = parseWordList(f.name, await f.text());
                await importWordList(parsed);
                setErr(null);
                toast(`Loaded ${Object.keys(parsed.entries).length.toLocaleString()} words.`);
              } catch (x) {
                setErr((x as Error).message);
              }
              e.target.value = "";
            }}
          />
        </label>
        {list && <button className="btn small ghost" type="button" onClick={() => void importWordList(null)}>Remove</button>}
      </div>
      {err && <p className="error">{err}</p>}
    </section>
  );
}

// ---------------------------------------------------------------- connection check

function ConnectionCheck() {
  const [report, setReport] = useState<CheckReport | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <section className="panel" id="connection">
      <h2>Connection check</h2>
      <p>Checks that Supabase is reachable and that the database schema is loaded. Read-only: it adds nothing.</p>
      <button className="btn small" type="button" disabled={busy} onClick={async () => {
        setBusy(true);
        setReport(await connectionCheck().catch((e) => ({ host: null, schemaLoaded: null, lines: [{ name: "Check", ok: false, detail: String((e as Error).message) }] })));
        setBusy(false);
      }}>
        {busy ? "Checking…" : "Run check"}
      </button>
      {report && (
        <>
          {report.schemaLoaded === true && <div className="verdict"><b>Schema loaded</b><span className="small">All tables, the counter function{report.lines.some((l) => l.name.startsWith("Storage") && l.ok) ? " and storage" : ""} are in place.</span></div>}
          {report.schemaLoaded === false && <div className="verdict bad"><b>Schema not loaded</b><span className="small">Run the files in supabase/migrations in the Supabase SQL Editor, in order, then check again.</span></div>}
          {report.host && <p className="small num">{report.host}</p>}
          <div className="checklist">
            {report.lines.map((l) => (
              <div key={l.name}>
                <span className={l.ok ? "ok" : l.ok === false ? "bad" : "muted"} aria-hidden="true">{l.ok ? "✓" : l.ok === false ? "✗" : "–"}</span>
                <span>{l.name}</span>
                <span className="small muted">{l.detail}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- export and delete

function YourData() {
  const user = useStore((s) => s.user);
  const [confirm, setConfirm] = useState<"device" | "account" | null>(null);
  const [busy, setBusy] = useState(false);

  const exportJson = async () => {
    const s = getState();
    const texts = await db.all("texts");
    const data = {
      exported: new Date().toISOString(),
      profile: { displayName: s.profile.displayName, settings: s.profile.settings, progress: s.profile.progress },
      books: s.books,
      paragraphs: texts,
      words: s.wordbook, meanings: s.meanings, examples: s.examples, cards: s.cards,
    };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: "application/json" }));
    a.download = `boekenwurm-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  const eraseAccount = async () => {
    if (!supabase || !user) return;
    setBusy(true);
    try {
      // Row-level security limits every delete to this reader's own rows and files.
      for (const b of ["covers", "pages", "books"]) {
        const { data } = await supabase.storage.from(b).list(user.id, { limit: 1000 });
        if (data?.length) await supabase.storage.from(b).remove(data.map((f) => `${user.id}/${f.name}`));
      }
      for (const t of ["cards", "word_stats", "reading_sessions", "word_lists", "books"]) await supabase.from(t).delete().eq("user_id", user.id);
      await supabase.from("profiles").update({ progress: {}, settings: {}, display_name: null }).eq("user_id", user.id);
      await signOut(true);
      toast("Your data was erased from your account and this device.");
    } catch (e) {
      toast(`Couldn't erase everything: ${(e as Error).message}`, 6000);
    }
    setBusy(false);
    setConfirm(null);
  };

  return (
    <section className="panel">
      <h2>Your data</h2>
      <p>Everything you read and every word you tap belongs to you. Export it, or erase it.</p>
      <div className="actions">
        <button className="btn small" type="button" onClick={() => void exportJson()}>Export everything (JSON)</button>
        <button className="btn small ghost" type="button" onClick={() => setConfirm("device")}>Erase from this device…</button>
        {user && <button className="btn small ghost" type="button" style={{ color: "var(--strike)" }} onClick={() => setConfirm("account")}>Erase from my account…</button>}
      </div>
      {confirm && (
        <Sheet label="Erase data" onClose={() => setConfirm(null)}>
          <h2 className="big" style={{ fontSize: "1.3rem" }}>{confirm === "device" ? "Erase everything on this device?" : "Erase everything in your account?"}</h2>
          <p className="muted" style={{ margin: 0 }}>
            {confirm === "device"
              ? user ? "Your account keeps its copy; it comes back when you sign in again." : "You're not signed in, so this can't be undone."
              : "Books, covers, words, flashcards, sessions and badges are deleted from the server and this device. This can't be undone. Your sign-in stays; ask us to remove it too."}
          </p>
          <button
            className="btn danger"
            type="button"
            disabled={busy}
            onClick={() =>
              confirm === "device"
                ? void (async () => {
                    if (user) await signOut(true);
                    else {
                      await wipeDevice();
                      location.reload();
                    }
                    setConfirm(null);
                  })()
                : void eraseAccount()
            }
          >
            {busy ? "Erasing…" : "Erase"}
          </button>
          <button className="btn ghost" type="button" onClick={() => setConfirm(null)}>Cancel</button>
        </Sheet>
      )}
    </section>
  );
}
