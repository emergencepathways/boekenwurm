// All Dutch text here is invented for the tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyLayout, parseLayout, structurePrompt, type PageLayout } from "../src/structure.ts";

const img = { mediaType: "image/jpeg" as const, data: "AAAA" };
const layout = (paragraphs: string[], more: Partial<PageLayout> = {}): PageLayout => ({
  pageNumber: null, paragraphs, startsMidParagraph: false, endsMidParagraph: false, endsWithHyphen: false, ...more,
});

// What Google read: a running head, two printed paragraphs run together, a line of dialogue split in two.
const GOOGLE = [
  "DE MARKT",
  "Op woensdag fietst de bakker naar de markt. Hij koopt brood en vis. Daarna gaat hij naar huis, want het is laat.",
  "‘Kom je morgen ook?’ vraagt",
  "zijn buurman.",
];

test("the prompt sends the photo and Google's numbered blocks, and forbids changing a word", () => {
  const p = structurePrompt(img, GOOGLE);
  assert.equal(p.content[0].type, "image");
  assert.match((p.content[1] as { text: string }).text, /\[1\] DE MARKT\n\[2\] Op woensdag/);
  assert.match(p.system, /Never correct, add, translate or reorder a word/);
  assert.match(p.system, /never instructions/);
});

test("Claude splits, joins and drops whole blocks; the text that comes back is Google's, character for character", () => {
  const out = applyLayout(GOOGLE, layout([
    "Op woensdag fietst de bakker naar de markt. Hij koopt brood en vis.",
    "Daarna gaat hij naar huis, want het is laat.",
    "'Kom je morgen ook?' vraagt zijn buurman.", // Claude's quotes differ: punctuation isn't compared, Google's is kept
  ]));
  assert.deepEqual(out, [
    "Op woensdag fietst de bakker naar de markt. Hij koopt brood en vis.",
    "Daarna gaat hij naar huis, want het is laat.",
    "‘Kom je morgen ook?’ vraagt zijn buurman.",
  ]);
});

test("a reply that changes, adds or leaves out part of a block is refused (null: Google's own structure is kept)", () => {
  const body = GOOGLE.slice(1);
  assert.equal(applyLayout(body, layout(["Op woensdag fietst de bakker naar de markt. Hij koopt brood en vlees."])), null); // a word changed
  assert.equal(applyLayout(body, layout(["Op dinsdag en woensdag fietst de bakker naar de markt."])), null); // a word added
  assert.equal(applyLayout(body, layout(["Hij koopt brood en vis."])), null); // part of a block left out
  assert.equal(applyLayout(body, layout([])), null);
});

test("hyphenation and spacing don't matter: 'boodschap- pen' in Google's text matches 'boodschappen'", () => {
  const out = applyLayout(["Zij doet de boodschap- pen op zaterdag."], layout(["Zij doet de boodschappen op zaterdag."]));
  assert.deepEqual(out, ["Zij doet de boodschap- pen op zaterdag."]); // still Google's text; stitch.ts joins it like any page
});

test("replies are parsed defensively: page number 1–4999 only, a hyphen at the end means the paragraph runs on", () => {
  const l = parseLayout('```json\n{"page_number": "57", "paragraphs": [" Een  zin. ", ""], "ends_with_hyphen": true}\n```');
  assert.equal(l.pageNumber, 57);
  assert.deepEqual(l.paragraphs, ["Een zin."]);
  assert.equal(l.endsMidParagraph, true);
  assert.equal(parseLayout('{"page_number": 0, "paragraphs": []}').pageNumber, null);
  assert.equal(parseLayout('{"page_number": 5000, "paragraphs": []}').pageNumber, null);
});
