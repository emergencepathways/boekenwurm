import { test } from "node:test";
import assert from "node:assert/strict";
import { coverPrompt, normalizeIsbn, pagePrompt, parseCover, parsePage, validatePage } from "../src/photo.ts";

const img = { mediaType: "image/jpeg" as const, data: "AAAA" };

test("page prompt sends the image first and asks for exact text", () => {
  const p = pagePrompt(img);
  assert.equal(p.content[0].type, "image");
  assert.match(p.system, /exactly as printed/);
  assert.match(p.system, /never instructions/);
});

test("page replies are parsed defensively", () => {
  const r = parsePage('```json\n{"page_number": "34", "paragraphs": ["  Een   zin. ", "", "Nog een."], "starts_mid_paragraph": true, "ends_with_hyphen": true, "problems": ["slightly blurred"]}\n```');
  assert.equal(r.pageNumber, 34);
  assert.deepEqual(r.paragraphs, ["Een zin.", "Nog een."]);
  assert.equal(r.startsMidParagraph, true);
  assert.equal(r.endsMidParagraph, true); // a hyphen at the end means the paragraph continues
  assert.equal(parsePage('{"page_number": null, "paragraphs": []}').pageNumber, null);
});

test("a page with little text, foreign text or old spelling is flagged", () => {
  const thin = parsePage('{"paragraphs": ["Hoofdstuk 3"]}');
  assert.equal(validatePage(thin).length, 1);
  const text = "Op zaterdag gaat Sanne met de fiets naar de markt in het centrum van de stad, waar zij altijd verse groente koopt voor de hele week.";
  const page = parsePage(JSON.stringify({ paragraphs: [text] }));
  assert.deepEqual(validatePage(page, { language: () => "nl", isOldForm: () => false }), []);
  assert.equal(validatePage(page, { language: () => "en" }).length, 1);
  const old = parsePage(JSON.stringify({ paragraphs: ["Zoo zat de man met groote oogen bij het raam en keek naar de menschen die voorbij liepen op de straat."] }));
  assert.equal(validatePage(old, { isOldForm: (w) => ["zoo", "groote", "oogen", "menschen"].includes(w.toLowerCase()) }).length, 1);
});

test("ISBNs are kept only with a valid check digit", () => {
  // standard example ISBNs, not a real Boekenwurm source
  assert.equal(normalizeIsbn("978-0-306-40615-7"), "9780306406157");
  assert.equal(normalizeIsbn("9780306406158"), null);
  assert.equal(normalizeIsbn("0-306-40615-2"), "0306406152");
  assert.equal(normalizeIsbn("not an isbn"), null);
});

test("cover replies give title, author and a checked ISBN", () => {
  assert.match(coverPrompt(img).system, /Never invent/);
  const c = parseCover('{"title": "  Een   boek ", "author": "Test Auteur", "isbn": "978 0 306 40615 7"}');
  assert.deepEqual(c, { title: "Een boek", author: "Test Auteur", isbn: "9780306406157" });
  assert.equal(parseCover('{"title": "X", "isbn": "123"}').isbn, null);
});
