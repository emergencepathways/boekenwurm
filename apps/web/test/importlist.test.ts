// Importing word lists: pasted text, CSV/TSV, Excel and Anki decks, read on the device. Words here are ordinary Dutch,
// and every file is built by the test itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import JSZip from "jszip";
import initSqlJs from "sql.js";
import {
  ankiText, cleanWord, guessColumns, parseText, readApkg, readXlsx, sheetRows, sourceOf, splitDelimited, toRows, toWordList, usable,
} from "../src/lib/importlist.ts";

const WORDS = new Set(["hond", "huis", "lopen", "boek", "fiets", "kaas", "wassen", "op", "tijd", "lezen"]);
const FORMS: Record<string, string> = { liep: "lopen", honden: "hond", huizen: "huis" };
const lang = { isDutch: (w: string) => WORDS.has(w) || w in FORMS, baseForm: (w: string) => FORMS[w] ?? w };

test("pasted text: one word per line, tabs, semicolons, or 'word = meaning'", () => {
  assert.deepEqual(parseText("hond\nhuis\n\nlopen\n").rows, [["hond"], ["huis"], ["lopen"]]);
  assert.deepEqual(parseText("hond\tdog\nhuis\thouse").rows, [["hond", "dog"], ["huis", "house"]]);
  assert.deepEqual(parseText("hond;dog\nhuis;house").rows, [["hond", "dog"], ["huis", "house"]]);
  assert.deepEqual(parseText("de hond = the dog\nlopen = to walk, to run").rows, [["de hond", "the dog"], ["lopen", "to walk, to run"]]);
  assert.deepEqual(parseText("lopen - to walk\nhuis - house").rows, [["lopen", "to walk"], ["huis", "house"]]);
});

test("a comma inside a meaning doesn't split a pasted line; CSV quotes do the work", () => {
  assert.deepEqual(parseText("lopen = to walk, to run\nhuis = house").rows[0], ["lopen", "to walk, to run"]);
  assert.deepEqual(splitDelimited('woord,meaning\nlopen,"to walk, to run"\n"zeggen ""hallo""",to say hi\r\n', ","), [
    ["woord", "meaning"], ["lopen", "to walk, to run"], ['zeggen "hallo"', "to say hi"],
  ]);
});

test("a Dutch cell to its base form: articles, plurals in brackets, zich, inflected forms", () => {
  assert.deepEqual(cleanWord("de hond (honden)", lang), { lemma: "hond", article: "de", phrase: false });
  assert.deepEqual(cleanWord("Het huis", lang), { lemma: "huis", article: "het", phrase: false });
  assert.deepEqual(cleanWord("zich wassen", lang), { lemma: "wassen", article: null, phrase: false });
  assert.deepEqual(cleanWord("liep", lang), { lemma: "lopen", article: null, phrase: false }, "an inflected form becomes its base form");
  assert.deepEqual(cleanWord("lopen, liep, gelopen", lang), { lemma: "lopen", article: null, phrase: false });
  assert.deepEqual(cleanWord("op tijd", lang), { lemma: "op tijd", article: null, phrase: true });
});

test("the Dutch column and the header row are found; the reader can change both", () => {
  const t = parseText("English\tDutch\ndog\thond\nhouse\thuis\nbook\tboek\nto read\tlezen");
  assert.deepEqual(guessColumns(t, lang), { word: 1, meaning: 0, header: true });
  const plain = parseText("hond\tdog\nhuis\thouse\nfiets\tbicycle");
  assert.deepEqual(guessColumns(plain, lang), { word: 0, meaning: 1, header: false });
});

test("phrases and repeats start unticked; the ticked rows make the list", () => {
  const t = parseText("de hond\tdog\nhonden\tdogs\nop tijd\ton time\nhet huis\thouse\n\t(empty)");
  const rows = toRows(t, { word: 0, meaning: 1, header: false }, lang);
  assert.deepEqual(rows.map(usable), [true, false, false, true, false]);
  const list = toWordList("Hoofdstuk 1", "paste", rows, (i) => usable(rows[i]));
  assert.deepEqual(list.entries, { hond: { gloss: "dog", article: "de", chapter: null }, huis: { gloss: "house", article: "het", chapter: null } });
  assert.throws(() => toWordList("x", "paste", rows, () => false), /No words/);
});

