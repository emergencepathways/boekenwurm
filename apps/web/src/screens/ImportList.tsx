/**
 * Importing a word list: paste it, or pick a text, CSV, Excel or Anki file, or wordlist.json from the textbook tool.
 * The reader checks which column holds the Dutch words, unticks rows they don't want, names the list, and saves it.
 * Nothing leaves the device (lib/importlist.ts).
 */
import { useMemo, useState } from "react";
import { saveWordList } from "../lib/store.ts";
import { baseForm, isDutchWord, parseWordList } from "../lib/words.ts";
import {
  guessColumns, listName, parseText, readApkg, readXlsx, sourceOf, toRows, toWordList, usable, type Table,
} from "../lib/importlist.ts";
import type { WordListSource } from "../lib/types.ts";
import { close, setTab } from "../nav.ts";
import { Icon, plural, toast } from "../ui.tsx";

const LANG = { isDutch: isDutchWord, baseForm };
const PREVIEW = 200;

interface Loaded {
  table: Table;
  source: WordListSource;
  name: string;
  /** Excel: the file, to read another sheet. */
  file?: File;
}

async function readFile(file: File): Promise<Loaded | "saved"> {
  const kind = sourceOf(file.name);
  const name = listName(file.name);
  if (kind === "json") {
    // wordlist.json from the textbook tool: already a list.
    const list = parseWordList(name, await file.text());
    await saveWordList({ ...list, source: "textbook" });
    toast(`Added ${Object.keys(list.entries).length.toLocaleString()} words.`);
    return "saved";
  }
  if (kind === "excel") {
    const { default: JSZip } = await import("jszip");
    return { table: await readXlsx(await file.arrayBuffer(), JSZip), source: "excel", name, file };
  }
  if (kind === "anki") {
    const [{ default: JSZip }, { default: initSqlJs }, { decompress }, { default: wasm }] = await Promise.all([
      import("jszip"), import("sql.js"), import("fzstd"), import("sql.js/dist/sql-wasm.wasm?url"),
    ]);
    const SQL = await initSqlJs({ locateFile: () => wasm });
    return { table: await readApkg(await file.arrayBuffer(), { JSZip, SQL, zstd: (b) => decompress(b) }), source: "anki", name };
  }
  if (kind === "text" || kind === "csv" || file.type.startsWith("text/")) return { table: parseText(await file.text()), source: kind === "csv" ? "csv" : "text", name };
  throw new Error("Boekenwurm can read .txt, .csv, .tsv, .xlsx (Excel), .apkg (Anki) and wordlist.json files.");
}

export function ImportList() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // setTab closes this screen too (one step back in the history).
  const done = () => setTab("words");

  const pickFile = async (file: File) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await readFile(file);
      if (r === "saved") return done();
      if (!r.table.rows.length) throw new Error("No words found in this file.");
      setLoaded(r);
    } catch (x) {
      setErr((x as Error).message || "This file couldn't be read.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="screen">
      <div className="topbar">
        <button className="back" type="button" onClick={() => (loaded ? setLoaded(null) : close())}><Icon.back /> {loaded ? "Back" : "Words"}</button>
      </div>
      <h1>Import a word list</h1>
      {loaded ? (
        <Preview loaded={loaded} onSheet={async (i) => {
          const { default: JSZip } = await import("jszip");
          setLoaded({ ...loaded, table: await readXlsx(await loaded.file!.arrayBuffer(), JSZip, i) });
        }} onSaved={done} />
      ) : (
        <>
          <section className="panel">
            <h2>Paste it</h2>
            <p>One word per line, or a word and its meaning on each line: copied from a spreadsheet, or typed as <span lang="nl">de hond = the dog</span>.</p>
            <textarea rows={7} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={"de hond = the dog\nlopen = to walk\nhet huis = the house"} aria-label="Words to import" lang="nl" />
            <button className="btn primary" type="button" disabled={!paste.trim()} onClick={() => {
              const table = parseText(paste);
              if (table.rows.length) setLoaded({ table, source: "paste", name: "" });
            }}>Continue</button>
          </section>

          <section className="panel">
            <h2>Or choose a file</h2>
            <ul className="small muted plainlist">
              <li><b>Text or CSV</b> (.txt, .csv, .tsv): one word per line, or columns.</li>
              <li><b>Excel</b> (.xlsx): any sheet; you pick the columns next.</li>
              <li><b>Anki deck</b> (.apkg): exported from Anki (File → Export → Anki Deck Package).</li>
              <li><b>wordlist.json</b> from the Boekenwurm textbook tool.</li>
            </ul>
            <label className={`btn${busy ? " busy" : ""}`} style={{ position: "relative" }}>
              {busy ? "Reading…" : "Choose a file…"}
              <input type="file" accept=".txt,.csv,.tsv,.xlsx,.apkg,.json,text/plain,text/csv" disabled={busy} style={{ position: "absolute", inset: 0, opacity: 0 }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void pickFile(f);
                }} />
            </label>
          </section>
          {err && <p className="error" role="alert">{err}</p>}
          <p className="note">
            Import lists you're allowed to use: your course's list, your teacher's, or a deck you made or downloaded for yourself. Imported
            lists stay on this device; Boekenwurm never uploads or shares them.
          </p>
        </>
      )}
    </main>
  );
}

