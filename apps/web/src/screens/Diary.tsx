/**
 * The Diary (Study → Diary): 20 prompts in Dutch, one entry a day, then free writing (packages/engine/src/diary.ts).
 * Writing gets word suggestions from the open dictionary (on the device); "Check my writing" asks LanguageTool from
 * the reader's own device (lib/grammar.ts). Entries are saved on this device only (lib/diary.ts).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as E from "@boekenwurm/engine";
import { getState, useStore } from "../lib/store.ts";
import { diaryEntrySaved, diaryRecord, todayLocal } from "../lib/play.ts";
import { addEntry, deleteEntry, loadEntries, type DiaryEntry } from "../lib/diary.ts";
import { applyFix, checkDutch, type Mistake } from "../lib/grammar.ts";
import { applySuggestion, buildSuggester, wordAtCaret, type Suggestion } from "../lib/suggest.ts";
import { dictionaryData } from "../lib/words.ts";
import { Reminders } from "./Reminders.tsx";
import { LANGUAGETOOL_PRIVACY, setLanguageTool } from "../lib/consent.ts";
import { useT, type Key } from "../lib/i18n.ts";

const promptById = (id: number | null) => E.DIARY_PROMPTS.find((p) => p.id === id) ?? null;
const DATE: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short", year: "numeric" };
/** A prompt's question in the reader's language (src/i18n), for "Show in English" and its translations. */
const promptKey = (id: number) => `diary.p${id}` as Key;

export function Diary() {
  const t = useT();
  useStore((s) => s.profile.progress.play); // the record changes when an entry counts
  const record = diaryRecord();
  const freeOpen = E.freeWritingOpen(record);
  const thisWeek = !E.weeklyDue({ done: [], days: record.days }, todayLocal()); // an entry counted this week
  const allowed = useStore((s) => s.profile.settings.languageTool?.allowed ?? null);
  const [entries, setEntries] = useState<DiaryEntry[] | null>(null);
  const [saved, setSaved] = useState<DiaryEntry | null>(null);
  useEffect(() => void loadEntries().then(setEntries), []);

  return (
    <>
      <section className="panel">
        <h2>{t("diary.title")}</h2>
        <p>
          {freeOpen ? t("diary.leadFree") : t("diary.leadPrompts")}{" "}
          {t(thisWeek ? "diary.weekEarned" : "diary.weekWaiting", { week: E.DIARY.weekXp, extra: E.DIARY.extraXp })}
        </p>
        <div className="xpbar" role="progressbar" aria-label={t("diary.progressAria")} aria-valuemin={0} aria-valuemax={20} aria-valuenow={record.done.length}>
          <i style={{ width: `${(record.done.length / 20) * 100}%` }} />
        </div>
        <p className="small muted num">{t("diary.progress", { n: record.done.length })}</p>
        <p className="small privacy">
          {t("diary.privacy")} {allowed ? t("diary.privacyOn") : allowed === false ? t("diary.privacyOff") : ""}
        </p>
      </section>

      {saved ? (
        <section className="panel">
          <h2>{t("diary.saved")}</h2>
          {promptById(saved.promptId) && <p lang="nl"><b>{promptById(saved.promptId)!.nl}</b></p>}
          <p className="entrytext" lang="nl">{saved.text}</p>
          <p className="small muted">{t("diary.savedNote")}</p>
          <button className="btn" type="button" onClick={() => setSaved(null)}>{t("common.done")}</button>
        </section>
      ) : (
        <Composer
          key={record.done.length}
          freeOpen={freeOpen}
          checker={allowed === true}
          onSaved={async (e) => {
            setSaved(e);
            setEntries(await loadEntries());
          }}
        />
      )}

      {allowed === null && <ConsentPrompt />}

      <Reminders />

      <PastEntries entries={entries} onDelete={async (id) => (await deleteEntry(id), setEntries(await loadEntries()))} />
    </>
  );
}

/**
 * Asked on the first visit, like a cookie notice: may "Check my writing" use LanguageTool? Both answers are equally
 * easy, and the diary works either way (lib/consent.ts).
 */
function ConsentPrompt() {
  const t = useT();
  return (
    <div className="consent" role="dialog" aria-modal="false" aria-labelledby="consent-title">
      <h2 id="consent-title">{t("consent.title")}</h2>
      <p>{t("consent.intro")}</p>
      <ul>{(["consent.p1", "consent.p2", "consent.p3", "consent.p4"] as const).map((k) => <li key={k}>{t(k)}</li>)}</ul>
      <p className="small"><a href={LANGUAGETOOL_PRIVACY} target="_blank" rel="noopener noreferrer">{t("consent.link")}</a></p>
      <div className="choices">
        <button className="btn" type="button" onClick={() => void setLanguageTool(true)}>{t("consent.yes")}</button>
        <button className="btn" type="button" onClick={() => void setLanguageTool(false)}>{t("consent.no")}</button>
      </div>
    </div>
  );
}

