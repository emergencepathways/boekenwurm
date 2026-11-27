// End-to-end check of the app gate (docs/APP_GATE.md) in the built app, at phone size, with Supabase unreachable.
// Removed with the gate by scripts/remove-app-gate.sh.
//   npm run build && node test/gate/e2e.mjs [path-to-playwright] [screenshot-dir]
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] || "playwright");
const shots = process.argv[3] || null;
if (shots) mkdirSync(shots, { recursive: true });

const dist = join(here, "..", "..", "dist");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml" };
const server = createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let f = join(dist, p);
  if (!existsSync(f) || statSync(f).isDirectory()) f = join(dist, "index.html");
  res.setHeader("content-type", TYPES[extname(f)] || "application/octet-stream");
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}/`;

let failed = 0;
const ok = (cond, msg) => {
  console.log(`  ${cond ? "ok" : "FAIL"}: ${msg}`);
  if (!cond) failed++;
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: "block" });
let page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
// Every request the page makes: the gated app's name must never be in one (it travels after "#").
const requests = [];
page.on("request", (r) => requests.push(r.url()));
await page.route(/supabase\.co/, (route) => route.abort());
const shot = async (name) => shots && page.screenshot({ path: join(shots, `gate-${name}.png`), fullPage: true });

console.log("app gate");

// ---------------------------------------------------------------- setup: an app and a deck of my own cards
await page.goto(`${base}#gate-setup`);
await page.getByRole("heading", { name: "App gate" }).waitFor();
ok(true, "the setup opens at /#gate-setup, without onboarding");
await page.getByRole("button", { name: "+ TikTok" }).click();
await page.getByText("tiktok://", { exact: true }).waitFor();
ok(true, "TikTok added, with its link");
await page.getByPlaceholder("e.g. Grammar, Capitals, Exam terms").fill("Capitals");
await page.getByRole("button", { name: "Add deck" }).click();
await page.locator("textarea").fill(["Netherlands\tAmsterdam", "Belgium\tBrussels", "France - Paris", "Germany;Berlin", "Spain\tMadrid"].join("\n"));
await page.getByRole("button", { name: "Add 5 cards" }).click();
await page.getByText("5 cards · 5 due").waitFor();
ok(true, "5 cards pasted (tab, dash, semicolon), 5 due");
await shot("setup");

// ---------------------------------------------------------------- the Shortcut sends the reader here
await page.evaluate(() => (location.hash = "#gate=TikTok"));
await page.getByRole("heading", { name: "A pause before TikTok" }).waitFor();
await page.locator(".gate-big", { hasText: "1" }).waitFor();
ok(true, "the gate opens for TikTok and counts the first attempt today");
await shot("start");

// The review's clock is a fake from here, so five minutes pass in a moment.
await page.clock.install();
await page.getByRole("button", { name: /Quick review/ }).click();
await page.getByText("Card 1 of 5").waitFor();
ok(true, "no book here: a round of my cards");
ok(await page.getByRole("group", { name: "Choose the answer" }).locator("button").count() === 4, "multiple choice, four options");