test("file types by name", () => {
  assert.deepEqual(["a.txt", "b.CSV", "c.tsv", "d.xlsx", "e.apkg", "f.json", "g.pdf"].map(sourceOf), ["text", "csv", "csv", "excel", "anki", "json", null]);
});

test("Excel: shared strings, inline strings, numbers, gaps between cells, a chosen sheet", async () => {
  const zip = new JSZip();
  zip.file("xl/workbook.xml", '<workbook><sheets><sheet name="Woorden" sheetId="1" r:id="rId1"/><sheet name="Extra &amp; meer" sheetId="2" r:id="rId2"/></sheets></workbook>');
  zip.file("xl/_rels/workbook.xml.rels", '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>');
  zip.file("xl/sharedStrings.xml", '<sst><si><t>hond</t></si><si><r><t>the </t></r><r><t>dog</t></r></si><si><t>huis</t><rPh><t>x</t></rPh></si></sst>');
  zip.file("xl/worksheets/sheet1.xml", '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>7</v></c><c r="C2" t="inlineStr"><is><t>house &amp; home</t></is></c></row><row r="3"/></sheetData></worksheet>');
  zip.file("xl/worksheets/sheet2.xml", '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>fiets</t></is></c></row></sheetData></worksheet>');
  const bytes = await zip.generateAsync({ type: "uint8array" });
  const t = await readXlsx(bytes, JSZip);
  assert.deepEqual(t.sheets, ["Woorden", "Extra & meer"]);
  assert.deepEqual(t.rows, [["hond", "", "the dog"], ["huis", "7", "house & home"]]);
  assert.deepEqual((await readXlsx(bytes, JSZip, 1)).rows, [["fiets"]]);
  assert.deepEqual(sheetRows('<row><c r="B1" t="str"><v>lezen</v></c></row>', []), [["", "lezen"]]);
});

const require = createRequire(import.meta.url);
const SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) });

test("Anki deck: the main note type's fields, HTML and sound tags removed", async () => {
  const db = new SQL.Database();
  db.run("create table col (models text); create table notes (id integer, mid integer, flds text)");
  db.run("insert into col values (?)", [JSON.stringify({ 1: { flds: [{ name: "Nederlands", ord: 0 }, { name: "Engels", ord: 1 }] }, 2: { flds: [{ name: "Text", ord: 0 }] } })]);
  db.run("insert into notes values (1, 1, ?), (2, 1, ?), (3, 2, ?)", ["de <b>hond</b>[sound:hond.mp3]\x1fthe dog", "het huis\x1fhouse<br>home", "{{c1::lopen}}"]);
  const zip = new JSZip();
  zip.file("collection.anki2", db.export());
  zip.file("media", "{}");
  const t = await readApkg(await zip.generateAsync({ type: "uint8array" }), { JSZip, SQL, zstd: () => { throw new Error("not used"); } });
  assert.deepEqual(t.names, ["Nederlands", "Engels"]);
  assert.deepEqual(t.rows, [["de hond", "the dog"], ["het huis", "house home"]]);
  assert.equal(ankiText("{{c1::lopen::to walk}} &amp; meer&nbsp;"), "lopen & meer");
});

test("Anki: a newer export's compressed collection is read; a file without one is refused", async () => {
  const db = new SQL.Database();
  db.run("create table notes (id integer, mid integer, flds text); create table fields (ntid integer, ord integer, name text)");
  db.run("insert into fields values (5, 1, 'Back'), (5, 0, 'Front')");
  db.run("insert into notes values (1, 5, ?)", ["fiets\x1fbicycle"]);
  const zip = new JSZip();
  zip.file("collection.anki21b", db.export()); // "compressed" by the identity function below
  const t = await readApkg(await zip.generateAsync({ type: "uint8array" }), { JSZip, SQL, zstd: (b) => b });
  assert.deepEqual([t.names, t.rows], [["Front", "Back"], [["fiets", "bicycle"]]]);
  const empty = new JSZip();
  empty.file("readme.txt", "hallo");
  await assert.rejects(readApkg(await empty.generateAsync({ type: "uint8array" }), { JSZip, SQL, zstd: (b) => b }), /Anki deck/);
});
