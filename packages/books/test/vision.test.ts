// Pages read by Google Cloud Vision: the page number vs a chapter number, page edges for stitching. Invented text.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pageFromVision, type VisionParagraph } from "../src/vision.ts";
import { stitch } from "../src/stitch.ts";

const P = (text: string, y0: number, y1 = y0 + 40, confidence = 0.97, unsure: string[] = []): VisionParagraph => ({ text, box: { x0: 80, y0, x1: 620, y1 }, confidence, unsure });
const page = (...paragraphs: VisionParagraph[]) => ({ width: 700, height: 1000, paragraphs });

test("a number alone at the foot of the page is the page number, and not text", () => {
  const r = pageFromVision(page(P("Het was nog vroeg toen Lotte opstond.", 120), P("14", 950, 975)), 0);
  assert.equal(r.page.pageNumber, 14);
  assert.deepEqual(r.page.paragraphs, ["Het was nog vroeg toen Lotte opstond."]);
});

test("decorated numbers count, at the head when there is none at the foot", () => {
  assert.equal(pageFromVision(page(P("— 27 —", 20, 50), P("Tekst van de pagina.", 200)), 0).page.pageNumber, 27);
});

test("a chapter number further down stays in the text; the page number at the foot still wins", () => {
  const r = pageFromVision(page(P("3", 260, 330), P("Het regende al de hele ochtend in de stad.", 380), P("41", 950, 975)), 0);
  assert.equal(r.page.pageNumber, 41);
  assert.deepEqual(r.page.paragraphs, ["3", "Het regende al de hele ochtend in de stad."]);
});

test("a chapter's first page with only a chapter number and no page number: no page number", () => {
  const r = pageFromVision(page(P("7", 200, 280), P("De zomer begon dat jaar heel vroeg.", 400)), 0);
  assert.equal(r.page.pageNumber, null);
  assert.deepEqual(r.page.paragraphs, ["7", "De zomer begon dat jaar heel vroeg."]);
});

test("a number outside the book's pages isn't taken as the page number, but is still left out", () => {
  const r = pageFromVision(page(P("Tekst.", 200), P("9999", 960, 980)), 0, { lastPage: 212 });
  assert.equal(r.page.pageNumber, null);
  assert.deepEqual(r.page.paragraphs, ["Tekst."]);
});

test("page edges: lower case at the top continues the page before; no full stop or a hyphen at the end runs on", () => {
  const a = pageFromVision(page(P("Het was nog vroeg en Lotte fietste naar het sta-", 120), P("12", 950, 975)), 0);
  assert.equal(a.page.endsMidParagraph, true);
  assert.equal(a.page.endsWithHyphen, true);
  const b = pageFromVision(page(P("tion, waar de trein al klaarstond.", 120), P("Ze stapte in.", 300), P("13", 950, 975)), 1);
  assert.equal(b.page.startsMidParagraph, true);
  assert.equal(b.page.endsMidParagraph, false);
  const s = stitch([a.page, b.page]);
  assert.deepEqual(s.paragraphs.map((p) => p.text), ["Het was nog vroeg en Lotte fietste naar het station, waar de trein al klaarstond.", "Ze stapte in."]);
});

test("words Vision was unsure of are listed, and quality follows its confidence", () => {
  const r = pageFromVision(page(P("De vuurtoren stond aan zee.", 100, 140, 0.5, ["vuurtoren"]), P("Alles was rustig.", 200, 240, 1)), 0);
  assert.deepEqual(r.uncertain, ["vuurtoren"]);
  assert.ok(r.quality > 0.5 && r.quality < 1);
  assert.equal(pageFromVision(page(), 0).quality, 0);
});