// Answer the five cards: a wrong option first on the first card, then the right one.
const capitals = { Netherlands: "Amsterdam", Belgium: "Brussels", France: "Paris", Germany: "Berlin", Spain: "Madrid" };
for (let i = 0; i < 5; i++) {
  await page.getByText(`Card ${i + 1} of 5`).waitFor();
  const front = (await page.locator(".gate-front").innerText()).trim();
  const answer = capitals[front];
  const options = page.getByRole("group", { name: "Choose the answer" }).locator("button");
  if (i === 0) {
    const texts = await options.allInnerTexts();
    await options.nth(texts.findIndex((t) => t.trim() !== answer)).click();
  }
  await options.filter({ hasText: answer }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
}
ok(true, "five multiple-choice cards answered");

// Nothing more is due: the plain pause. Five minutes of being on screen.
await page.getByText("Nothing to read or review here").waitFor();
ok(!(await page.getByRole("button", { name: "Unlock" }).isVisible()), "no Unlock before the time is up");
await page.clock.runFor(5 * 60_000 + 2000);
await page.getByRole("button", { name: "Unlock" }).waitFor();
ok(true, "after 5 minutes of active time: Unlock");
await shot("ready");
await page.getByRole("button", { name: "Unlock" }).click();
await page.getByRole("heading", { name: "TikTok is free for 15 minutes" }).waitFor();
const href = await page.getByRole("link", { name: "Unlock TikTok" }).getAttribute("href");
ok(href === "shortcuts://run-shortcut?name=Boekenwurm%20Unlock&input=text&text=15%7Ctiktok%3A%2F%2F", `the Unlock Shortcut with 15 minutes and TikTok's link (${href})`);
await shot("done");

// ---------------------------------------------------------------- the counts, and back to the app
await page.getByRole("button", { name: "Back to Boekenwurm" }).click();
await page.waitForFunction(() => location.hash === "");
ok(true, "back to Boekenwurm: the #gate part is gone");
await page.evaluate(() => (location.hash = "#gate-setup"));
const row = page.locator(".gate-table tbody tr", { hasText: "TikTok" });
await row.waitFor();
ok((await row.locator("td").nth(1).innerText()).includes("1 · 1 unlocked"), "today: 1 attempt, 1 unlocked");
const due = await page.locator(".gate-list li", { hasText: "Capitals" }).innerText();
ok(/5 cards · 1 due/.test(due), `right first time leaves the pool; the one missed comes back (${due.trim()})`);

// ---------------------------------------------------------------- reading: the next paragraph of the last book read
// A book of invented sentences, put straight into the device store; the reader's place is at its second paragraph.
const PARAS = [
  "Op maandag fietst Noor naar de bibliotheek in het centrum.",
  "Daar leest zij elke week een nieuw boek over de geschiedenis van de stad en haar oude grachten.",
  "Na het lezen drinkt zij koffie met haar vriendin Mila op het plein.",
];
await page.evaluate(async (paras) => {
  const tokens = (text) => {
    const out = [];
    for (const m of text.matchAll(/(\p{L}+)|([^\p{L}]+)/gu)) out.push({ t: m[0], k: m[1] ? (/^[A-Z]/.test(m[0]) && m.index > 0 ? "name" : "word") : "punct", s: m.index, e: m.index + m[0].length });
    return out;
  };
  const now = Date.now();
  const book = { id: "gate-test-book", source: "epub", title: "Een week in de stad", author: null, isbn: null, level: "A2", levelSource: "reader", scan: null,
    status: "ready", pageCount: null, pagesRead: [], position: { ord: 1, mode: "original", at: now }, paragraphCount: paras.length, coverPath: null,
    hasCover: false, createdAt: now, updatedAt: now, dirty: false, textSynced: true, textRemote: false, nextSeq: 0 };
  const text = { bookId: book.id, paragraphs: paras.map((p) => ({ text: p, tokens: tokens(p), countable: tokens(p).filter((t) => t.k === "word").length, pageNumber: null })) };
  await new Promise((res, rej) => {
    const r = indexedDB.open("boekenwurm-app");
    r.onsuccess = () => {
      const tx = r.result.transaction(["books", "texts"], "readwrite");
      tx.objectStore("books").put(book);
      tx.objectStore("texts").put(text);
      tx.oncomplete = res;
      tx.onerror = rej;
    };
  });
}, PARAS);
// A fresh page: the first one's clock is a fake, and the app's start needs a real one.
await page.close();
page = await ctx.newPage();
page.on("pageerror", (e) => errors.push(String(e)));
page.on("request", (r) => requests.push(r.url()));
await page.goto(`${base}#gate=Instagram`);
await page.getByRole("heading", { name: "A pause before Instagram" }).waitFor();
await page.getByRole("button", { name: /Quick review/ }).click();
await page.getByText("Een week in de stad").waitFor();
const shownText = (await page.locator(".gate-sheet .para").innerText()).replace(/\s+/g, " ").trim();
ok(shownText === PARAS[1], "the paragraph after the reader's place in the book read last");
const next = page.getByRole("button", { name: /Keep reading|Next/ });
ok(await next.isDisabled(), `a reading time first (${(await next.innerText()).trim()})`);
await page.locator(".gate-sheet .para button", { hasText: "geschiedenis" }).click();
await shot("reading");
await page.getByRole("button", { name: "Next", exact: true }).click({ timeout: 20_000 }); // after 120 words a minute
await page.getByText(/Card 1 of/).waitFor();
ok(true, "then a round of cards");
const place = await page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open("boekenwurm-app");
  r.onsuccess = () => {
    const g = r.result.transaction("books").objectStore("books").get("gate-test-book");
    g.onsuccess = () => res(g.result.position.ord);
  };
}));
ok(place === 2, `the reader's place in the book moved on (${place})`);
await page.evaluate(() => (location.hash = "#gate-setup"));
await page.locator(".gate-table tbody tr", { hasText: "Instagram" }).waitFor();
ok(true, "Instagram's attempt counted on its own");

// ---------------------------------------------------------------- privacy
ok(!requests.some((u) => /tiktok/i.test(u)), "no request ever carried the app's name");
const stored = await page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open("boekenwurm-app");
  r.onsuccess = () => {
    const g = r.result.transaction("kv").objectStore("kv").get("appGate");
    g.onsuccess = () => res(g.result);
  };
}));
ok(stored?.settings?.apps?.[0]?.name === "TikTok" && stored.cards.length === 5 && Object.keys(stored.log).length === 1, "apps, counts and cards are kept on the device (IndexedDB)");
await page.getByRole("button", { name: "Delete all app gate data" }).click();
await page.getByRole("button", { name: "Delete", exact: true }).click();
await page.getByText("Nothing yet.").waitFor();
const after = await page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open("boekenwurm-app");
  r.onsuccess = () => {
    const g = r.result.transaction("kv").objectStore("kv").get("appGate");
    g.onsuccess = () => res(g.result ?? null);
  };
}));
ok(after === null, "Delete all app gate data empties it from the device");
ok(!errors.length, `no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);

await browser.close();
server.close();
console.log(failed ? `\n${failed} check(s) failed` : "\nall gate checks passed");
process.exit(failed ? 1 : 0);
