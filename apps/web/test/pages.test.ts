// Photographed pages: order fixed at capture, retakes in place, sections of 20, reading position kept.
// Page text here is invented for the tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { arrange, flags, keepPosition, nextPage, nextSection, SECTION_SIZE, stitchBook, type PageEntry } from "../src/lib/pages.ts";

const range = { firstPage: 9, lastPage: 212 };
const entry = (seq: number, pageNumber: number | null, text = `Tekst van foto ${seq} met genoeg woorden.`, o: Partial<PageEntry> = {}): PageEntry => ({
  seq, section: 1, status: "done", problems: [], uncertain: [], by: "device",
  page: { seq, pageNumber, paragraphs: [text], startsMidParagraph: false, endsMidParagraph: false }, ...o,
});
const order = (es: PageEntry[]) => arrange(es, range).map((p) => `${p.entry.seq}:${p.pageNumber ?? "?"}`);

test("photos are read in page order, whatever order they were taken in", () => {
  assert.deepEqual(order([entry(0, 14), entry(1, 12), entry(2, 13)]), ["1:12", "2:13", "0:14"]);
});

test("a photo without a number takes its place between its neighbours before any review", () => {
  assert.deepEqual(order([entry(0, 11), entry(1, null), entry(2, 13)]), ["0:11", "1:12", "2:13"]);
});

test("a blurry photo keeps its place, and its retake (same slot) goes into that same place", () => {
  const blurry = entry(1, null, "", { status: "check", page: null, problems: ["Retake the photo."] });
  const before = [entry(0, 11), blurry, entry(2, 13)];
  assert.deepEqual(order(before), ["0:11", "1:12", "2:13"]);
  // The retake replaces slot 1; even when the new photo shows no number, it is still page 12.
  const after = before.map((e) => (e.seq === 1 ? entry(1, null, "De herkansing van pagina twaalf, goed leesbaar.") : e));
  assert.deepEqual(order(after), ["0:11", "1:12", "2:13"]);
  assert.deepEqual(stitchBook(after, range).map((p) => p.pageNumber), [11, 12, 13]);
});

test("a typed page number wins over the one read from the photo", () => {
  assert.deepEqual(order([entry(0, 11), entry(1, 21, undefined, { manualPage: 12 })]), ["0:11", "1:12"]);
});

test("flags: unreadable, unnumbered, outside the chosen pages, photographed twice, words to check", () => {
  const es = [
    entry(0, 7), entry(1, 20), entry(2, 20), entry(3, 40, undefined, { uncertain: ["hiutje"] }),
    entry(4, null), entry(5, 99, "", { status: "failed", page: null, problems: ["Couldn't reach Claude."] }),
  ];
  const placed = arrange(es, range);
  const f = (seq: number) => flags(placed.find((p) => p.entry.seq === seq)!, placed, range).join(" ");
  assert.match(f(0), /read as 7, outside pages 9–212/);
  assert.equal(f(1), "");
  assert.match(f(2), /photographed twice/);
  assert.match(f(3), /A word was hard to read/);
  assert.match(f(4) + f(5), /Couldn't reach Claude/);
});

test("sections: each camera visit is a new section of at most 20 photos", () => {
  assert.equal(SECTION_SIZE, 20);
  assert.equal(nextSection([]), 1);
  assert.equal(nextSection([entry(0, 9), entry(1, 10, undefined, { section: 2 })]), 3);
  // The next section starts after the furthest page photographed.
  assert.equal(nextPage([entry(0, 9), entry(1, 10), entry(2, null)], range), 12);
  assert.equal(nextPage([], range), 9);
});

test("the reader stays on the same paragraph when an earlier page arrives later", () => {
  const p = (text: string, pageNumber: number) => ({ text, pageNumber });
  const before = [p("a", 11), p("c", 13), p("d", 13)];
  const after = [p("a", 11), p("b", 12), p("c", 13), p("d", 13)];
  assert.equal(keepPosition(before, 2, after), 3); // was at "d"
  // Read to the end of what was photographed: continue at the first new page.
  assert.equal(keepPosition(before, 3, [...after, p("e", 14)]), 4);
  assert.equal(keepPosition(before, 0, after), 0);
});
