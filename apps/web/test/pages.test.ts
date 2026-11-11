// Photographed pages: numbered by capture order from the first page, typed numbers carried forward, retakes in place,
// sections of 20, reading position kept. Page text here is invented for the tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  arrange, differs, flags, keepEarlierOrder, keepPosition, nextPage, nextSection, numberPages, SECTION_SIZE, stitchBook, type PageEntry,
} from "../src/lib/pages.ts";

const range = { firstPage: 7, lastPage: 212 };
/** A photo taken `seq`-th, on which the number `seen` was read (null: none could be read). */
const entry = (seq: number, seen: number | null, text = `Tekst van foto ${seq} met genoeg woorden.`, o: Partial<PageEntry> = {}): PageEntry => ({
  seq, section: 1, status: "done", problems: [], uncertain: [], by: "device",
  page: { seq, pageNumber: seen, paragraphs: [text], startsMidParagraph: false, endsMidParagraph: false }, ...o,
});
const order = (es: PageEntry[]) => arrange(es, range).map((p) => `${p.entry.seq}:${p.pageNumber}`);

test("first page 7: photos are pages 7, 8, 9… in the order taken, whatever number is read on them", () => {
  assert.deepEqual(order([entry(0, 7), entry(1, null), entry(2, 3), entry(3, 88)]), ["0:7", "1:8", "2:9", "3:10"]);
});

test("each page shows the number read from its photo next to its page number", () => {
  const p = arrange([entry(0, 7), entry(1, null), entry(2, 12)], range);
  assert.deepEqual(p.map((x) => [x.pageNumber, x.seen]), [[7, 7], [8, null], [9, 12]]);
});

test("a number read differently is flagged; no number, or a reading outside the book, is not", () => {
  const p = arrange([entry(0, 7), entry(1, null), entry(2, 12), entry(3, 1), entry(4, 990)], range);
  assert.deepEqual(p.map((x) => differs(x, range)), [false, false, true, false, false]);
  assert.match(flags(p[2], p, range).join(" "), /In order this is page 9, but the photo seems to show page 12/);
});

test("changing a number: it is kept, and the photos after it follow (a skipped page fixed in one edit)", () => {
  // Pages 7, 8, then page 9 was skipped: the third photo is really page 10.
  const es = [entry(0, 7), entry(1, 8), entry(2, 10, undefined, { manualPage: 10 }), entry(3, 11), entry(4, 12)];
  assert.deepEqual(order(es), ["0:7", "1:8", "2:10", "3:11", "4:12"]);
  assert.equal(flags(arrange(es, range)[3], arrange(es, range), range).length, 0, "the pages after it now agree");
});

test("a changed number reorders the book: pages taken out of order move to their place", () => {
  // Taken 7, 9, 8, 10: in order they are 7, 8, 9, 10, but the photos show 9 and 8.
  const es = [entry(0, 7), entry(1, 9), entry(2, 8), entry(3, 10)];
  assert.deepEqual(order(es), ["0:7", "1:8", "2:9", "3:10"]);
  const one = es.map((e) => (e.seq === 1 ? { ...e, manualPage: 9 } : e));
  assert.deepEqual(order(one), ["0:7", "1:9", "2:10", "3:11"], "the photos after it follow");
  const both = one.map((e) => (e.seq === 2 ? { ...e, manualPage: 8 } : e));
  assert.deepEqual(order(both), ["0:7", "2:8", "1:9", "3:10"], "typing 8 back doesn't pull the next photo back to 9");
  assert.deepEqual(stitchBook(both, range).map((p) => p.pageNumber), [7, 8, 9, 10]);
});

test("a number the reader typed stays as typed when an earlier number changes", () => {
  const es = [entry(0, 7), entry(1, 8), entry(2, 20, undefined, { manualPage: 20 }), entry(3, 21)];
  const earlier = es.map((e) => (e.seq === 1 ? { ...e, manualPage: 15 } : e));
  assert.deepEqual(order(earlier), ["0:7", "1:15", "2:20", "3:21"]);
});

