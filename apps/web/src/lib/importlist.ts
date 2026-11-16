/**
 * Importing a word list: pasted text, a .txt / .csv / .tsv file, an Excel workbook (.xlsx), an Anki deck (.apkg),
 * or wordlist.json from the textbook tool. Everything is read on the device; nothing is uploaded. Lists the reader
 * imports are theirs to use: a deck or a course list may be someone else's work, so imported lists are never shared.
 *
 * Every format becomes a table (rows of cells). The reader then picks the column with the Dutch words and, if there is
 * one, the column with meanings, and unticks rows they don't want. Pure, apart from the readers of zipped formats,
 * which take their libraries as arguments (so the tests run under Node).
 */
import type JSZipType from "jszip";
import type { SqlJsStatic } from "sql.js";
import type { WordList, WordListSource } from "./types.ts";

export interface Table {
  /** Column names when the source has them (an Anki note type, a header row the reader keeps), else null. */
  names: string[] | null;
  rows: string[][];
  /** The workbook's sheets (Excel), so the reader can pick another. */
  sheets?: string[];
}

// ---------------------------------------------------------------- text, CSV, TSV

const DELIMITERS = ["\t", ";", ",", "|"] as const;
/** Separators people type between a word and its meaning in a pasted list: "de hond = the dog", "lopen – to walk". */
const TYPED_SEPARATORS = [" = ", " – ", " — ", " - ", ": "] as const;

/** Split CSV-style text (quotes, doubled quotes, line breaks inside quotes) on one delimiter. */
export function splitDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell.trim() === "") (quoted = true), (cell = "");
    else if (ch === delimiter) row.push(cell), (cell = "");
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      (row = []), (cell = "");
    } else cell += ch;
  }
  if (cell !== "" || row.length) row.push(cell), rows.push(row);
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ""));
}

/**
 * Text in any of the usual shapes: one word per line, tab-separated (copied from a spreadsheet), CSV with commas or
 * semicolons, or "word = meaning" lines. The separator found on most lines wins.
 */
export function parseText(text: string): Table {
  const clean = text.replace(/^﻿/, "");
  const lines = clean.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { names: null, rows: [] };
  const share = (test: (l: string) => boolean) => lines.filter(test).length / lines.length;
  // Commas are common inside meanings ("to walk, to run"), so a comma counts only when most lines have one.
  for (const d of DELIMITERS) if (share((l) => l.includes(d)) >= (d === "," ? 0.8 : 0.6)) return { names: null, rows: splitDelimited(clean, d) };
  for (const sep of TYPED_SEPARATORS)
    if (share((l) => l.includes(sep)) >= 0.6)
      return {
        names: null,
        rows: lines.map((l) => {
          const at = l.indexOf(sep);
          return at < 0 ? [l.trim()] : [l.slice(0, at).trim(), l.slice(at + sep.length).trim()];
        }),
      };
  return { names: null, rows: lines.map((l) => [l.trim()]) };
}

// ---------------------------------------------------------------- Excel (.xlsx)

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export const decodeEntities = (s: string): string =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (XML_ENTITIES[e.toLowerCase()] ?? m),
  );

/** The text of every <t> in a piece of XML (rich text has several runs; phonetic hints, <rPh>, are left out). */
const texts = (xml: string): string =>
  decodeEntities([...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(""));

/** "B12" -> column index 1. */
const columnOf = (ref: string): number => [...ref.replace(/\d+/g, "")].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/** One worksheet's XML to rows, with the workbook's shared strings. */
export function sheetRows(xml: string, shared: readonly string[]): string[][] {
  const rows: string[][] = [];
  for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1];
      const body = c[2] ?? "";
      const ref = /\br="([A-Z]+)\d+"/.exec(attrs)?.[1];
      const type = /\bt="(\w+)"/.exec(attrs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      const value = type === "s" ? (shared[Number(v)] ?? "") : type === "inlineStr" ? texts(body) : decodeEntities(v ?? "");
      row[ref ? columnOf(ref) : row.length] = value;
    }
    rows.push(Array.from(row, (x) => (x ?? "").trim()));
  }
  return rows.filter((r) => r.some((x) => x !== ""));
}

