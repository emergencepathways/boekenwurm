import { useEffect, useMemo, useState } from "react";
import { marked } from "marked";
// The full notice, as published (the repository's docs/PRIVACY.md), bundled at build time.
import PRIVACY_MD from "../../../../docs/PRIVACY.md?raw";
import { setTab, useNav } from "../nav.ts";
import * as E from "@boekenwurm/engine";
import { getState, SAVED_SOURCES, updateProfile, useStore } from "../lib/store.ts";
import { lookupsToday } from "../lib/translate.ts";
import { DAILY_TRANSLATIONS } from "../lib/usage.ts";
import { MODELS, setClaudeKey, testKey, claudeKey } from "../lib/claude.ts";
import { sendSignInEmail, signOut, syncNow, verifyCode } from "../lib/sync.ts";
import { connectionCheck, type CheckReport } from "../lib/check.ts";
import { appUrl, supabase } from "../lib/supabase.ts";
import { db, wipeDevice } from "../lib/db.ts";
import { InstallRow } from "./InstallHelp.tsx";
import { updateNow } from "../lib/update.ts";
import { ADMIN, GOOGLE_PAGES, PAGE_READS_PER_DAY, pageReadsToday, redeemCode } from "../lib/features.ts";
import { Sheet, toast } from "../ui.tsx";
import { Patch, RankBar, RankShield } from "../badges.tsx";
import { statsNow } from "../lib/play.ts";
import { loadEntries } from "../lib/diary.ts";
import { LANGUAGETOOL_PRIVACY, setLanguageTool } from "../lib/consent.ts";
import { LANGUAGES, languageOf, translate, useT, type Key, type Lang } from "../lib/i18n.ts";
import { FONTS, TEXT_SIZES, fontOf, sizeOf } from "../lib/fonts.ts";
import type { BookText, Settings } from "../lib/types.ts";
import { booksForExport } from "../lib/export.ts";
import { pageReaderFor } from "../lib/pagereader.ts";
import { startGame } from "../lib/hexbound.ts";
import { allowLink, clearLinkRequest, disconnect, exportConnections, forgetConnections, linkRequest, listConnections, NotReady, startUrl, type Connection } from "../lib/connections.ts";

/** The Account tab's categories. New features go into one of these. */
type View = "achievements" | "reading" | "settings" | "experimental" | "privacy";
const VIEWS: ReadonlyArray<[View, Key]> = [
  ["achievements", "account.achievements"], ["reading", "account.reading"], ["settings", "account.settings"], ["experimental", "account.experimental"],
  ["privacy", "account.privacy"],
];
/** A link to a section (setTab("me", "claude")) opens the category that holds it. */
const viewFor = (section: string | undefined): View =>
  section === "rank" || section === "badges" ? "achievements"
  : section === "reading" || section === "lookups" ? "reading"
  : section === "claude" || section === "access-code" || section === "connected-apps" ? "experimental"
  : section === "privacy-notice" ? "privacy"
  : section ? "settings" : "achievements";