test("keeping the number in order settles the difference without fixing the number", () => {
  const es = [entry(0, 7), entry(1, 12, undefined, { keepOrder: true }), entry(2, 9)];
  const p = arrange(es, range);
  assert.equal(differs(p[1], range), false);
  assert.deepEqual(order(es), ["0:7", "1:8", "2:9"]);
});

test("a retake keeps its slot, so its number and place, even when the new photo shows another number", () => {
  const blurry = entry(1, null, "", { status: "check", page: null, problems: ["Retake the photo."] });
  const before = [entry(0, 7), blurry, entry(2, 9)];
  assert.deepEqual(order(before), ["0:7", "1:8", "2:9"]);
  const after = before.map((e) => (e.seq === 1 ? entry(1, 3, "De herkansing van pagina acht, goed leesbaar.") : e));
  assert.deepEqual(order(after), ["0:7", "1:8", "2:9"]);
  assert.deepEqual(stitchBook(after, range).map((p) => p.pageNumber), [7, 8, 9]);
});

test("removing a photo: the photos after it move up one page", () => {
  assert.deepEqual(order([entry(0, 7), entry(2, 9), entry(3, 10)]), ["0:7", "2:8", "3:9"]);
});

test("flags: unreadable, outside the chosen pages, photographed twice, words to check", () => {
  const es = [
    entry(0, 7), entry(1, 8), entry(2, 8, undefined, { manualPage: 8 }), entry(3, 9, undefined, { uncertain: ["hiutje"] }),
    entry(4, null, "", { status: "failed", page: null, problems: ["Couldn't reach Claude."] }), entry(5, null, undefined, { manualPage: 300 }),
  ];
  const placed = arrange(es, range);
  const f = (seq: number) => flags(placed.find((p) => p.entry.seq === seq)!, placed, range).join(" ");
  assert.equal(f(1), "");
  assert.match(f(2), /Page 8 was photographed twice; this later photo is left out/);
  assert.match(f(3), /A word was hard to read/);
  assert.match(f(4), /Couldn't reach Claude/);
  assert.match(f(5), /Page 300 is after the last page \(212\)/);
});

test("sections of 20: a new section carries on after the furthest page so far", () => {
  assert.equal(SECTION_SIZE, 20);
  assert.equal(nextSection([]), 1);
  assert.equal(nextSection([entry(0, 7), entry(1, 8, undefined, { section: 2 })]), 3);
  const es = [entry(0, 7), entry(1, 30, undefined, { manualPage: 30 }), entry(2, 8, undefined, { manualPage: 8 }), entry(3, null, undefined, { section: 2 })];
  assert.equal(numberPages(es, range).get(3), 31, "section 2 starts after page 30, not after the last photo (8)");
  assert.equal(numberPages([entry(0, 7), entry(1, 8, undefined, { section: 2 })], range).get(1), 8);
  assert.equal(nextPage(es, range), 32);
  assert.equal(nextPage([], range), 7);
});

test("a book photographed before this rule keeps its order: differing old numbers are kept as typed", () => {
  // Placed by the numbers read: taken 7, 12, 8, 9 (12 out of order) and one without a number after 9.
  const es = [entry(0, 7), entry(1, 12), entry(2, 8), entry(3, 9), entry(4, null)];
  const kept = keepEarlierOrder(es, range);
  assert.deepEqual(order(kept), ["0:7", "2:8", "3:9", "4:10", "1:12"]);
  assert.deepEqual(kept.map((e) => e.manualPage ?? null), [null, 12, 8, 9, 10], "photos whose number would change keep theirs");
  assert.deepEqual(keepEarlierOrder([entry(0, 7), entry(1, 8), entry(2, null)], range).map((e) => e.manualPage ?? null), [null, null, null],
    "a book already in capture order is left alone");
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
