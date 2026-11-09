// Recognised lines here are invented for the tests, shaped like Tesseract.js output.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pageFromOcr, tidy, type OcrLine } from "../src/ocr.ts";
import { stitch } from "../src/stitch.ts";

let y = 0;
const ln = (text: string, opts: { x?: number; conf?: number; low?: string[]; gap?: number } = {}): OcrLine => {
  y += opts.gap ?? 40;
  const words = text.split(" ").map((w) => ({ text: w, confidence: opts.low?.includes(w) ? 41 : opts.conf ?? 93 }));
  return { text, bbox: { x0: opts.x ?? 100, y0: y, x1: 900, y1: y + 30 }, confidence: opts.conf ?? 92, words };
};

test("a photographed page becomes paragraphs, with the printed page number and continuation flags", () => {
  y = 0;
  const lines = [
    ln("Op zaterdag gaat Sanne met de fiets naar", { x: 140 }),
    ln("de markt in het centrum van de stad."),
    ln("Daar koopt ze kaas, brood en een bos", { x: 140 }),
    ln("bloemen voor haar moeder, want die is", {}),
    ln("morgen jarig en houdt van boodschap-"),
    ln("57", { x: 480, gap: 90 }),
  ];
  const r = pageFromOcr(lines, 0);
  assert.equal(r.page.pageNumber, 57);
  assert.deepEqual(r.page.paragraphs, [
    "Op zaterdag gaat Sanne met de fiets naar de markt in het centrum van de stad.",
    "Daar koopt ze kaas, brood en een bos bloemen voor haar moeder, want die is morgen jarig en houdt van boodschap-",
  ]);
  assert.equal(r.page.endsWithHyphen, true);
  assert.equal(r.page.endsMidParagraph, true);
  assert.equal(r.quality, 1);
});

test("words recognised with low confidence are listed for the reader to check", () => {
  y = 0;
  const r = pageFromOcr([ln("De kaasboer verkoopt jonge en oude kaas.", { x: 140, low: ["kaasboer", "oude"] })], 3);
  assert.deepEqual(r.uncertain, ["kaasboer", "oude"]);
  assert.ok(r.quality < 0.8);
});

test("free-mode pages stitch across a page break like Claude-read pages", () => {
  y = 0;
  const a = pageFromOcr([ln("Ze doet de boodschap-", { x: 140 }), ln("12", { x: 480, gap: 90 })], 0);
  y = 0;
  const b = pageFromOcr([ln("pen op zaterdag en fietst naar huis."), ln("13", { x: 480, gap: 90 })], 1);
  assert.equal(b.page.startsMidParagraph, true);
  assert.deepEqual(stitch([a.page, b.page]).paragraphs.map((p) => p.text), ["Ze doet de boodschappen op zaterdag en fietst naar huis."]);
});

test("unreadable lines are dropped and common recognition slips tidied", () => {
  y = 0;
  const r = pageFromOcr([ln("~~ ||| ..", { conf: 12 }), ln("Een zin , met „rare” tekens .", { x: 140 })], 0);
  assert.deepEqual(r.page.paragraphs, ['Een zin, met "rare" tekens.']);
  assert.equal(tidy("Hij kwam - zo zei ze - te laat."), "Hij kwam - zo zei ze - te laat.");
  assert.equal(tidy("Het IJsselmeer is groot ."), "Het IJsselmeer is groot.");
});
