// End-to-end check of the built app in a real browser at phone size, with Claude's replies mocked and Supabase
// unreachable (the app must work fully on the device). The EPUB is built here from invented sentences; no real
// book text is used.
//   VITE_GOOGLE_TRANSLATE_KEY=e2e-test-key npm run build && node test/e2e.mjs [path-to-playwright] [screenshot-dir]
// (the key is a stand-in: Google Translate is mocked below, like Claude)
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
page.on("console", (m) => m.type() === "error" && !/supabase|Failed to load resource|fonts\.g|Estimating resolution/i.test(m.text()) && errors.push(m.text()));
await ctx.route("https://api.anthropic.com/**", (r) => (r.request().method() === "OPTIONS" ? r.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" } }) : mockClaude(r)));
await ctx.route(/supabase\.co/, (r) => r.abort());
// Google Translate, mocked: a word comes back translated, except "Elke", which comes back unchanged (no meaning).
const translated = [];
let translateReferer = null;
await ctx.route("https://translation.googleapis.com/**", async (r) => {
  if (r.request().method() === "OPTIONS") return r.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" } });
  const q = JSON.parse(r.request().postData() || "{}").q ?? "";
  translated.push(q);
  translateReferer = r.request().headers().referer ?? null;
  const text = q.toLowerCase() === "elke" ? q : `${q} (in English)`;
  await r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ data: { translations: [{ translatedText: text }] } }) });
});
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
check(translated.length === 0, "a word the dictionary knows isn't sent to Google Translate");
await page.locator(".para .w", { hasText: /^fietst$/ }).click();
check((await page.locator(".pip.used").count()) === 1, "tapping the same word again is not a second strike");
await shot("04-reader");
await page.getByRole("button", { name: "Undo tap" }).click();
check((await page.locator(".pip.used").count()) === 0, "undo within 5 seconds takes the strike back");
await page.locator(".para .w", { hasText: /^markt$/ }).click();
step("a word the dictionary doesn't know: Google Translate, or no strike when there's no meaning");
await page.locator(".para .w", { hasText: /^Elke$/ }).click();
await page.getByText(/No meaning found for this word, so this tap doesn't count/).waitFor();
check((await page.locator(".pip.used").count()) === 1, "no meaning found: no strike (still 1, for markt)");
await page.locator(".para .w", { hasText: /^verse$/ }).click();
await page.getByText("Not in the dictionary: translated by Google Translate.").waitFor();
check((await page.locator(".pip.used").count()) === 2, "a meaning from Google Translate: the tap counts");
check(await page.locator(".def .meaning", { hasText: "verse (in English)" }).isVisible(), "the translation is shown");
check(translated.join(",") === "Elke,verse", "only the tapped word is sent to Google Translate");
check(translateReferer === base, "the request carries the site's address, so a site-locked key is accepted");
await page.locator(".para .w", { hasText: /^verse$/ }).click();
check(translated.length === 2, "a word translated once isn't sent again");
await shot("04b-translated");

step("the daily allowance: 200 Google lookups, then the reader is asked instead");
const count = () => page.evaluate(() => JSON.parse(localStorage.getItem("boekenwurm-translations") ?? "null"));
check((await count())?.words === 2, "each Google lookup is counted (signed out: on the device)");
await page.evaluate(() => {
  const c = JSON.parse(localStorage.getItem("boekenwurm-translations"));
  localStorage.setItem("boekenwurm-translations", JSON.stringify({ ...c, words: 200 }));
});
await page.locator(".para .w", { hasText: /^hele$/ }).click();
await page.getByText(/You've used today's 200 Google Translate lookups/).waitFor();
check(translated.length === 2, "over the limit, nothing is sent to Google");
check((await page.locator(".pip.used").count()) === 2, "and the tap doesn't count yet");
check(await page.getByRole("button", { name: "Connect Claude" }).isVisible(), "the reader can connect Claude");
check((await page.getByRole("link", { name: /Look it up/ }).getAttribute("href")).includes("text=hele"), "or look the word up themselves");
await shot("04c-limit");
await page.getByLabel("Meaning of hele").fill("whole");
await page.getByRole("button", { name: "Save", exact: true }).click();
await page.locator(".def .meaning", { hasText: "whole" }).waitFor();
check((await page.locator(".pip.used").count()) === 3, "a typed meaning makes the tap count");
check(await page.getByText("Your own meaning.").isVisible(), "and is marked as the reader's own");
check(await page.evaluate(() => new Promise((ok) => {
  const req = indexedDB.open("boekenwurm-app");
  req.onsuccess = () => { const g = req.result.transaction("kv").objectStore("kv").get("meanings"); g.onsuccess = () => ok(g.result?.hele?.en === "whole" && g.result?.verse?.from === "translation"); };
})), "typed and translated meanings are saved for the reader");
await page.evaluate(() => localStorage.setItem("boekenwurm-translations", JSON.stringify({ day: JSON.parse(localStorage.getItem("boekenwurm-translations")).day, words: 3 })));
for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Next page →" }).click();
check((await page.locator(".folio .num").textContent()).startsWith("4 /"), "three pages turned");

step("reader: run out of strikes ends the session with a study list");
const n = await page.locator(".strikes .pip").count();
for (let i = 0; i < n; i++) {
  await page.locator(".para .w:not(.name):not(.rev)").nth(0).click();
  // A word that has to be translated counts once its meaning arrives.
  await page.waitForFunction((k) => document.querySelectorAll(".pip.used").length >= k, i + 1, { timeout: 10000 });
}
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

step("delete a book from its ••• button");
await page.getByRole("button", { name: /Options for Marktdag/ }).click();
await page.getByRole("button", { name: "Delete this book…" }).click();
check(await page.getByText(/Your words and flashcards stay/).isVisible(), "deleting says what goes and what stays");
await shot("10b-delete");
await page.getByRole("button", { name: "Delete book" }).click();
await page.getByText("Deleted “Marktdag”.").waitFor();
check((await page.locator(".bookbtn").count()) === 1, "the book is gone from the shelf");
await page.reload();
await page.locator(".continue").waitFor();
check((await page.locator(".bookbtn").count()) === 1, "and stays gone after a reload");
check(Number(await page.locator(".studycard .big").textContent()) >= 1, "its words stay on the Study card");
await shot("10-home-two-books");

step("photo flow: camera explanation, then a library photo fallback");
await page.getByRole("button", { name: "Add a book" }).click();
await page.getByRole("button", { name: /Photograph a book/ }).click();
check(await page.getByText("Boekenwurm will ask to use your camera").isVisible(), "camera permission is explained first");
await shot("11-camera-why");

// ---------------------------------------------------------------- a printed book, photographed out of order
// Page photos are drawn here (invented Dutch text, a printed page number at the foot) and read by the free
// on-device reader, exactly as on a phone. Claude is off for this book (free mode).
const STORY = {
  9: ["Het was nog vroeg toen Lotte haar fiets uit de schuur haalde en naar het station reed om de trein te halen.", "Op het perron stonden al veel mensen te wachten, de meesten met een kop koffie in hun hand."],
  10: ["De trein kwam precies op tijd en Lotte vond een plek bij het raam, naast een oude man met een krant.", "Buiten zag ze de weilanden voorbij schieten, met koeien en hier en daar een molen in de verte."],
  11: ["In Utrecht stapte ze over op een andere trein, die veel voller was en waar ze moest blijven staan.", "Een vrouw met een grote hond probeerde ook een plekje te vinden, wat niet zo makkelijk was."],
  12: ["Toen ze eindelijk op haar werk aankwam, was de vergadering al begonnen en keek iedereen naar haar.", "Ze ging snel zitten en deed alsof ze precies wist waar het gesprek over ging."],
  13: ["Na de vergadering at ze een broodje kaas in de kantine en belde ze haar moeder om te vertellen hoe het ging.", "Haar moeder lachte en zei dat ze morgen gewoon een trein eerder moest nemen."],
};
async function pagePhoto(n, { number = true, blank = false } = {}) {
  const p = await browser.newPage({ viewport: { width: 700, height: 950 } });
  const body = blank
    ? `<div style="filter:blur(14px);opacity:.25">${(STORY[n] ?? STORY[9]).map((t) => `<p>${t}</p>`).join("")}</div>`
    : `${(STORY[n] ?? []).map((t) => `<p>${t}</p>`).join("")}${number ? `<div style="position:absolute;bottom:40px;left:0;right:0;text-align:center">${n}</div>` : ""}`;
  await p.setContent(`<html><body style="margin:0;background:#fbfaf5"><div style="position:relative;height:950px;padding:70px 80px;box-sizing:border-box;font:26px/1.55 'Liberation Serif',Georgia,serif;color:#222;text-align:justify">${body}</div></body></html>`);
  const buffer = await p.screenshot({ type: "jpeg", quality: 90 });
  await p.close();
  return { name: `pagina-${n}.jpg`, mimeType: "image/jpeg", buffer };
}
async function coverPhoto() {
  const p = await browser.newPage({ viewport: { width: 400, height: 600 } });
  await p.setContent(`<body style="margin:0;background:#2d5a7a;color:#fff;font:bold 48px Georgia;padding:60px">Een dag van Lotte</body>`);
  const buffer = await p.screenshot({ type: "jpeg" });
  await p.close();
  return { name: "cover.jpg", mimeType: "image/jpeg", buffer };
}

step("photograph a printed book: first page 9, last page 212");
await page.evaluate(() => (localStorage.removeItem("boekenwurm-claude-key"), window.dispatchEvent(new Event("boekenwurm:key"))));
await page.getByRole("button", { name: "Take photo" }).click();
await page.locator("input[type=file][multiple]").setInputFiles(await coverPhoto());
await page.getByLabel("Title").fill("Een dag van Lotte");
await page.getByLabel("First page to read").fill("9");
await page.getByLabel("Last page").fill("212");
check(await page.getByText("That's 204 pages to read.").isVisible(), "pages 9 to 212 are 204 pages to read");
await page.getByRole("group", { name: "The book's level" }).getByRole("button", { name: "A2" }).click();
await shot("12-photo-details");
await page.getByRole("button", { name: /photograph the pages/ }).click();
check(await page.getByText(/Section 1: photograph up to 20 pages in order, starting at page 9/).waitFor().then(() => true, () => false), "section 1 starts at the first page");

step("pages taken out of order, one without its number, one blurry");
// Taken in this order: 9, 10 (number cut off), 12, 11, then a blurry photo where 13 should be.
for (const f of [await pagePhoto(9), await pagePhoto(10, { number: false }), await pagePhoto(12), await pagePhoto(11), await pagePhoto(13, { blank: true })])
  await page.locator("input[type=file][multiple]").setInputFiles(f);
await page.locator(".thumb .spinner").first().waitFor({ state: "detached", timeout: 180000 }).catch(() => {});
await page.waitForFunction(() => document.querySelectorAll(".thumb .spinner").length === 0, null, { timeout: 180000 });
const labels = async () => (await page.locator(".thumb > span:last-child").allTextContents()).map((t) => t.trim());
const first = await labels();
console.log("    thumbnails in reading order:", first.join(" | "));
check(first[0].startsWith("p. 9") && first.some((l) => l.startsWith("p. 11")) && first.indexOf(first.find((l) => l.startsWith("p. 11"))) < first.indexOf(first.find((l) => l.startsWith("p. 12"))), "pages taken 12-then-11 are put back in page order");
check(first[1].startsWith("#2"), "the photo without a number keeps its capture place, right after page 9");
check(first.some((l) => l.includes("⚑")), "unclear photos are flagged");
await shot("13-pages-flagged");

step("review: type the missing number; retake the blurry photo in its place");
await page.getByRole("button", { name: "Review", exact: true }).click();
await page.locator("[aria-label='Check this page']").waitFor();
check(await page.getByText(/No page number was found/).isVisible(), "the unnumbered photo asks for its page number");
await page.getByLabel("Page number").fill("10");
await page.getByRole("button", { name: "Save" }).click();
// The review moves on to the next flagged photo: the blurry one. Retake it.
await page.locator("[aria-label='Check this page']").waitFor();
await page.getByRole("button", { name: "Retake photo" }).click();
await page.locator("input[type=file][multiple]").setInputFiles(await pagePhoto(13));
await page.getByText("Photo replaced. It keeps its place in the book.").waitFor();
await page.waitForFunction(() => document.querySelectorAll(".thumb .spinner").length === 0, null, { timeout: 180000 });
const after = await labels();
console.log("    after review:", after.join(" | "));
check(after.slice(0, 5).map((l) => l.replace(/[^\d]/g, "")).join(",") === "9,10,11,12,13", "after the review the pages read 9, 10, 11, 12, 13");
check(after.length === 5, "the retake replaced the photo instead of adding one");
await shot("14-pages-ordered");

step("reading the photographed book in order, and going to a page");
await page.getByRole("button", { name: /^Start reading/ }).click();
await page.locator(".para .w").first().waitFor();
check((await page.locator(".folio .num").textContent()).startsWith("p. 9"), "reading starts at page 9");
check((await page.locator(".para").textContent()).startsWith("Het was nog vroeg"), "with page 9's first paragraph");
await page.getByRole("button", { name: "Go to a page" }).click();
await page.getByLabel("Page number").fill("12");
await page.getByRole("button", { name: "Go", exact: true }).click();
check(await page.waitForFunction(() => document.querySelector(".folio .num")?.textContent?.startsWith("p. 12"), null, { timeout: 10000 }).then(() => true, () => false), "Go to page 12 lands on page 12");
await shot("15-reader-page-12");
// Read to the end of what's photographed: the app asks for the next section.
const nextSection = page.getByText(/Next section: up to 20 pages, from page 14/);
for (let i = 0; i < 20 && !(await nextSection.isVisible()); i++)
  await page.getByRole("button", { name: "Next page →" }).click({ timeout: 3000 }).catch(() => {});
await nextSection.waitFor();
check(true, "at the end of the photographed pages, the next section is offered from page 14");
await shot("16-next-section");

step("a section stops at 20 photos");
await page.getByRole("button", { name: "Photograph the next pages" }).click();
check(await page.getByText(/Section 2: photograph up to 20 pages in order, starting at page 14/).waitFor().then(() => true, () => false), "section 2 starts at page 14");
const blanks = await Promise.all(Array.from({ length: 21 }, (_, i) => pagePhoto(14 + i, { blank: true })));
await page.locator("input[type=file][multiple]").setInputFiles(blanks.map((b, i) => ({ ...b, name: `leeg-${i}.jpg` })));
await page.getByText("This section is done: 20 photos.").waitFor({ timeout: 60000 });
check((await page.locator(".thumb").count()) === 25, "20 photos were taken in section 2 (the 21st was not)");
check((await page.locator("video").count()) === 0 && (await page.getByRole("button", { name: "Take photo" }).count()) === 0, "the camera closes when the section is full");
await shot("17-section-full");
await page.waitForFunction(() => document.querySelectorAll(".thumb .spinner").length === 0, null, { timeout: 300000 });


check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
await browser.close();
server.close();
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
