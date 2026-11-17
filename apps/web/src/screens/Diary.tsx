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
import { plural } from "../ui.tsx";

const promptById = (id: number | null) => E.DIARY_PROMPTS.find((p) => p.id === id) ?? null;
const dateOf = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

export function Diary() {
  useStore((s) => s.profile.progress.play); // the record changes when an entry counts
  const record = diaryRecord();
  const today = todayLocal();
  const freeOpen = E.freeWritingOpen(record);
  const doneToday = E.wroteToday(record, today);
  const [anyway, setAnyway] = useState(false);
  const [entries, setEntries] = useState<DiaryEntry[] | null>(null);
  const [saved, setSaved] = useState<DiaryEntry | null>(null);
  useEffect(() => void loadEntries().then(setEntries), []);

  return (
    <>
      <section className="panel">
        <h2>Diary</h2>
        <p>
          {freeOpen
            ? "All 20 prompts written: free writing is open. Write anything you like, once a day, for 600 XP, or answer a prompt again."
            : "Write a few sentences in Dutch about a prompt. One entry a day counts; a new prompt waits each week."}
        </p>
        <div className="xpbar" role="progressbar" aria-label="Diary prompts written" aria-valuemin={0} aria-valuemax={20} aria-valuenow={record.done.length}>
          <i style={{ width: `${(record.done.length / 20) * 100}%` }} />
        </div>
        <p className="small muted num">{record.done.length} / 20 prompts written</p>
        <p className="small privacy">🔒 Your diary is saved only on this phone. Boekenwurm never sees or stores it. “Check my writing” sends the text to LanguageTool (an EU service) to find mistakes, and only when you tap it.</p>
      </section>

      {saved ? (
        <section className="panel">
          <h2>Saved</h2>
          {promptById(saved.promptId) && <p lang="nl"><b>{promptById(saved.promptId)!.nl}</b></p>}
          <p className="entrytext" lang="nl">{saved.text}</p>
          <p className="small muted">Saved on this phone. Want to keep it somewhere else too? Copy it into your own notes.</p>
          <button className="btn" type="button" onClick={() => setSaved(null)}>Done</button>
        </section>
      ) : doneToday && !anyway ? (
        <section className="panel">
          <h2>Today's entry is written</h2>
          <p>Goed gedaan! Come back tomorrow{freeOpen ? " to write again" : " for the next prompt"}.</p>
          <button className="btn ghost" type="button" onClick={() => setAnyway(true)}>Write more today (no XP)</button>
        </section>
      ) : (
        <Composer
          key={record.done.length}
          freeOpen={freeOpen}
          extra={doneToday}
          onSaved={async (e) => {
            setSaved(e);
            setAnyway(false);
            setEntries(await loadEntries());
          }}
        />
      )}

      <Reminders />

      <PastEntries entries={entries} onDelete={async (id) => (await deleteEntry(id), setEntries(await loadEntries()))} />
    </>
  );
}

function Composer({ freeOpen, extra, onSaved }: { freeOpen: boolean; extra: boolean; onSaved: (e: DiaryEntry) => void }) {
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
  const min = extra ? 1 : free ? E.DIARY.minWordsFree : E.DIARY.minWordsPrompt;
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
        r.reason === "offline" ? "You're offline. Check again when you're back online." : r.reason === "busy" ? "The checker is busy. Try again in a minute." : "The checker couldn't be reached. Try again later; your text is still here.",
      );
  };

  const save = async () => {
    setBusy(true);
    const entry = await addEntry({ promptId, text: text.trim() });
    if (!extra) await diaryEntrySaved({ promptId, words });
    setBusy(false);
    onSaved(entry);
  };

  return (
    <section className="panel diary">
      {freeOpen && (
        <label className="field">
          <span>Write about</span>
          <select value={promptId ?? ""} onChange={(e) => (setPromptId(e.target.value ? Number(e.target.value) : null), setEnglish(false))}>
            <option value="">Anything you like (free writing)</option>
            {E.DIARY_PROMPTS.map((p) => <option key={p.id} value={p.id}>{p.id}. {p.nl}</option>)}
          </select>
        </label>
      )}
      {prompt && (
        <div className="diaryprompt">
          <span className="label">{freeOpen ? `Prompt ${prompt.id}` : "This week's prompt"}</span>
          <p className="q" lang="nl">{prompt.nl}</p>
          {english && <p className="small muted">{prompt.en}</p>}
          <div className="actions">
            <button className="btn small ghost" type="button" aria-pressed={english} onClick={() => setEnglish(!english)}>{english ? "Hide English" : "Show in English"}</button>
            {!freeOpen && <button className="btn small ghost" type="button" onClick={skip}>Skip: another prompt</button>}
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
          placeholder="Schrijf hier…"
          aria-label="Your entry, in Dutch"
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
        <div className="suggestions" role="group" aria-label="Word suggestions">
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
        {plural(words, "word")}{!extra && words < min ? ` · ${min - words} more to save` : ""}
      </p>

      {mistakes && (
        <div className="mistakes" aria-live="polite">
          {mistakes.length === 0 ? (
            <p><b>No mistakes found.</b> Goed gedaan!</p>
          ) : (
            <>
              <p className="marked" lang="nl">{marked(text, mistakes)}</p>
              <ol>
                {mistakes.map((m, i) => (
                  <li key={`${m.offset}-${i}`} className={`k-${m.kind}`}>
                    <span className="chip">{m.kind}</span> <s lang="nl">{m.text}</s>
                    <div className="small">{m.message}</div>
                    <div className="actions">
                      {m.fixes.map((f) => (
                        <button key={f} className="btn small" type="button" lang="nl" onClick={() => {
                          const r = applyFix(text, mistakes, i, f);
                          setText(r.text);
                          setMistakes(r.mistakes);
                        }}>{f}</button>
                      ))}
                      <button className="btn small ghost" type="button" onClick={() => setMistakes(mistakes.filter((_, j) => j !== i))}>Keep mine</button>
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
        <button className="btn" type="button" disabled={!words || checking} onClick={() => void check()}>{checking ? "Checking…" : mistakes ? "Check again" : "Check my writing"}</button>
        <button className="btn primary" type="button" disabled={busy || words < min} onClick={() => void save()}>Save entry</button>
      </div>
      {extra && <p className="small muted">Today's entry already counted, so this one earns no XP.</p>}
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
  const [sure, setSure] = useState<string | null>(null);
  if (!entries?.length) return null;
  return (
    <section className="panel">
      <h2>On this phone</h2>
      <p className="small muted">Your entries, newest first. Only here: not in your account, not on your other devices.</p>
      {entries.map((e) => (
        <details key={e.id} className="entry">
          <summary>
            <span className="num small">{dateOf(e.at)}</span> <span lang="nl">{promptById(e.promptId)?.nl ?? "Free writing"}</span>
          </summary>
          <p className="entrytext" lang="nl">{e.text}</p>
          {sure === e.id ? (
            <div className="actions">
              <button className="btn small danger" type="button" onClick={() => (setSure(null), onDelete(e.id))}>Delete for good</button>
              <button className="btn small ghost" type="button" onClick={() => setSure(null)}>Keep it</button>
            </div>
          ) : (
            <button className="btn small ghost" type="button" onClick={() => setSure(e.id)}>Delete…</button>
          )}
        </details>
      ))}
    </section>
  );
}