/** An Excel workbook: the sheet asked for (by index), or the first. */
export async function readXlsx(data: ArrayBuffer | Uint8Array, JSZip: typeof JSZipType, sheet = 0): Promise<Table> {
  const zip = await JSZip.loadAsync(data);
  const read = (p: string) => zip.file(p)?.async("string") ?? Promise.resolve(null);
  const workbook = await read("xl/workbook.xml");
  if (!workbook) throw new Error("This doesn't look like an Excel workbook (.xlsx).");
  const rels = (await read("xl/_rels/workbook.xml.rels")) ?? "";
  const target: Record<string, string> = {};
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[0])?.[1];
    const t = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
    if (id && t) target[id] = t.startsWith("/") ? t.slice(1) : `xl/${t}`;
  }
  const sheets = [...workbook.matchAll(/<sheet\b[^>]*>/g)].map((m) => ({
    name: decodeEntities(/\bname="([^"]*)"/.exec(m[0])?.[1] ?? "Sheet"),
    path: target[/\br:id="([^"]+)"/.exec(m[0])?.[1] ?? ""] ?? null,
  }));
  const pick = sheets[sheet] ?? sheets[0];
  const sharedXml = (await read("xl/sharedStrings.xml")) ?? "";
  const shared = [...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]));
  const xml = (pick?.path && (await read(pick.path))) || (await read("xl/worksheets/sheet1.xml"));
  if (!xml) throw new Error("This workbook has no sheet to read.");
  return { names: null, rows: sheetRows(xml, shared), sheets: sheets.map((s) => s.name) };
}

// ---------------------------------------------------------------- Anki (.apkg)

/** An Anki field as plain text: no HTML, no [sound:…] tags, no cloze markup. */
export function ankiText(field: string): string {
  return decodeEntities(
    field
      .replace(/\[sound:[^\]]*\]/g, "")
      .replace(/\{\{c\d+::(.*?)(?:::[^}]*)?\}\}/g, "$1")
      .replace(/<br\s*\/?>|<\/div>|<\/p>/gi, " ")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\s+/g, " ")
    .trim();
}

export interface AnkiLibraries {
  JSZip: typeof JSZipType;
  /** sql.js, already initialised with its wasm. */
  SQL: SqlJsStatic;
  /** Decompresses the zstd collection of newer Anki exports (collection.anki21b). */
  zstd: (data: Uint8Array) => Uint8Array;
}

/**
 * An Anki deck export. The notes of the most common note type become the rows, its field names the columns. Newer
 * exports (Anki 2.1.50+) keep the collection zstd-compressed as collection.anki21b; older ones as .anki21 or .anki2.
 */
export async function readApkg(data: ArrayBuffer | Uint8Array, lib: AnkiLibraries): Promise<Table> {
  const zip = await lib.JSZip.loadAsync(data);
  let bytes: Uint8Array | null = null;
  const b = zip.file("collection.anki21b");
  if (b) bytes = lib.zstd(await b.async("uint8array"));
  else bytes = (await (zip.file("collection.anki21") ?? zip.file("collection.anki2"))?.async("uint8array")) ?? null;
  if (!bytes) throw new Error("This doesn't look like an Anki deck (.apkg).");
  const db = new lib.SQL.Database(bytes);
  try {
    const notes = (db.exec("select mid, flds from notes")[0]?.values ?? []) as Array<[number | string, string]>;
    if (!notes.length) throw new Error("This deck has no cards.");
    const count = new Map<string, number>();
    for (const [mid] of notes) count.set(String(mid), (count.get(String(mid)) ?? 0) + 1);
    const main = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const rows = notes.filter(([mid]) => String(mid) === main).map(([, flds]) => flds.split("\x1f").map(ankiText));
    return { names: ankiFieldNames(db, main), rows: rows.filter((r) => r.some((x) => x)) };
  } finally {
    db.close();
  }
}

