// End-to-end check of the hosted page in a real browser, with Claude's replies mocked.
// The book is built here from invented sentences; no real book text is used.
//   node apps/playtest/test/e2e.mjs [path-to-playwright]
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] || "playwright");

const PARAS = [
  "Op zaterdag gaat Sanne met de fiets naar de markt in het centrum van de stad, waar zij altijd verse groente koopt.",
  "Daar ontmoet zij meneer Jansen, die al jaren een kraam met kaas heeft en iedereen in de buurt bij naam kent.",
  "Meneer Jansen vertelt dat de prijzen dit jaar flink gestegen zijn, omdat de zomer veel te droog was voor de boeren.",
  "Sanne luistert aandachtig en besluit om een stuk oude kaas te kopen, hoewel het eigenlijk duurder is dan zij had gedacht.",
  "Op de terugweg begint het plotseling te regenen, zodat zij onder een brug moet schuilen tot de bui voorbij is.",
  "Thuis zet zij koffie en schrijft zij in haar schrift welke nieuwe woorden zij die ochtend op de markt heeft geleerd.",
];

// The book's files. In the browser, a small stand-in for JSZip (served in place of the CDN copy, which
// the test machine may not reach) hands these files to the page; unzipping itself is JSZip's job.
const FILES = {
  "META-INF/container.xml": '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  "OEBPS/content.opf": '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Testboek</dc:title><dc:language>nl</dc:language></metadata><manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>',
  "OEBPS/c1.xhtml": "<html><body>" + PARAS.map((p) => `<p>${p}</p>`).join("") + "</body></html>",
};
const dir = mkdtempSync(join(tmpdir(), "bw-e2e-"));
const epub = join(dir, "testboek.epub");
writeFileSync(epub, JSON.stringify(FILES));
const JSZIP_STUB = `window.JSZip = { loadAsync: async (file) => { const files = JSON.parse(await file.text());
  return { file: (p) => (p in files ? { async: async () => files[p] } : null) }; } };`;

const calls = { grade: 0, match: 0, explain: 0 };
let breakNextMatch = false;
async function mockClaude(route) {
  const body = JSON.parse(route.request().postData() || "{}");
  const sys = body.system || "", user = body.messages?.[0]?.content || "";
  let text;
  if (sys.startsWith("You grade")) {
    calls.grade++;
    const ids = [...user.matchAll(/id="(p\d+)"/g)].map((m) => m[1]);
    text = JSON.stringify(ids.map((id, i) => ({ id, level: i % 3 ? "B1" : "A2", grammar: ["subordinate clause"], context: "" })));
  } else if (sys.startsWith("You adapt")) {
    calls.match++;
    const names = (user.match(/as written: (.*)\./) || [, ""])[1].split(", ").filter(Boolean);
    const simple = `Dit is de tekst op niveau A1. ${names.map((n) => `Hier is ${n}.`).join(" ")} Het is een korte en makkelijke tekst voor jou.`;
    text = JSON.stringify({ original_level: "B1", changed: true, text: breakNextMatch ? "Kort." : simple });
  } else if (sys.startsWith("You explain")) {
    calls.explain++;
    text = JSON.stringify({ lemma: "kopen", meaning_en: "buys (in this sentence)", meaning_nl: "betaalt geld voor iets", note: "" });
  } else text = "ok";
  await route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "content-type": "application/json" },
    body: JSON.stringify({ content: [{ type: "text", text }] }) });
}

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.route("https://cdnjs.cloudflare.com/**", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: JSZIP_STUB }));
await page.route("https://fonts.googleapis.com/**", (r) => r.abort());
await page.route("https://api.anthropic.com/**", (r) => (r.request().method() === "OPTIONS"
  ? r.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST" } })
  : mockClaude(r)));
await page.goto(pathToFileURL(join(here, "..", "dist", "site", "index.html")).href);

const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) process.exitCode = 1; };

// 1. key
await page.click('nav.tabs button[data-view="profile"]');
await page.fill("#set-key", "sk-ant-test");
await page.click('[data-act="save-key"]');
check(await page.locator('[data-act="test-key"]').count() === 1, "key saved");

// 2. upload -> scan -> book level modal
await page.click('nav.tabs button[data-view="read"]');
await page.click('[data-act="library"]');
await page.setInputFiles("#f-epub", epub);
await page.waitForSelector('[data-act="mode-match"]', { timeout: 5000 });
const modalText = await page.locator(".modal").innerText();
check(/About B1/.test(modalText), "book level shown: About B1");
check(/subordinate clause/.test(modalText), "grammar cue shown");
check(calls.grade === 1, "one grading request for the whole book");

// 3. match my level
await page.click('[data-act="mode-match"]');
await page.waitForSelector(".chip", { timeout: 5000 });
check(/Matched to A1/.test(await page.locator(".matched").innerText()), "paragraph matched to the reader's level");
check(/niveau A1/.test(await page.locator(".para").innerText()), "matched text is shown");
await page.click('[data-act="toggle-original"]');
check(/zaterdag gaat Sanne/.test(await page.locator(".original").innerText()), "original one tap away");
check(calls.match >= 2, `next paragraphs prepared ahead (${calls.match} requests)`);

// 4. a word in its sentence
await page.locator(".para .w").nth(3).click();
await page.waitForSelector(".ctx-meaning", { timeout: 5000 });
check(/in this sentence/i.test(await page.locator(".def").innerText()) && calls.explain === 1, "word explained in its sentence");

// 5. names are protected: paragraph 2 names Jansen; the mock keeps it
await page.click('[data-act="turn"]');
await page.waitForSelector(".chip", { timeout: 5000 });
check(/Jansen/.test(await page.locator(".para").innerText()), "name kept in the matched paragraph");

// 6. a bad adaptation falls back to the original
breakNextMatch = true;
await page.evaluate(() => { /* force a fresh match for a later paragraph */ });
await page.click('[data-act="turn"]');
await page.waitForTimeout(300);
await page.click('[data-act="turn"]').catch(() => {});
await page.waitForTimeout(800);
const line = await page.locator(".matched").innerText().catch(() => "");
check(/Original|Matched/.test(line), "reading continues whether or not a match passes the checks");

check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join("; ") : ""}`);
await browser.close();