/** Things to look for when checking an entry yourself (LanguageTool off). */
const SELF_CHECK = ["diary.self1", "diary.self2", "diary.self3", "diary.self4"] as const;

function Composer({ freeOpen, checker, onSaved }: { freeOpen: boolean; checker: boolean; onSaved: (e: DiaryEntry) => void }) {
  const t = useT();
  const [skipped, setSkipped] = useState<number[]>([]);
  // Before all 20: a random open prompt. After: free writing unless the reader picks a prompt.
  const [promptId, setPromptId] = useState<number | null>(() => (freeOpen ? null : E.nextPrompt(diaryRecord(), Math.random()).id));
  const [english, setEnglish] = useState(false);
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [mistakes, setMistakes] = useState<Mistake[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const dict = useStore((s) => s.dictionary);

  const suggester = useMemo(() => {
    const d = dictionaryData();
    if (!d) return null;
    return buildSuggester({
      lemmas: Object.keys(d.lemmas),
      forms: d.forms,
      article: (w) => d.lemmas[w]?.[1] ?? null,
      known: { has: (w) => Boolean(getState().wordbook[w]) },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dict]);

  const prompt = promptById(promptId);
  const free = freeOpen || promptId == null;
  const min = free ? E.DIARY.minWordsFree : E.DIARY.minWordsPrompt;
  const words = E.countWords(text);
  const typing = wordAtCaret(text, caret).word;
  const suggestions: Suggestion[] = suggester && typing.length >= 2 ? suggester.suggest(typing) : [];

  // After a suggestion, the caret goes right after the word, before the next key can be typed (so no rAF delay).
  const pendingCaret = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (pendingCaret.current == null || !area.current) return;
    area.current.focus();
    area.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  });
  const setAt = (next: string, at: number) => {
    pendingCaret.current = at;
    setText(next);
    setCaret(at);
  };

  const skip = () => {
    if (promptId == null) return;
    const s = [...skipped, promptId];
    setSkipped(s);
    setPromptId(E.nextPrompt(diaryRecord(), Math.random(), s).id);
    setEnglish(false);
  };

  const check = async () => {
    setChecking(true);
    setProblem(null);
    const r = await checkDutch(text);
    setChecking(false);
    if (r.ok) setMistakes(r.mistakes);
    else
      setProblem(
        r.reason === "offline" ? t("diary.offline") : r.reason === "busy" ? t("diary.busy") : t("diary.unavailable"),
      );
  };

  const save = async () => {
    setBusy(true);
    const entry = await addEntry({ promptId, text: text.trim() });
    await diaryEntrySaved({ promptId, words });
    setBusy(false);
    onSaved(entry);
  };

  return (
    <section className="panel diary">
      {freeOpen && (
        <label className="field">
          <span>{t("diary.writeAbout")}</span>
          <select value={promptId ?? ""} onChange={(e) => (setPromptId(e.target.value ? Number(e.target.value) : null), setEnglish(false))}>
            <option value="">{t("diary.anything")}</option>
            {E.DIARY_PROMPTS.map((p) => <option key={p.id} value={p.id}>{p.id}. {p.nl}</option>)}
          </select>
        </label>
      )}
      {prompt && (
        <div className="diaryprompt">
          <span className="label">{freeOpen ? t("diary.promptN", { n: prompt.id }) : t("diary.thisWeek")}</span>
          <p className="q" lang="nl">{prompt.nl}</p>
          {english && <p className="small muted">{t(promptKey(prompt.id))}</p>}
          <div className="actions">
            <button className="btn small ghost" type="button" aria-pressed={english} onClick={() => setEnglish(!english)}>{english ? t("diary.hideTranslation") : t("diary.showTranslation")}</button>
            {!freeOpen && <button className="btn small ghost" type="button" onClick={skip}>{t("diary.skip")}</button>}
          </div>
        </div>
      )}
      <label className="field">
        <span className="sr-only">Your entry</span>
        <textarea
          ref={area}
          lang="nl"
          rows={8}
          spellCheck
          autoCorrect="off"
          autoCapitalize="sentences"
          dir="ltr"
          placeholder={t("diary.placeholder")}
          aria-label={t("diary.entry")}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setCaret(e.target.selectionStart ?? e.target.value.length);
            if (mistakes) setMistakes(null); // the places no longer match: check again
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
        />
      </label>
      {suggestions.length > 0 && (
        <div className="suggestions" role="group" aria-label={t("diary.suggestions")}>
          {suggestions.map((s) => (
            <button key={s.word} type="button" lang="nl" onMouseDown={(e) => e.preventDefault()} onClick={() => {
              const r = applySuggestion(text, caret, s.word);
              setAt(r.text, r.caret);
            }}>
              {s.article && <span className="art">{s.article}</span>}{s.word}
            </button>
          ))}
        </div>
      )}
      <p className="small muted num" aria-live="polite">
        {t("common.words", { n: words })}{words < min ? ` · ${t("diary.moreToSave", { n: min - words })}` : ""}
      </p>

      {mistakes && (
        <div className="mistakes" aria-live="polite">
          {mistakes.length === 0 ? (
            <p>{t.rich("diary.noMistakes")}</p>
          ) : (
            <>
              <p className="marked" lang="nl">{marked(text, mistakes)}</p>
              <ol>
                {mistakes.map((m, i) => (
                  <li key={`${m.offset}-${i}`} className={`k-${m.kind}`}>
                    <span className="chip">{t(`diary.kind.${m.kind}`)}</span> <s lang="nl">{m.text}</s>
                    <div className="small">{m.message}</div>
                    <div className="actions">
                      {m.fixes.map((f) => (
                        <button key={f} className="btn small" type="button" lang="nl" onClick={() => {
                          const r = applyFix(text, mistakes, i, f);
                          setText(r.text);
                          setMistakes(r.mistakes);
                        }}>{f}</button>
                      ))}
                      <button className="btn small ghost" type="button" onClick={() => setMistakes(mistakes.filter((_, j) => j !== i))}>{t("diary.keepMine")}</button>
                    </div>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      )}
      {problem && <p className="error" role="alert">{problem}</p>}

      <div className="actions">
        {checker && <button className="btn" type="button" disabled={!words || checking} onClick={() => void check()}>{checking ? t("diary.checking") : mistakes ? t("diary.checkAgain") : t("diary.check")}</button>}
        <button className="btn primary" type="button" disabled={busy || words < min} onClick={() => void save()}>{t("diary.save")}</button>
      </div>
      {!checker && (
        <details className="selfcheck">
          <summary className="small">{t("diary.selfCheck")}</summary>
          <ul className="small">{SELF_CHECK.map((k) => <li key={k}>{t(k)}</li>)}</ul>
        </details>
      )}
    </section>
  );
}

/** The text with each mistake marked, so the reader sees where it is. */
function marked(text: string, mistakes: readonly Mistake[]) {
  const out: ReactNode[] = [];
  let at = 0;
  mistakes.forEach((m, i) => {
    if (m.offset < at) return;
    out.push(text.slice(at, m.offset));
    out.push(<mark key={i} className={`k-${m.kind}`}>{text.slice(m.offset, m.offset + m.length)}</mark>);
    at = m.offset + m.length;
  });
  out.push(text.slice(at));
  return out;
}

function PastEntries({ entries, onDelete }: { entries: DiaryEntry[] | null; onDelete: (id: string) => void }) {
  const t = useT();
  const [sure, setSure] = useState<string | null>(null);
  if (!entries?.length) return null;
  return (
    <section className="panel">
      <h2>{t("diary.onPhone")}</h2>
      <p className="small muted">{t("diary.onPhoneLead")}</p>
      {entries.map((e) => (
        <details key={e.id} className="entry">
          <summary>
            <span className="num small">{t.date(e.at, DATE)}</span> {promptById(e.promptId) ? <span lang="nl">{promptById(e.promptId)!.nl}</span> : <span>{t("diary.free")}</span>}
          </summary>
          <p className="entrytext" lang="nl">{e.text}</p>
          {sure === e.id ? (
            <div className="actions">
              <button className="btn small danger" type="button" onClick={() => (setSure(null), onDelete(e.id))}>{t("diary.deleteForGood")}</button>
              <button className="btn small ghost" type="button" onClick={() => setSure(null)}>{t("diary.keepIt")}</button>
            </div>
          ) : (
            <button className="btn small ghost" type="button" onClick={() => setSure(e.id)}>{t("diary.delete")}</button>
          )}
        </details>
      ))}
    </section>
  );
}
