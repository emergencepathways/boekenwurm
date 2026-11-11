// End-to-end check of the built app in a real browser at phone size, with Claude's replies mocked and Supabase
// unreachable (the app must work fully on the device). The EPUB is built here from invented sentences; no real
// book text is used.
//   npm run build && node test/e2e.mjs [path-to-playwright] [screenshot-dir]
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] || "playwright");
const JSZip = require("jszip");
const shots = process.argv[3] || null;
if (shots) mkdirSync(shots, { recursive: true });

// ---------------------------------------------------------------- serve dist/ like Cloudflare Pages (unknown paths get the app)
const dist = join(here, "..", "dist");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".gz": "application/octet-stream" };
const server = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let f = join(dist, p);
  if (!existsSync(f) || statSync(f).isDirectory()) f = join(dist, "index.html");
  res.setHeader("content-type", TYPES[extname(f)] || "application/octet-stream");
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}/`;

// ---------------------------------------------------------------- a synthetic EPUB
const PARAS = [
  "Op zaterdag gaat Sanne met de fiets naar de markt in het centrum van de stad, waar zij altijd verse groente koopt.",
  "Daar ontmoet zij meneer Jansen, die al jaren een kraam met kaas heeft en iedereen in de buurt bij naam kent.",
  "Meneer Jansen vertelt dat de prijzen dit jaar flink gestegen zijn, omdat de zomer veel te droog was voor de boeren.",
  "Sanne luistert aandachtig en besluit om een stuk oude kaas te kopen, hoewel het eigenlijk duurder is dan zij had gedacht.",
  "Op de terugweg begint het plotseling te regenen, zodat zij onder een brug moet schuilen tot de bui voorbij is.",
  "Thuis zet zij koffie en schrijft zij in haar schrift welke nieuwe woorden zij die ochtend op de markt heeft geleerd.",
];
const MARKT = [
  "Elke woensdag fietst Ahmed naar de markt om verse groente en fruit voor de hele week te kopen.",
  "Bij de kraam van de bakker koopt hij een groot brood, en bij de visboer kiest hij een mooie vis.",
  "Daarna drinkt hij een kop koffie op het terras en kijkt hij naar de mensen die voorbij lopen.",
  "Als het gaat regenen, zet hij zijn fiets onder het dak van het station en wacht hij even.",
  "Thuis legt hij alles in de koelkast en schrijft hij op wat hij volgende week nodig heeft.",
  "Op zondag kookt hij voor zijn vrienden, die altijd vragen waar hij die lekkere kaas heeft gevonden.",
];
async function epub(title, author, paras, file) {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file("META-INF/container.xml", '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  zip.file("OEBPS/content.opf", `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title><dc:creator>${author}</dc:creator><dc:language>nl</dc:language></metadata><manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>`);
  zip.file("OEBPS/c1.xhtml", `<html xmlns="http://www.w3.org/1999/xhtml"><body>${paras.map((p) => `<p>${p}</p>`).join("")}</body></html>`);
  const path = join(tmpdir(), file);
  writeFileSync(path, await zip.generateAsync({ type: "nodebuffer" }));
  return path;
}
const marktPath = await epub("Marktdag", "Test Auteur", MARKT, "bw-e2e-marktdag.epub");
const epubPath = await epub("Testboek", "Test Auteur", PARAS, "bw-e2e-testboek.epub");

// ---------------------------------------------------------------- the open dictionary, a small invented one
// In the real build this file comes from Wiktionary + wordfreq (python -m boekenwurm_ingest dictionary).
const DICT = {
  v: 1, lang: "nl", built: "2026-11-11", attribution: "Test dictionary written for this test.",
  lemmas: {
    woensdag: ["Wednesday", "de", "noun", 45], fietsen: ["to cycle", null, "verb", 44], markt: ["market", "de", "noun", 50],
    groente: ["vegetables", "de", "noun", 42], fruit: ["fruit", "het", "noun", 43], week: ["week", "de", "noun", 55],
    kopen: ["to buy", null, "verb", 50], kraam: ["market stall", "de", "noun", 30], bakker: ["baker", "de", "noun", 38],
    brood: ["bread", "het", "noun", 44], vis: ["fish", "de", "noun", 42], kiezen: ["to choose", null, "verb", 47],
  },
  forms: { fietst: "fietsen", koopt: "kopen", kiest: "kiezen" },
};

// ---------------------------------------------------------------- Claude, mocked
const calls = { grade: 0, match: 0, explain: 0 };
async function mockClaude(route) {
  const body = JSON.parse(route.request().postData() || "{}");
  const sys = body.system || "";
  const user = typeof body.messages?.[0]?.content === "string" ? body.messages[0].content : "";
  let text = "ok";
  if (/grade the reading level/i.test(sys)) {
    calls.grade++;
    const ids = [...user.matchAll(/id="(p\d+)"/g)].map((m) => m[1]);
    text = JSON.stringify(ids.map((id) => ({ id, level: "B1", grammar: ["relative clauses"], context: "" })));
  } else if (/adapt one paragraph/i.test(sys)) {
    calls.match++;
    const orig = user.match(/<paragraph>\n([\s\S]*?)\n<\/paragraph>/)[1];
    text = JSON.stringify({ original_level: "B1", changed: true, text: orig.replace(/flink gestegen zijn/, "veel hoger zijn").replace(/aandachtig/, "goed") });
  } else if (/explain one Dutch word/i.test(sys)) {
    calls.explain++;
    const word = user.match(/Word: (.*)/)[1];
    text = JSON.stringify({ lemma: word.toLowerCase(), meaning_en: `meaning of ${word}`, meaning_nl: `uitleg van ${word}`, note: "" });
  }
  await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify({ content: [{ type: "text", text }] }) });
}

// ---------------------------------------------------------------- the run
const browser = await chromium.launch({ executablePath: existsSync("/usr/bin/google-chrome") ? "/usr/bin/google-chrome" : undefined });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: "block" });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && !/supabase|Failed to load resource|fonts\.g/i.test(m.text()) && errors.push(m.text()));
await ctx.route("https://api.anthropic.com/**", (r) => (r.request().method() === "OPTIONS" ? r.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" } }) : mockClaude(r)));
await ctx.route(/supabase\.co/, (r) => r.abort());
await ctx.route("**/dict/nl.json", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(DICT) }));
await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());

const shot = async (name) => shots && (await page.screenshot({ path: join(shots, `${name}.png`) }));
const step = (msg) => console.log(`• ${msg}`);
let failed = 0;
const check = (ok, msg) => {
  console.log(`  ${ok ? "ok" : "FAIL"}: ${msg}`);
  if (!ok) failed++;
};

await page.goto(base);
step("first run: choose a level");
await page.getByRole("heading", { name: /Read Dutch books you own/ }).waitFor();
await shot("01-welcome");
await page.getByRole("group", { name: "Your level" }).getByRole("button", { name: "A2" }).click();
await page.getByRole("button", { name: "Start reading" }).click();

step("home: an empty shelf invites the first book (nothing is preloaded)");
await page.getByRole("heading", { name: "Add your first book" }).waitFor();
check(await page.getByText("Bladzijdeknabbelaar").first().isVisible(), "A2 title shown under the greeting");
check((await page.locator(".bookbtn").count()) === 0, "no books on the shelf");
check((await page.locator(".continue").count()) === 0, "no continue-reading card");
await shot("02-home-empty");

step("add an EPUB without a Claude key: import check, the reader chooses the level");
await page.getByRole("button", { name: "Add a book" }).click();
await page.locator('input[type=file][accept*="epub"]').setInputFiles(marktPath);
await page.getByText("Ready to read").waitFor();
await page.getByRole("group", { name: "Book level" }).waitFor();
await page.getByRole("group", { name: "Book level" }).getByRole("button", { name: "A2" }).click();
await shot("03-add-free");
await page.getByRole("button", { name: "Add to my books" }).click();

step("reader: dictionary meanings and base forms, strikes, turn pages");
await page.locator(".para .w").first().waitFor();
await page.locator(".para .w", { hasText: /^fietst$/ }).click();
check((await page.locator(".pip.used").count()) === 1, "one strike used after one tap");
check(await page.locator(".def .meaning", { hasText: "to cycle" }).isVisible(), "dictionary meaning shown for an inflected form");
check(await page.locator(".def .lemma", { hasText: "fietsen" }).isVisible(), "base form from the dictionary's form table (fietst -> fietsen)");
await page.locator(".para .w", { hasText: /^fietst$/ }).click();
check((await page.locator(".pip.used").count()) === 1, "tapping the same word again is not a second strike");
await shot("04-reader");
await page.getByRole("button", { name: "Undo tap" }).click();
check((await page.locator(".pip.used").count()) === 0, "undo within 5 seconds takes the strike back");
await page.locator(".para .w", { hasText: /^markt$/ }).click();
for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Next page →" }).click();
check((await page.locator(".folio .num").textContent()).startsWith("4 /"), "three pages turned");

step("reader: run out of strikes ends the session with a study list");
const n = await page.locator(".strikes .pip").count();
for (let i = 0; i < n; i++) await page.locator(".para .w:not(.name):not(.rev)").nth(0).click();
await page.getByRole("button", { name: "Next page →" }).click();
await page.getByRole("heading", { name: /streak lasted|last strike|passed 1 paragraph|passed 3|lasted/ }).waitFor();
check(await page.getByRole("button", { name: /Study these/ }).isVisible(), "summary offers to study the words");
await shot("05-summary");

step("study: flashcards from the revealed words");
await page.getByRole("button", { name: /Study these/ }).click();
await page.getByRole("button", { name: "Show meaning" }).click();
check(await page.locator(".flash .answer").isVisible(), "card shows its meaning");
await shot("06-flashcard");
await page.getByRole("button", { name: /^Good/ }).click();
await page.getByRole("button", { name: "Back", exact: true }).first().click();
await page.locator(".continue").waitFor();
check(true, "closing the review returns to Home");

step("progress is kept: reload and come back");
await page.reload();
await page.locator(".continue").waitFor();
check(await page.getByText("Continue reading").isVisible(), "continue-reading card after a reload");
check((await page.locator(".continue").textContent()).includes("Marktdag"), "it points at the book");
check(Number(await page.locator(".studycard .big").textContent()) >= 1, "words due on the Study card");

step("Me: add a Claude key (mocked) and check the connection");
await page.locator(".tabbar").getByRole("button", { name: "Me", exact: true }).click();
await page.getByLabel("Claude API key").fill("sk-ant-test-key");
await page.locator("#claude").getByRole("button", { name: "Save" }).click();
check(await page.getByText(/saved/).first().isVisible(), "key saved on this device");
await page.getByRole("button", { name: "Run check" }).click();
await page.locator(".checklist, .verdict").first().waitFor({ timeout: 15000 });
check(await page.getByText(/Not reachable|Sign-in service/).first().isVisible(), "connection check reports Supabase unreachable here");
check(await page.getByText(/12 Dutch words and 3 word forms/).isVisible(), "the dictionary and its credits are shown under About");
await shot("07-me");

step("add an EPUB with a key: graded level, Match my level, words in context");
await page.locator(".tabbar").getByRole("button", { name: "Home", exact: true }).click();
await page.getByRole("button", { name: "Add a book" }).click();
await page.locator('input[type=file][accept*="epub"]').setInputFiles(epubPath);
await page.getByText("Ready to read").waitFor();
await page.getByText("About B1").waitFor({ timeout: 15000 });
check(calls.grade === 1, "Claude graded the book once");
await shot("08-add-graded");
await page.getByRole("button", { name: "Match my level" }).click();
await page.locator(".chip", { hasText: "Matched to A2" }).waitFor({ timeout: 15000 });
check(calls.match >= 1, "paragraphs matched to the reader's level");
await page.getByRole("button", { name: "Show original" }).click();
check(await page.locator(".original").isVisible(), "the original is one tap away");
await page.locator(".para .w:not(.name)").first().click();
await page.getByText("In this sentence").waitFor({ timeout: 15000 });
check(calls.explain >= 1, "word explained in its sentence");
await shot("09-matched");
await page.getByRole("button", { name: "Back to Home" }).click();
check((await page.locator(".bookbtn").count()) === 2, "both books are on the shelf");
check((await page.locator(".continue").textContent()).includes("Testboek"), "Continue reading points at the book opened last");
await shot("10-home-two-books");

step("photo flow: camera explanation, then a library photo fallback");
await page.getByRole("button", { name: "Add a book" }).click();
await page.getByRole("button", { name: /Photograph a book/ }).click();
check(await page.getByText("Boekenwurm will ask to use your camera").isVisible(), "camera permission is explained first");
await shot("11-camera-why");

check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
await browser.close();
server.close();
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