function Preview({ loaded, onSheet, onSaved }: { loaded: Loaded; onSheet: (i: number) => Promise<void>; onSaved: () => void }) {
  const { table } = loaded;
  const guess = useMemo(() => guessColumns(table, LANG), [table]);
  const [word, setWord] = useState(guess.word);
  const [meaning, setMeaning] = useState<number | null>(guess.meaning);
  const [header, setHeader] = useState(guess.header);
  const [name, setName] = useState(loaded.name);
  const [unticked, setUnticked] = useState<Set<number> | null>(null);
  const [all, setAll] = useState(false);
  const [sheet, setSheet] = useState(0);

  const rows = useMemo(() => toRows(table, { word, meaning, header }, LANG), [table, word, meaning, header]);
  // Ticked by default: single words seen for the first time. The reader can tick or untick any row with a word.
  const off = unticked ?? new Set(rows.flatMap((r, i) => (usable(r) ? [] : [i])));
  const ticked = (i: number) => rows[i].lemma !== "" && !off.has(i);
  const count = rows.filter((_, i) => ticked(i)).length;
  const phrases = rows.filter((r) => r.phrase).length;
  const repeats = rows.filter((r) => r.duplicate).length;
  const width = Math.max(1, ...table.rows.map((r) => r.length));
  const colName = (i: number) => (table.names?.[i] ? table.names[i] : header && table.rows[0]?.[i] ? table.rows[0][i] : `Column ${i + 1}`);

  const toggle = (i: number) => {
    const next = new Set(off);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    setUnticked(next);
  };
  const reset = () => setUnticked(null);

  const save = async () => {
    try {
      const list = toWordList(name || loaded.name, loaded.source, rows, ticked);
      await saveWordList(list);
      toast(`Added “${list.name}”: ${Object.keys(list.entries).length.toLocaleString()} words.`);
      onSaved();
    } catch (x) {
      toast((x as Error).message);
    }
  };

  return (
    <>
      <section className="panel">
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Chapter 3, Mijn Anki-woorden…" />
        </label>
        {table.sheets && table.sheets.length > 1 && (
          <label className="field">
            <span>Sheet</span>
            <select value={sheet} onChange={(e) => { const i = Number(e.target.value); setSheet(i); reset(); void onSheet(i); }}>
              {table.sheets.map((s, i) => <option key={i} value={i}>{s}</option>)}
            </select>
          </label>
        )}
        <div className="row2">
          <label className="field">
            <span>Dutch words</span>
            <select value={word} onChange={(e) => (setWord(Number(e.target.value)), reset())}>
              {Array.from({ length: width }, (_, i) => <option key={i} value={i}>{colName(i)}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Meanings</span>
            <select value={meaning ?? -1} onChange={(e) => setMeaning(Number(e.target.value) < 0 ? null : Number(e.target.value))}>
              <option value={-1}>None</option>
              {Array.from({ length: width }, (_, i) => i).filter((i) => i !== word).map((i) => <option key={i} value={i}>{colName(i)}</option>)}
            </select>
          </label>
        </div>
        {!table.names && (
          <label className="row">
            <input type="checkbox" checked={header} onChange={(e) => (setHeader(e.target.checked), reset())} />
            The first row names the columns
          </label>
        )}
        <p className="small">
          <b className="num">{count.toLocaleString()}</b> {count === 1 ? "word" : "words"} ticked
          {phrases ? ` · ${plural(phrases, "phrase")} unticked (reading counts single words, so phrases can't be followed yet)` : ""}
          {repeats ? ` · ${plural(repeats, "repeat")} unticked` : ""}.
        </p>
        <div className="actions">
          <button className="btn small ghost" type="button" onClick={() => setUnticked(new Set())}>Tick all</button>
          <button className="btn small ghost" type="button" onClick={() => setUnticked(new Set(rows.map((_, i) => i)))}>Untick all</button>
        </div>
      </section>

      <section className="panel">
        <table className="preview">
          <thead><tr><th aria-label="Keep" /><th>Dutch</th><th>Meaning</th></tr></thead>
          <tbody>
            {rows.slice(0, all ? rows.length : PREVIEW).map((r, i) => (
              <tr key={i} className={ticked(i) ? "" : "off"}>
                <td><input type="checkbox" checked={ticked(i)} disabled={!r.lemma} onChange={() => toggle(i)} aria-label={`Keep ${r.lemma || "row " + (i + 1)}`} /></td>
                <td lang="nl">
                  {r.article ? <span className="muted">{r.article} </span> : null}{r.lemma || <span className="muted">(no word)</span>}
                  {r.source && r.source.toLowerCase() !== `${r.article ? r.article + " " : ""}${r.lemma}` && <span className="small muted"> · {r.source}</span>}
                  {r.phrase && <span className="chip">phrase</span>}{r.duplicate && <span className="chip">repeat</span>}
                </td>
                <td>{r.gloss ?? <span className="muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!all && rows.length > PREVIEW && <button className="btn small ghost" type="button" onClick={() => setAll(true)}>Show all {rows.length.toLocaleString()} rows</button>}
      </section>

      <button className="btn primary block" type="button" disabled={!count} onClick={() => void save()}>Add {plural(count, "word")}</button>
    </>
  );
}
