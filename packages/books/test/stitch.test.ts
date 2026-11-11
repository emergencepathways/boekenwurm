// Page text here is invented for the tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bookProgress, placePages, joinAcross, orderPages, pagesFinished, stitch, type PageText } from "../src/stitch.ts";

const page = (seq: number, pageNumber: number | null, paragraphs: string[], o: Partial<PageText> = {}): PageText =>
  ({ seq, pageNumber, paragraphs, startsMidParagraph: false, endsMidParagraph: false, ...o });

test("a paragraph running over a page break is joined, with its starting page kept", () => {
  const r = stitch([
    page(0, 12, ["Eerste alinea.", "Sanne fietst naar de markt en koopt"], { endsMidParagraph: true }),
    page(1, 13, ["kaas en brood voor het ontbijt.", "Een nieuwe alinea."], { startsMidParagraph: true }),
  ]);
  assert.deepEqual(r.paragraphs.map((p) => p.text), [
    "Eerste alinea.", "Sanne fietst naar de markt en koopt kaas en brood voor het ontbijt.", "Een nieuwe alinea.",
  ]);
  assert.equal(r.paragraphs[1].pageNumber, 12);
  assert.deepEqual(r.paragraphs[1].seqs, [0, 1]);
});

test("a word hyphenated across the page break is rejoined", () => {
  const r = stitch([
    page(0, 5, ["Ze doet de boodschap-"], { endsMidParagraph: true, endsWithHyphen: true }),
    page(1, 6, ["pen op zaterdag."], { startsMidParagraph: true }),
  ]);
  assert.equal(r.paragraphs[0].text, "Ze doet de boodschappen op zaterdag.");
  assert.equal(joinAcross("Noord-", "Holland is mooi", true), "Noord-Holland is mooi");
});

test("pages photographed out of order are put back by page number; duplicates are skipped", () => {
  const r = stitch([
    page(0, 21, ["Pagina eenentwintig."]),
    page(1, 20, ["Pagina twintig."]),
    page(2, 21, ["Nog een keer eenentwintig."]),
  ]);
  assert.deepEqual(r.paragraphs.map((p) => p.text), ["Pagina twintig.", "Pagina eenentwintig."]);
  assert.deepEqual(r.duplicates, [2]);
});

test("a missing page is reported, and text is not joined across the gap", () => {
  const r = stitch([
    page(0, 35, ["Het verhaal gaat verder en"], { endsMidParagraph: true }),
    page(1, 37, ["iets heel anders begint."], { startsMidParagraph: true }),
  ]);
  assert.deepEqual(r.gaps, [[35, 37]]);
  assert.equal(r.paragraphs.length, 2);
});

test("unnumbered pages keep their place after the page taken before them", () => {
  const { ordered } = orderPages([page(0, 8, ["a"]), page(1, null, ["b"]), page(2, 9, ["c"])]);
  assert.deepEqual(ordered.map((p) => p.seq), [0, 1, 2]);
});

test("progress through a printed book uses the page count the reader entered", () => {
  assert.deepEqual(bookProgress(200, [1, 2, 3, 3, 250, 0]), { share: 0.015, pagesRead: 3, pageCount: 200, furthestPage: 3 });
  assert.equal(bookProgress(212, []).furthestPage, null);
});

test("a page counts as finished once the reader has moved past its last paragraph", () => {
  const { paragraphs } = stitch([page(0, 1, ["a", "b"]), page(1, 2, ["c", "d"]), page(2, 3, ["e"])]);
  assert.deepEqual(pagesFinished(paragraphs, 1), [1]);
  assert.deepEqual(pagesFinished(paragraphs, 2), [1]);
  assert.deepEqual(pagesFinished(paragraphs, 3), [1, 2]);
});

// ---------------------------------------------------------------- placing photographed pages

const shots = (...ns: Array<number | null>) => ns.map((pageNumber, seq) => ({ seq, pageNumber }));
const placed = (r: ReturnType<typeof placePages>) => r.map((s) => `${s.seq}:${s.pageNumber ?? "?"}${s.guessed ? "~" : ""}`);

test("a photo without a page number between two known pages gets the number in between", () => {
  assert.deepEqual(placed(placePages(shots(11, null, 13))), ["0:11", "1:12~", "2:13"]);
  assert.deepEqual(placed(placePages(shots(11, null, null, 14))), ["0:11", "1:12~", "2:13~", "3:14"]);
});

test("the gap must fit: 11, ?, 15 leaves the photo unnumbered, right after page 11", () => {
  assert.deepEqual(placed(placePages(shots(11, null, 15))), ["0:11", "1:?", "2:15"]);
});

test("photos after the last known page continue in order; photos before the first count back", () => {
  assert.deepEqual(placed(placePages(shots(30, null, null))), ["0:30", "1:31~", "2:32~"]);
  assert.deepEqual(placed(placePages(shots(null, null, 20))), ["0:18~", "1:19~", "2:20"]);
});

test("a filled number never repeats a known page or leaves the chosen pages", () => {
  // 12 and 13 leave no room in between, so the photo taken between them stays unnumbered, after page 12.
  assert.deepEqual(placed(placePages(shots(12, null, 13))), ["0:12", "1:?", "2:13"]);
  // Counting on from 12 would give 13, which another photo already is.
  assert.deepEqual(placed(placePages(shots(12, null, 20, 13))), ["0:12", "1:?", "3:13", "2:20"]);
  assert.deepEqual(placed(placePages(shots(null, 9), { firstPage: 9 })), ["0:?", "1:9"]);
  assert.deepEqual(placed(placePages(shots(212, null), { lastPage: 212 })), ["0:212", "1:?"]);
});

test("pages taken out of order are read in page order; a typed number moves a photo to its place", () => {
  assert.deepEqual(placed(placePages(shots(14, 12, 13))), ["1:12", "2:13", "0:14"]);
  // Photo 1 had no number; once the reader types 15 it moves after page 14.
  assert.deepEqual(placed(placePages([{ seq: 0, pageNumber: 14 }, { seq: 1, pageNumber: 15 }, { seq: 2, pageNumber: 12 }])), ["2:12", "0:14", "1:15"]);
});

test("progress counts only the pages the reader chose: pages 9 to 212 are 204 pages", () => {
  const p = bookProgress(212, [9, 10, 11, 5, 213], 9);
  assert.equal(p.pageCount, 204);
  assert.equal(p.pagesRead, 3);
  assert.equal(p.share, 0.015);
  // Without a first page, reading starts at page 1.
  assert.equal(bookProgress(212, []).pageCount, 212);
});