function ankiFieldNames(db: InstanceType<SqlJsStatic["Database"]>, mid: string): string[] | null {
  try {
    // Newer collections: a fields table.
    const r = db.exec(`select name from fields where ntid = ${Number(mid)} order by ord`)[0];
    if (r?.values.length) return r.values.map((v) => String(v[0]));
  } catch {
    /* an older collection: no fields table */
  }
  try {
    const models = JSON.parse(String(db.exec("select models from col")[0]?.values[0]?.[0] ?? "{}")) as Record<string, { flds?: Array<{ name: string; ord: number }> }>;
    const flds = models[mid]?.flds;
    return flds ? [...flds].sort((a, b) => a.ord - b.ord).map((f) => f.name) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- from a table to a list

export interface Language {
  /** Does the dictionary know this (base form or inflected form)? */
  isDutch: (word: string) => boolean;
  /** A word's base form: liep -> lopen. */
  baseForm: (word: string) => string;
}

export interface Row {
  /** The cell as written. */
  source: string;
  /** The base form the list keeps ("hond"), or "" when the row has no word. */
  lemma: string;
  article: "de" | "het" | null;
  gloss: string | null;
  /** More than one word ("op tijd"): reading counts single words, so a phrase can't be tracked yet. */
  phrase: boolean;
  /** The same word appeared on an earlier row. */
  duplicate: boolean;
}

/**
 * One Dutch cell to a base form: "de hond (honden)" -> hond, de; "het huis" -> huis, het; "zich wassen" -> wassen;
 * "Lopen!" -> lopen.
 */
export function cleanWord(cell: string, lang: Language): { lemma: string; article: "de" | "het" | null; phrase: boolean } {
  let s = cell.replace(/\s*[([{].*?[)\]}]\s*/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  let article: "de" | "het" | null = null;
  const a = /^(de|het|'t)\s+(.+)$/.exec(s);
  if (a) (article = a[1] === "de" ? "de" : "het"), (s = a[2]);
  s = s.replace(/^(een|zich)\s+/, "").replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
  // "de/het" alternatives or "lopen, liep, gelopen": the first is the word.
  s = s.split(/\s*[,/;]\s*/)[0] ?? "";
  const phrase = /\s/.test(s);
  if (!s) return { lemma: "", article, phrase: false };
  return { lemma: phrase ? s : lang.baseForm(s), article, phrase };
}

/** The column most of whose cells are Dutch words; the meaning column is the fullest of the others, if any. */
export function guessColumns(table: Table, lang: Language): { word: number; meaning: number | null; header: boolean } {
  const width = Math.max(0, ...table.rows.map((r) => r.length));
  const sample = table.rows.slice(1, 301);
  const dutch = (c: number) => sample.filter((r) => r[c] && lang.isDutch(cleanWord(r[c], lang).lemma)).length;
  const filled = (c: number) => sample.filter((r) => r[c]).length;
  const cols = Array.from({ length: width }, (_, i) => i);
  const word = cols.reduce((best, c) => (dutch(c) > dutch(best) ? c : best), 0);
  const others = cols.filter((c) => c !== word && filled(c) > 0);
  const meaning = others.length ? others.reduce((best, c) => (filled(c) - dutch(c) > filled(best) - dutch(best) ? c : best), others[0]) : null;
  // A header row: its word cell isn't Dutch while the rest of the column mostly is, or it names the columns.
  const first = table.rows[0] ?? [];
  const named = /^(dutch|nederlands|nl|word|woord|words|woorden|term|front|voorkant|english|engels|meaning|betekenis|translation|vertaling|back)$/i;
  const header = table.names == null && first.length > 0 && (first.some((c) => named.test(c.trim())) || (!lang.isDutch(cleanWord(first[word] ?? "", lang).lemma) && dutch(word) > sample.length / 2));
  return { word, meaning, header };
}

/** The table's rows as list rows, with the reader's column choice. */
export function toRows(table: Table, pick: { word: number; meaning: number | null; header: boolean }, lang: Language): Row[] {
  const seen = new Set<string>();
  return table.rows.slice(pick.header ? 1 : 0).map((r) => {
    const source = r[pick.word] ?? "";
    const w = cleanWord(source, lang);
    const duplicate = w.lemma !== "" && seen.has(w.lemma);
    if (w.lemma) seen.add(w.lemma);
    const gloss = pick.meaning != null ? (r[pick.meaning] ?? "").trim() || null : null;
    return { source, lemma: w.lemma, article: w.article, gloss, phrase: w.phrase, duplicate };
  });
}

/** Is a row ticked by default: a single word, not seen before. */
export const usable = (r: Row): boolean => r.lemma !== "" && !r.phrase && !r.duplicate;

/** The ticked rows as a word list. */
export function toWordList(name: string, source: WordListSource, rows: readonly Row[], ticked: (i: number) => boolean): WordList {
  const entries: WordList["entries"] = {};
  rows.forEach((r, i) => {
    if (!ticked(i) || !r.lemma || entries[r.lemma]) return;
    entries[r.lemma] = { gloss: r.gloss, article: r.article, chapter: null };
  });
  if (!Object.keys(entries).length) throw new Error("No words are ticked.");
  return { name: name.trim() || "My word list", source, entries };
}

/** What kind of file this is, from its name. */
export function sourceOf(fileName: string): WordListSource | "json" | null {
  const ext = /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toLowerCase();
  if (ext === "txt") return "text";
  if (ext === "csv" || ext === "tsv") return "csv";
  if (ext === "xlsx") return "excel";
  if (ext === "apkg" || ext === "colpkg") return "anki";
  if (ext === "json") return "json";
  return null;
}

/** A file's name without its extension, as the list's starting name. */
export const listName = (fileName: string): string => fileName.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim();
