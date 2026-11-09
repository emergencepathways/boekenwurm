// All text here is invented for the tests. The PDF test builds its own PDF with pdf-lib.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { joinLines, linesFromItems, paragraphsFromLines, readPdf, runningHeads, type Line, type TextItem } from "../src/pdf.ts";
import { stitch } from "../src/stitch.ts";

const line = (text: string, y: number, x = 72, size = 11): Line => ({ text, x, y, size, right: x + text.length * 5 });

test("items on one baseline become one line, left to right, with spaces where there are gaps", () => {
  const items: TextItem[] = [
    { str: "markt.", x: 150, y: 700, size: 11, width: 30 },
    { str: "Sanne gaat naar de", x: 72, y: 700.4, size: 11, width: 76 },
    { str: "Volgende regel", x: 72, y: 686, size: 11, width: 60 },
  ];
  assert.deepEqual(linesFromItems(items).map((l) => l.text), ["Sanne gaat naar de markt.", "Volgende regel"]);
});

test("hyphens at line ends are joined, real compounds and capitals are kept", () => {
  assert.equal(joinLines(["Ze doet de boodschap-", "pen op zaterdag."]), "Ze doet de boodschappen op zaterdag.");
  assert.equal(joinLines(["Ze woont in Noord-", "Holland."]), "Ze woont in Noord- Holland.");
});

test("paragraphs split at indents and larger gaps; page number and running head are dropped", () => {
  const lines = [
    line("Mijn verhalenboek", 790), line("Sanne gaat op zaterdag met de fiets", 740, 90), line("naar de markt in de stad.", 726),
    line("Daar koopt ze kaas en brood en praat ze", 712, 90), line("met de man van de kaaskraam.", 698),
    line("Na een uur fietst ze weer naar huis", 670), line("omdat het begint te regenen en", 656), line("42", 60),
  ];
  const p = paragraphsFromLines(lines, new Set(["mijn verhalenboek"]));
  assert.equal(p.pageNumber, 42);
  assert.deepEqual(p.paragraphs, [
    "Sanne gaat op zaterdag met de fiets naar de markt in de stad.",
    "Daar koopt ze kaas en brood en praat ze met de man van de kaaskraam.",
    "Na een uur fietst ze weer naar huis omdat het begint te regenen en",
  ]);
  assert.equal(p.startsMidParagraph, false);
  assert.equal(p.endsMidParagraph, true);
});

test("running heads are the lines repeated at the edges of many pages", () => {
  const pages = Array.from({ length: 6 }, (_, i) => [line("Hoofdstuk 3", 790), line(`Tekst op pagina ${i}.`, 700), line(String(i + 10), 60)]);
  const heads = runningHeads(pages);
  assert.ok(heads.has("hoofdstuk #"));
  assert.ok(!heads.has("#")); // page numbers are handled separately, never as a running head
});

// Integration: a real PDF made with pdf-lib, read with pdf.js. Skipped when the libraries aren't installed.
const require = createRequire(import.meta.url);
function load(name: string): string | null {
  for (const base of [process.env.BOEKENWURM_NODE_MODULES, `${process.env.HOME}/.npm-global/lib/node_modules`, undefined]) {
    try { return require.resolve(base ? `${base}/${name}` : name); } catch { /* next */ }
  }
  return null;
}
const pdfLibPath = load("pdf-lib");
const pdfjsPath = load("pdfjs-dist/legacy/build/pdf.mjs");

test("a two-page PDF becomes stitched paragraphs; a paragraph crossing the page break is joined", { skip: !(pdfLibPath && pdfjsPath) && "pdf-lib or pdfjs-dist not installed" }, async () => {
  const { PDFDocument, StandardFonts } = require(pdfLibPath!);
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const pages = [
    ["  Op zaterdag gaat Sanne met de fiets naar de", "markt in het centrum van de stad.", "  Daar koopt ze kaas en brood, en praat ze met", "de man van de kaaskraam over het weer en"],
    ["de prijzen van dit jaar, die flink gestegen zijn.", "  Na een uur fietst ze weer naar huis, omdat", "het begint te regenen."],
  ];
  pages.forEach((lines, pi) => {
    const page = doc.addPage([420, 595]);
    page.drawText("Een verzonnen verhaal", { x: 60, y: 560, size: 9, font });
    lines.forEach((l, i) => {
      const indent = l.startsWith("  ");
      page.drawText(l.trim(), { x: indent ? 75 : 60, y: 520 - i * 15, size: 11, font });
    });
    page.drawText(String(pi + 7), { x: 205, y: 30, size: 9, font });
  });
  // a third page repeating the head makes it a running head (needs 3 pages)
  const p3 = doc.addPage([420, 595]);
  p3.drawText("Een verzonnen verhaal", { x: 60, y: 560, size: 9, font });
  p3.drawText("Het einde van het verhaal is hier.", { x: 75, y: 520, size: 11, font });
  p3.drawText("9", { x: 205, y: 30, size: 9, font });
  const bytes = await doc.save();

  const pdfjs = await import(pdfjsPath!);
  const r = await readPdf(pdfjs, new Uint8Array(bytes));
  assert.equal(r.isScanned, false);
  assert.deepEqual(r.pages.map((p) => p.pageNumber), [7, 8, 9]);
  const s = stitch(r.pages);
  assert.deepEqual(s.paragraphs.map((p) => p.text), [
    "Op zaterdag gaat Sanne met de fiets naar de markt in het centrum van de stad.",
    "Daar koopt ze kaas en brood, en praat ze met de man van de kaaskraam over het weer en de prijzen van dit jaar, die flink gestegen zijn.",
    "Na een uur fietst ze weer naar huis, omdat het begint te regenen.",
    "Het einde van het verhaal is hier.",
  ]);
  assert.equal(s.paragraphs[1].pageNumber, 7);
});

test("a PDF without a text layer is recognised as scanned", { skip: !(pdfLibPath && pdfjsPath) && "pdf-lib or pdfjs-dist not installed" }, async () => {
  const { PDFDocument } = require(pdfLibPath!);
  const doc = await PDFDocument.create();
  for (let i = 0; i < 3; i++) doc.addPage([420, 595]).drawRectangle({ x: 50, y: 50, width: 300, height: 480 });
  const pdfjs = await import(pdfjsPath!);
  const r = await readPdf(pdfjs, new Uint8Array(await doc.save()));
  assert.equal(r.isScanned, true);
  assert.deepEqual(r.scannedPages, [1, 2, 3]);
});