export function Me() {
  const t = useT();
  const profile = useStore((s) => s.profile);
  const p = profile.progress;
  const rank = E.rankOf(p.play);
  const play = { ...E.emptyPlay(), ...p.play };
  const stats = statsNow();
  const setSettings = (patch: Partial<Settings>) => void updateProfile((x) => ({ ...x, settings: { ...x.settings, ...patch } }));

  const nav = useNav();
  const [view, setView] = useState<View>(() => viewFor(nav.section));
  useEffect(() => {
    if (nav.section) setView(viewFor(nav.section));
  }, [nav.section]);

  return (
    <main className="screen">
      <div className="topbar"><h1>{t("account.title")}</h1></div>
      <div className="subtabs" role="tablist" aria-label={t("account.title")}>
        {VIEWS.map(([id, label]) => (
          <button key={id} type="button" role="tab" id={`tab-${id}`} aria-selected={view === id} aria-controls={`view-${id}`} onClick={() => setView(id)}>{t(label)}</button>
        ))}
      </div>

      {view === "achievements" && (
        <div className="panels" role="tabpanel" id="view-achievements" aria-labelledby="tab-achievements">
      <section className="panel" id="rank">
        <h2>{t("account.rank")}</h2>
        <RankBar />
        <div className="shields">
          {E.LEVELS.map((l) => {
            const reached = E.RANKS.indexOf(rank.rank) >= E.RANKS.indexOf(l);
            return (
              <div key={l} className={`shieldcell${reached ? " got" : ""}`}>
                <RankShield rank={l} size={44} locked={!reached} />
                <div className="t" lang="nl">{E.BADGES[l].title}</div>
                <div className="m">{t(`badge.meaning.${l}`)}</div>
              </div>
            );
          })}
        </div>
        <p className="small muted">{t("account.rankNote")}</p>
      </section>
      <section className="panel" id="badges">
        <h2>{t("account.badges")}</h2>
        <div className="patches">
          {E.ACHIEVEMENTS.map((a) => {
            const tier = Math.max(play.tiers[a.key] ?? 0, 0);
            const goal = E.nextGoal(a, stats);
            return (
              <div key={a.key} className={`patchcell${tier ? " got" : ""}`}>
                <Patch a={a} tier={tier} size={76} />
                <div className="t" lang="en">{a.name}</div>
                <div className="m num">{goal ? `${t.num(goal.value)} / ${t.num(goal.target)}` : t("account.everyTier")}</div>
              </div>
            );
          })}
          {play.secrets?.includes(E.SECRET_MORK_BORG) && (
            <div className="patchcell got secret">
              <span className="mb-patch" role="img" aria-label="Mörk Borg Enjoyer, a secret badge">MB</span>
              <div className="t" lang="en">Mörk Borg Enjoyer</div>
              <div className="m">Secret</div>
            </div>
          )}
        </div>
        <p className="small muted">
          {t("account.badgesNote", { xp: E.XP.achievement })}{" "}
          {E.lookupModeUnlocked(play.tiers) ? t("account.unlimitedOpen") : t("account.unlimitedHow")}
        </p>
      </section>
        </div>
      )}

      {view === "reading" && (
        <div className="panels" role="tabpanel" id="view-reading" aria-labelledby="tab-reading">
      <section className="panel">
        <h2>{t("account.readingTitle")}</h2>
        <label className="field">
          <span>{t("account.level")}</span>
          <select
            value={p.level}
            onChange={(e) => {
              const r = E.setLevel(getState().profile.progress, e.target.value as E.CefrLevel, Date.now());
              void updateProfile((x) => ({ ...x, progress: r.progress }));
              if (r.newBadges.length) toast(t("account.placement", { title: E.BADGES[r.newBadges[r.newBadges.length - 1].level].title }));
            }}
          >
            {E.LEVELS.map((l) => <option key={l}>{l}</option>)}
          </select>
          <span className="note">{t("account.levelNote")}</span>
        </label>
        <label className="field">
          <span>{t("account.font")}</span>
          <select value={fontOf(profile.settings.font).id} onChange={(e) => setSettings({ font: e.target.value as Settings["font"] })}>
            {FONTS.map((f) => <option key={f.id} value={f.id}>{t(`font.${f.id}`)} · {f.read} + {f.ui}</option>)}
          </select>
        </label>
        <label className="field">
          <span>{t("account.textSize")}</span>
          <select value={sizeOf(profile.settings.textSize)} onChange={(e) => setSettings({ textSize: e.target.value as Settings["textSize"] })}>
            {TEXT_SIZES.map((s) => <option key={s.id} value={s.id}>{t(`account.size.${s.id}`)}</option>)}
          </select>
        </label>
        <label className="field">
          <span>{t("account.fouten")}</span>
          <select value={profile.settings.preset} onChange={(e) => setSettings({ preset: e.target.value as E.Preset })}>
            {(["strict", "standard", "relaxed"] as const).map((k) => (
              <option key={k} value={k}>{t(`account.preset.${k}`)} · {t.num(E.PRESET_PERCENT[k])}%</option>
            ))}
          </select>
          <span className="note">{t("account.foutenNote")}</span>
        </label>
        <label className="field">
          <span>{t("account.meanings")}</span>
          <select value={profile.settings.defPref} onChange={(e) => setSettings({ defPref: e.target.value as "en" | "nl" })}>
            <option value="en">{t("account.meaningsMine")}</option>
            <option value="nl">{t("account.meaningsDutch")}</option>
          </select>
          <span className="note">{t("account.meaningsNote")}</span>
        </label>
        <label className="field">
          <span>{t("account.setSize")}</span>
          <select value={E.clampSetSize(profile.settings.reviewSetSize)} onChange={(e) => setSettings({ reviewSetSize: Number(e.target.value) })}>
            {[20, 25, 30, 35, 40, 45, 50].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <span className="note">{t("account.setSizeNote")}</span>
        </label>
        <div className="field">
          <label className="row">
            <input type="checkbox" checked={profile.settings.colorText === true} onChange={(e) => setSettings({ colorText: e.target.checked })} />
            <span>{t("account.colour")}</span>
          </label>
          <span className="note">
            {t("account.colourNote")}{" "}
            <span className="w c-green">{t("account.colour1")}</span>, <span className="w c-yellow">{t("account.colour2")}</span>,{" "}
            <span className="w c-red">{t("account.colour3")}</span>. {t("account.colourEnd")}
          </span>
        </div>
      </section>
          <LookupsSection />
        </div>
      )}

      {view === "experimental" && (
        <div className="panels" role="tabpanel" id="view-experimental" aria-labelledby="tab-experimental">
          <p className="small muted">{t("account.experimentalNote")}</p>
          <ClaudeSection />
          <AccessCodeSection />
          <ConnectedApps />
        </div>
      )}

      {view === "privacy" && (
        <div className="panels" role="tabpanel" id="view-privacy" aria-labelledby="tab-privacy">
          <PrivacyNotice />
        </div>
      )}

      {view === "settings" && (
        <div className="panels" role="tabpanel" id="view-settings" aria-labelledby="tab-settings">
          <SignIn />
          <Localization />
          <section className="panel">
            <h2>{t("account.name")}</h2>
        <label className="field">
          <span>{t("account.nameLabel")}</span>
          <input
            defaultValue={profile.displayName ?? ""}
            maxLength={80}
            placeholder={t("account.namePlaceholder")}
            onBlur={(e) => {
              const v = e.target.value.trim() || null;
              if (v !== profile.displayName) void updateProfile((x) => ({ ...x, displayName: v }));
            }}
          />
        </label>
          </section>
      <section className="panel">
        <h2>{t("account.homeScreen")}</h2>
        <InstallRow />
      </section>
          <ConnectionCheck />
          <YourData />
      <section className="panel">
        <h3>{t("account.about")}</h3>
        <p className="small">{t("account.aboutText")}</p>
        <DictionaryCredit />
        <p className="small">{t("account.tesseract")}</p>
        <Privacy />
        <VersionRow />
      </section>
        </div>
      )}
    </main>
  );
}

/** Contact for privacy questions and data requests (GDPR). */
export const PRIVACY_CONTACT = "contact@emergencepathways.org";

/**
 * Account → Settings → Localization: the language of everything around the Dutch (lib/i18n.ts). Books, Dutch words
 * and the diary prompts stay Dutch whatever is chosen.
 */
function Localization() {
  const t = useT();
  const { id: lang, draft } = languageOf(useStore((s) => s.profile.settings.language));
  return (
    <section className="panel" id="localization">
      <h2>{t("loc.title")}</h2>
      <label className="field">
        <span>{t("loc.language")}</span>
        <select
          value={lang}
          onChange={(e) => {
            const id = e.target.value as Lang;
            void updateProfile((x) => ({ ...x, settings: { ...x.settings, language: id } }));
            toast(translate(id, "loc.changed", { name: languageOf(id).native }));
          }}
        >
          {LANGUAGES.map((l) => <option key={l.id} value={l.id} lang={l.id}>{l.native}</option>)}
        </select>
        <span className="note">{t("loc.lead")}</span>
      </label>
      {lang !== "en" && (
        <>
          <p className="small">{t("loc.meanings")} {t("loc.partial")}</p>
          {draft && <p className="small muted">{t.rich("loc.draft", { email: PRIVACY_CONTACT })}</p>}
        </>
      )}
    </section>
  );
}

/**
 * The privacy notice, in plain words: what goes where, and the LanguageTool choice (lib/consent.ts). The full text
 * is docs/PRIVACY.md; keep both in step.
 */
function Privacy() {
  const t = useT();
  const lt = useStore((s) => s.profile.settings.languageTool);
  const state = t(lt == null ? "privacy.ltNotAsked" : lt.allowed ? "privacy.ltOn" : "privacy.ltOff");
  return (
    <details className="privacypanel" id="privacy">
      <summary>{t.rich("privacy.summary")}</summary>
      <ul className="small">
        <li>{t.rich("privacy.device")}</li>
        <li>{t.rich("privacy.account")}</li>
        <li>{t.rich("privacy.languagetool")} <a href={LANGUAGETOOL_PRIVACY} target="_blank" rel="noopener noreferrer">{t("consent.link")}</a>.</li>
        <li>{t.rich("privacy.translate")}</li>
        <li>{t.rich("privacy.vision")}</li>
        <li>{t.rich("privacy.claude")}</li>
        <li>{t.rich("privacy.reminder")}</li>
        <li>{t.rich("privacy.apps")}</li>
        <li>{t.rich("privacy.fonts")}</li>
      </ul>
      <div className="row">
        <span className="small grow">{t.rich("privacy.ltState", { state })}{lt ? t("privacy.ltSince", { date: t.date(lt.at) }) : ""}</span>
        {lt?.allowed !== true && <button className="btn small" type="button" onClick={() => void setLanguageTool(true).then(() => toast(t("privacy.toastOn")))}>{t("consent.yes")}</button>}
        {lt?.allowed !== false && <button className="btn small ghost" type="button" onClick={() => void setLanguageTool(false).then(() => toast(t("privacy.toastOff")))}>{t("privacy.turnOff")}</button>}
      </div>
      <p className="small">{t("privacy.contact", { email: PRIVACY_CONTACT })}</p>
      <button className="btn small" type="button" onClick={() => setTab("me", "privacy-notice")}>{t("privacy.fullLink")}</button>
    </details>
  );
}

/**
 * Account → Privacy: the full privacy notice, unabridged. It is docs/PRIVACY.md itself, built into the app, so the
 * app and the published notice can never say different things. It is in English (the language it is reviewed in).
 */
function PrivacyNotice() {
  const t = useT();
  const html = useMemo(() => marked.parse(PRIVACY_MD, { async: false }).replace(/<a href="http/g, '<a target="_blank" rel="noopener noreferrer" href="http'), []);
  return (
    <section className="panel notice">
      <p className="small muted">{t("privacy.fullNote", { email: PRIVACY_CONTACT })}</p>
      <article className="legal" lang="en" dangerouslySetInnerHTML={{ __html: html }} />
    </section>
  );
}

/** Which version is running, and a way to switch to the newest one without reinstalling. */
function VersionRow() {
  const t = useT();
  const [state, setState] = useState<"idle" | "checking" | "current" | "offline">("idle");
  return (
    <div className="row">
      <span className="small grow num">{t("account.version", { id: __BUILD_ID__.slice(0, 7) })}</span>
      <button className="btn small ghost" type="button" disabled={state === "checking"} onClick={async () => {
        setState("checking");
        setState(await updateNow());
      }}>
        {t(state === "checking" ? "account.checking" : state === "current" ? "account.upToDate" : state === "offline" ? "account.offline" : "account.checkUpdates")}
      </button>
    </div>
  );
}

function DictionaryCredit() {
  const t = useT();
  const d = useStore((s) => s.dictionary);
  if (d === undefined) return <p className="small">{t("account.dictLoading")}</p>;
  if (!d) return <p className="small">{t("account.dictNone")}</p>;
  return (
    <p className="small">
      {t("account.dictCredit", { words: d.words, forms: d.forms, built: d.built })}{" "}
      <a href="https://en.wiktionary.org" style={{ color: "var(--leaf)" }}>Wiktionary</a> ·{" "}
      <a href="https://kaikki.org" style={{ color: "var(--leaf)" }}>wiktextract</a> ·{" "}
      <a href="https://github.com/rspeer/wordfreq" style={{ color: "var(--leaf)" }}>wordfreq</a>
    </p>
  );
}

// ---------------------------------------------------------------- account

function SignIn() {
  const t = useT();
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
        <h2>{t("signin.title")}</h2>
        <p>{t("signin.notSetUp")}</p>
      </section>
    );

  if (user)
    return (
      <section className="panel">
        <h2>{t("signin.title")}</h2>
        <dl className="kv">
          <dt>{t("signin.signedIn")}</dt><dd lang="en">{user.email}</dd>
          <dt>{t("signin.sync")}</dt>
          <dd>
            {sync.status === "syncing" ? t("signin.syncing") : sync.status === "offline" ? t("signin.offline") : sync.status === "error" ? <span className="error">{sync.error}</span> : sync.lastAt ? t("signin.upToDate", { time: new Date(sync.lastAt).toLocaleTimeString(languageOf(t.lang).locale, { hour: "2-digit", minute: "2-digit" }) }) : t("signin.notSynced")}
          </dd>
        </dl>
        <div className="actions">
          <button className="btn small" type="button" onClick={() => void syncNow()} disabled={sync.status === "syncing"}>{t("signin.syncNow")}</button>
          <button className="btn small ghost" type="button" onClick={() => setOut(true)}>{t("signin.signOut")}</button>
        </div>
        {out && (
          <Sheet label={t("signin.signOut")} onClose={() => setOut(false)}>
            <h2 className="big" style={{ fontSize: "1.3rem" }}>{t("signin.signOutAsk")}</h2>
            <p className="muted" style={{ margin: 0 }}>{t("signin.signOutSafe")}</p>
            <button className="btn" type="button" onClick={() => void signOut(false).then(() => setOut(false))}>{t("signin.signOutKeep")}</button>
            <button className="btn danger" type="button" onClick={() => void signOut(true).then(() => setOut(false))}>{t("signin.signOutRemove")}</button>
            <button className="btn ghost" type="button" onClick={() => setOut(false)}>{t("common.cancel")}</button>
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
      toast(t("signin.toast"));
    } catch (e) {
      setErr(/expired|invalid/i.test((e as Error).message) ? t("signin.badCode") : (e as Error).message);
    }
    setBusy(false);
  };

  return (
    <section className="panel" id="account">
      <h2>{t("signin.keepTitle")}</h2>
      <p>{t("signin.keepLead")}</p>
      {!sent ? (
        <form className="stack" onSubmit={(e) => (e.preventDefault(), void send())}>
          <label className="field">
            <span>{t("signin.email")}</span>
            <input type="email" dir="ltr" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <button className="btn primary" type="submit" disabled={busy || !/\S+@\S+\.\S+/.test(email)}>{busy ? t("signin.sending") : t("signin.send")}</button>
        </form>
      ) : (
        <form className="stack" onSubmit={(e) => (e.preventDefault(), void verify())}>
          <p>{t.rich("signin.sent", { email: sent })}</p>
          <label className="field">
            <span>{t("signin.code")}</span>
            <input dir="ltr" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={10} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
          </label>
          <div className="actions">
            <button className="btn primary" type="submit" disabled={busy || code.length < 6}>{busy ? t("account.checking") : t("reminder.signIn")}</button>
            <button className="btn ghost" type="button" onClick={() => (setSent(null), setCode(""))}>{t("signin.another")}</button>
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
        {!user && " Lookups need an account: sign in above to use them."}
      </p>
      <div className="row">
        <span className="label">Today</span>
        <span className="num">{used} of {limit}</span>
        <span className="bar grow" aria-label={`${used} of ${limit} lookups used today`}><i style={{ width: `${Math.min(100, (used / limit) * 100)}%` }} /></span>
      </div>
      <p className="small">Your saved meanings: <span className="num">{saved.toLocaleString()}</span> words (found by Google or Claude, or typed by you).</p>
    </section>
  );
}

// ---------------------------------------------------------------- access code

/** An access code opens a feature that isn't open to everyone yet: for now, Google page reading. */
/**
 * Account → Settings → Connected apps: agree to what an app will see, pair it with a 10-minute code, then allow its
 * request. Approved apps see today's numbers only (migrations 0013 + 0014). PRELAUNCH-REMOVE (docs/PRELAUNCH.md).
 */
/**
 * Account → Experimental → Connected apps (lib/connections.ts). PRELAUNCH-REMOVE (docs/PRELAUNCH.md). Shown to the
 * owner's account (admin feature) only, and to anyone Poortwachter sends here, who is told it's owner-only.
 */
function ConnectedApps() {
  const t = useT();
  const user = useStore((s) => s.user);
  const owner = useStore((s) => s.features.includes(ADMIN));
  const [request, setRequest] = useState(() => linkRequest());
  const [list, setList] = useState<Connection[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fail = (x: unknown) => setErr(x instanceof NotReady ? t("apps.notReady") : (x as Error)?.message || t("apps.error"));
  const load = () => listConnections().then(setList, fail);
  useEffect(() => {
    if (user && owner) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, owner]);

  if (!owner && !request) return null;
  const cancel = () => (clearLinkRequest(), setRequest(null));

  return (
    <section className="panel" id="connected-apps">
      <h2>{t("apps.title")}</h2>
      {!user ? (
        <p className="small">{t("apps.signIn")}</p>
      ) : !owner ? (
        <>
          <p className="small">{t("apps.ownerOnly")}</p>
          <button className="btn ghost small" type="button" onClick={cancel}>{t("common.cancel")}</button>
        </>
      ) : request ? (
        <div className="stack" role="alertdialog" aria-label={t("apps.request", { name: request.name })} style={{ border: "2px solid var(--accent, currentColor)", borderRadius: 12, padding: 12 }}>
          <h3 style={{ margin: 0 }}>{t("apps.request", { name: request.name })}</h3>
          <span className="small">{t("apps.requestLead")}</span>
          <b className="small">{t("apps.consentTitle")}</b>
          <ul className="small" style={{ margin: 0 }}>
            <li>{t("apps.c1")}</li>
            <li>{t("apps.c2")}</li>
            <li>{t("apps.c3")}</li>
            <li>{t("apps.c4")}</li>
          </ul>
          <p className="small" style={{ margin: 0 }}>{t.rich("apps.consentNever")}</p>
          <p className="small" style={{ margin: 0 }}>{t("apps.consentControl")}</p>
          <div className="row">
            <button
              className="btn primary"
              type="button"
              disabled={busy}
              onClick={async () => {
                setErr(null);
                setBusy(true);
                try {
                  location.assign(await allowLink(request));
                } catch (x) {
                  fail(x);
                  setBusy(false);
                }
              }}
            >
              {busy ? t("apps.allowing") : t("apps.allow")}
            </button>
            <button className="btn ghost" type="button" disabled={busy} onClick={cancel}>{t("common.cancel")}</button>
          </div>
        </div>
      ) : (
        <>
          <p>{t("apps.lead")}</p>
          <a className="btn primary" href={startUrl(location.origin)}>{t("apps.start")}</a>
          <span className="small">{t("apps.startNote")}</span>
          {list && list.length === 0 && <p className="small">{t("apps.none")}</p>}
          {(list ?? []).map((c) => (
            <div className="row" key={c.id}>
              <span className="grow">
                <b>{c.name}</b>
                <br />
                <span className="small">
                  {t("apps.connected", { date: t.date(Date.parse(c.approved_at ?? c.created_at)) })} · {c.last_used_at ? t("apps.lastUsed", { date: t.date(Date.parse(c.last_used_at)) }) : t("apps.neverUsed")} · {t("apps.expiresOn", { date: t.date(Date.parse(c.expires_at)) })}
                </span>
              </span>
              <button
                className="btn small ghost"
                type="button"
                onClick={async () => {
                  setErr(null);
                  try {
                    await disconnect(c.id);
                    toast(t("apps.disconnected"));
                    await load();
                  } catch (x) {
                    fail(x);
                  }
                }}
              >
                {t("apps.disconnect")}
              </button>
            </div>
          ))}
        </>
      )}
      {err && <span className="error">{err}</span>}
    </section>
  );
}

function AccessCodeSection() {
  const user = useStore((s) => s.user);
  const features = useStore((s) => s.features);
  const reads = useStore((s) => s.pageReads);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const on = features.includes(GOOGLE_PAGES);
  useEffect(() => void (on && pageReadsToday()), [on, user]);
  const used = reads?.used ?? 0;
  return (
    <section className="panel" id="access-code">
      <h2>Access code</h2>
      {on ? (
        <>
          <p>
            <b>Google page reading is on.</b> You can photograph books, and Google reads the pages: up to {PAGE_READS_PER_DAY} pages a day for all your books together, again from midnight.
          </p>
          <div className="row">
            <span className="label">Today</span>
            <span className="num">{used} of {PAGE_READS_PER_DAY}</span>
            <span className="bar grow" aria-label={`${used} of ${PAGE_READS_PER_DAY} Google page readings used today`}>
              <i style={{ width: `${Math.min(100, (used / PAGE_READS_PER_DAY) * 100)}%` }} />
            </span>
          </div>
        </>
      ) : null}
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setErr(null);
          // Some codes open something on this device only and are never sent anywhere (lib/hexbound.ts).
          if (E.isGameCode(code)) return void startGame().then(() => setCode(""));
          if (!user) return setErr("Sign in first: a code is added to your account.");
          setBusy(true);
          try {
            await redeemCode(code);
            setCode("");
            toast("Code accepted: Google page reading is on.");
          } catch (x) {
            setErr((x as Error).message);
          }
          setBusy(false);
        }}
      >
        <p style={{ margin: 0 }}>{on ? "Have another code? Enter it here." : `Have an access code? Enter it to turn on a feature that isn't open to everyone yet.${user ? "" : " Most codes need you to sign in first."}`}</p>
        <div className="row">
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="BW-XXXX-XXXX-XXXX-XXXX" aria-label="Access code"
            autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={40} style={{ flex: 1, minWidth: 0 }} className="num" />
          <button className="btn primary small" type="submit" disabled={busy || code.trim().length < 5}>{busy ? "Checking…" : "Use code"}</button>
        </div>
        {err && <span className="error">{err}</span>}
      </form>
    </section>
  );
}

// ---------------------------------------------------------------- Claude

/**
 * Claude reads page photos for the owner's admin account only, with her own key (lib/pagereader.ts). It does nothing
 * else since 2026-11-27 (DESIGN.md). Anyone else who saved a key earlier is told it is no longer used, and can remove it.
 */
function ClaudeSection() {
  const hasKey = useStore((s) => s.hasKey);
  const admin = useStore((s) => s.features.includes(ADMIN));
  const google = useStore((s) => s.features.includes(GOOGLE_PAGES));
  const model = useStore((s) => s.profile.settings.models.vision);
  const choice = useStore((s) => s.profile.settings.pageReader ?? "google");
  const [key, setKey] = useState("");
  const [testing, setTesting] = useState(false);
  const setSetting = (patch: Partial<Settings>) => void updateProfile((x) => ({ ...x, settings: { ...x.settings, ...patch } }));
  if (!admin)
    return hasKey ? (
      <section className="panel" id="claude">
        <h2>Claude</h2>
        <p>Boekenwurm no longer uses Claude, so the Claude key saved on this device isn't used. You can remove it.</p>
        <button className="btn small" type="button" onClick={() => (setClaudeKey(""), toast("Key removed from this device."))}>Remove key</button>
      </section>
    ) : null;
  const effective = pageReaderFor(choice, { admin, hasKey, google });
  return (
    <section className="panel" id="claude">
      <h2>Claude: reading pages</h2>
      <p>
        For your account only, while it's being tested: Claude can help Google read photographed and scanned pages, with
        your own Claude API key. The key stays on this device (never synced) and is sent only to Anthropic. Claude is used
        for nothing else.
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
                await testKey(model);
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
      <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }} disabled={!hasKey}>
        <legend className="label">Who reads pages</legend>
        {(
          [
            ["google", "Google", `Google Cloud Vision reads each page (${PAGE_READS_PER_DAY} pages a day).`],
            ["google+claude", "Google, with Claude for the paragraphs", "Google reads the words; Claude looks at the photo and sorts them into the printed paragraphs and finds the page number. Claude can't change a word: if it tries, Google's layout is kept."],
            ["claude", "Claude instead of Google", "Claude reads the page from the photo. Google's daily pages aren't used."],
          ] as const
        ).map(([id, name, note]) => (
          <label key={id} style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 10, alignItems: "start" }}>
            <input type="radio" name="page-reader" checked={choice === id} onChange={() => setSetting({ pageReader: id })} style={{ marginTop: 4 }} />
            <span><b>{name}</b><br /><span className="small muted">{note}</span></span>
          </label>
        ))}
      </fieldset>
      {!hasKey && <p className="small">Save your key to choose Claude. Until then Google reads every page.</p>}
      {hasKey && choice === "google+claude" && effective !== choice && <p className="small">Google + Claude needs Google page reading (an access code), so Google alone reads pages for now.</p>}
      <label className="field">
        <span>Claude model for pages</span>
        <select value={model} onChange={(e) => setSetting({ models: { vision: e.target.value } })}>
          {MODELS.map(([id, name, note]) => <option key={id} value={id}>{name}: {note}</option>)}
        </select>
      </label>
      <p className="small">
        Get a key at console.anthropic.com → API keys. API use is billed by Anthropic to your account, separately from a
        Claude.ai subscription. Set a monthly spending limit there (Settings → Limits).
      </p>
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
    const texts = await db.all<BookText>("texts");
    const data = {
      exported: new Date().toISOString(),
      profile: { displayName: s.profile.displayName, settings: s.profile.settings, progress: s.profile.progress },
      // Photographed books: title, author, pages read and progress, not their text (lib/export.ts).
      ...booksForExport(s.books, texts),
      words: s.wordbook, meanings: s.meanings, examples: s.examples, cards: s.cards,
      // Kept only on this device; part of the export because it is the reader's own writing.
      diary: await loadEntries(),
      // Connected apps and the reading activity measured for them (PRELAUNCH-REMOVE, docs/PRELAUNCH.md).
      ...(await exportConnections().catch(() => ({ connections: [], readingActivity: [] }))),
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
      // Reminder subscriptions (migration 0011); ignored before that migration runs.
      await supabase.from("push_subscriptions").delete().eq("user_id", user.id);
      // Connected apps, requests and pairing codes (migration 0014; PRELAUNCH-REMOVE).
      await forgetConnections();
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
      <p className="small">Photographed books are in the export with their title, author, pages read and progress, but not their text: Boekenwurm keeps that only for you to read here.</p>
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
