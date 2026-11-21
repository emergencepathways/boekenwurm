// End-to-end check of the built app in a real browser at phone size, with Claude's replies mocked and Supabase
// unreachable (the app must work fully on the device). The EPUB is built here from invented sentences; no real
// book text is used.
//   npm run build && node test/e2e.mjs [path-to-playwright] [screenshot-dir]
// The build needs VITE_SUPABASE_URL (apps/web/.env.local or the environment): the reader signs in part-way with a
// made-up session, and the translate function (Google Translate behind it) is mocked, like Claude.
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
// LanguageTool (the diary's "Check my writing"), mocked: "vandag" is a spelling mistake, nothing else is.
const ltChecks = [];
await ctx.route("https://api.languagetool.org/**", (r) => {
  const text = new URLSearchParams(r.request().postData() ?? "").get("text") ?? "";
  ltChecks.push(text);
  const i = text.indexOf("vandag ");
  const matches = i >= 0 ? [{ message: "Possible spelling mistake found.", offset: i, length: 6, replacements: [{ value: "vandaag" }], rule: { issueType: "misspelling" } }] : [];
  return r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ matches }) });
});
// The translate function (supabase/functions/translate), mocked: 200 words a day, then refused. A word comes back
// translated, except "Elke", which comes back unchanged (no meaning).
const translated = [];
const lookups = { used: 0, auth: null };
await ctx.route("**/functions/v1/translate", async (r) => {
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
  if (r.request().method() === "OPTIONS") return r.fulfill({ status: 204, headers: cors });
  lookups.auth = r.request().headers().authorization ?? null;
  if (lookups.used >= 200) return r.fulfill({ status: 429, contentType: "application/json", headers: cors, body: JSON.stringify({ ok: false, reason: "limit", used: 200, limit: 200 }) });
  const { word } = JSON.parse(r.request().postData() || "{}");
  translated.push(word);
  // "verse" was already translated for another reader: it comes from the shared store and uses no lookup.
  if (word.toLowerCase() === "verse")
    return r.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify({ ok: true, text: `${word} (in English)`, shared: true }) });
  lookups.used++;
  const text = word.toLowerCase() === "elke" ? word : `${word} (in English)`;
  await r.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify({ ok: true, text, used: lookups.used, limit: 200 }) });
});
const reports = [];
await ctx.route("**/rest/v1/rpc/report_shared_word", async (r) => {
  reports.push(JSON.parse(r.request().postData() || "{}"));
  await r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: "false" });
});

// Access codes and the read-page function (Google Cloud Vision behind it), mocked. Only "BW-E2E-TEST-CODE" works.
// Photographing a book needs the code. Each page photo the test draws carries a coloured corner that says which page
// it is (pagePhoto), and Google "sees" that page's text; with `marked` off, Google sees the Sem aan zee page. Past
// 20 pages (`used`, for the whole account, like the real function), the 21st is refused; set `used` to start a new day.
const vision = { calls: 0, used: 0, redeemed: false, refuse: null, admin: false, marked: true };
let decoder = null;
/** The page a drawn photo shows, from its corner: red = page × 6, green 100 = number printed, 200 = blurred. */
async function seenOn(image) {
  decoder ??= await browser.newPage();
  const [r, g] = await decoder.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/jpeg;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const x = c.getContext("2d");
    x.drawImage(img, 0, 0);
    return [...x.getImageData(Math.round(img.width * 0.02), Math.round(img.height * 0.02), 1, 1).data];
  }, image);
  const n = Math.round(r / 6);
  const kind = Math.round(g / 100);
  return n ? { n, number: kind === 1, blank: kind === 2 } : null;
}
await ctx.route("**/rest/v1/rpc/redeem_code", async (r) => {
  const { p_code } = JSON.parse(r.request().postData() || "{}");
  const ok = p_code.replace(/[\s-]/g, "").toUpperCase() === "BWE2ETESTCODE";
  vision.redeemed ||= ok;
  await r.fulfill({ status: ok ? 200 : 400, contentType: "application/json", headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify(ok ? "google_page_reading" : { code: "22023", message: "That code isn't valid" }) });
});
await ctx.route("**/rest/v1/feature_access*", (r) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" },
  body: JSON.stringify([...(vision.redeemed ? [{ feature: "google_page_reading" }] : []), ...(vision.admin ? [{ feature: "admin" }] : [])]) }));
await ctx.route("**/rest/v1/page_read_usage*", (r) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" },
  body: JSON.stringify(/object/.test(r.request().headers().accept ?? "") ? (vision.used ? { pages: vision.used } : null) : vision.used ? [{ pages: vision.used }] : []) }));
await ctx.route("**/functions/v1/read-page", async (r) => {
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
  if (r.request().method() === "OPTIONS") return r.fulfill({ status: 204, headers: cors });
  const { image } = JSON.parse(r.request().postData() || "{}");
  vision.calls++;
  vision.sentJpeg = typeof image === "string" && image.startsWith("/9j/");
  if (vision.used >= 20) return r.fulfill({ status: 429, contentType: "application/json", headers: cors, body: JSON.stringify({ ok: false, reason: "limit", used: 20, limit: 20 }) });
  if (vision.refuse) return r.fulfill({ status: 502, contentType: "application/json", headers: cors, body: JSON.stringify({ ok: false, reason: "unavailable", detail: vision.refuse, used: vision.used, limit: 20 }) });
  vision.used++;
  const box = (y0, y1) => ({ x0: 80, y0, x1: 620, y1 });
  const seen = vision.marked ? await seenOn(image) : null;
  if (seen) {
    const lines = seen.blank ? [] : (STORY[seen.n] ?? []).map((text, i) => ({ text, box: box(90 + i * 200, 260 + i * 200), confidence: 0.97, unsure: [] }));
    if (seen.number && !seen.blank) lines.push({ text: String(seen.n), box: box(890, 915), confidence: 0.99, unsure: [] });
    return r.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify({ ok: true, used: vision.used, limit: 20, width: 700, height: 950, paragraphs: lines }) });
  }
  await r.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify({
    ok: true, used: vision.used, limit: 20, width: 700, height: 950,
    paragraphs: [
      { text: "1", box: box(200, 260), confidence: 0.99, unsure: [] },
      { text: "De bus naar het strand vertrok om negen uur precies, en Sem zat helemaal achterin bij het raam.", box: box(300, 420), confidence: 0.98, unsure: [] },
      { text: "Hij had zijn emmer en schep al op schoot, want hij wilde meteen een kasteel bouwen.", box: box(440, 540), confidence: 0.97, unsure: [] },
      { text: "5", box: box(890, 915), confidence: 0.99, unsure: [] },
    ],
  }) });
});

// A made-up signed-in session, as supabase-js keeps it, so the reader is signed in without reaching Supabase.
const supabaseUrl = process.env.VITE_SUPABASE_URL
  || (existsSync(join(here, "..", ".env.local")) && readFileSync(join(here, "..", ".env.local"), "utf8").match(/^VITE_SUPABASE_URL=(.+)$/m)?.[1]?.trim());
if (!supabaseUrl) throw new Error("e2e needs VITE_SUPABASE_URL (apps/web/.env.local) in the build and here");
const authKey = `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 86400;
const reader = { id: "00000000-0000-4000-8000-0000000000e2", aud: "authenticated", role: "authenticated", email: "reader@example.com", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
const accessToken = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: reader.id, aud: "authenticated", role: "authenticated", exp })}.e2e`;
const fakeSession = JSON.stringify({ access_token: accessToken, refresh_token: "e2e", token_type: "bearer", expires_in: 86400, expires_at: exp, user: reader });
await ctx.route("**/dict/nl.json", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(DICT) }));
await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());

const shot = async (name) => shots && (await page.screenshot({ path: join(shots, `${name}.png`) }));
const step = (msg) => console.log(`• ${msg}`);
/** Fouten used on this page (the reader shows "1 of 4 fouten"). */
const used = () => page.evaluate(() => Number(document.querySelector(".strikes")?.dataset.used ?? 0));
/** The reader's total XP, from the play record on the device (the reader no longer shows XP while reading). */
const totalXp = () => page.evaluate(() => new Promise((ok) => {
  const req = indexedDB.open("boekenwurm-app");
  req.onsuccess = () => {
    const get = req.result.transaction("kv").objectStore("kv").get("profile");
    get.onsuccess = () => ok(Object.values(get.result?.progress?.play?.xp ?? {}).reduce((a, b) => a + b, 0));
  };
}));
const fontRequests = [];
/** Every request that carries a body, to check where diary text goes. */
const posted = [];
page.on("request", (q) => q.postData() && posted.push({ url: q.url(), body: q.postData() }));
page.on("request", (q) => /fonts\.(googleapis|gstatic)\.com/.test(q.url()) && fontRequests.push(q.url()));
/** Tap a word in the text. The meaning of the last word tapped lies over the text below it, so close it first. */
const tapWord = async (word) => {
  if (await page.locator(".wordpop").isVisible() && !(await word.getAttribute("aria-expanded").then((v) => v === "true"))) await page.locator(".wordpop .popclose").click();
  await word.click();
};
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
check(await page.getByText("Nieuwkomer").first().isVisible(), "every reader starts at rank A0, whatever reading level they chose");
check(await page.getByText("0 / 600 XP to A1").isVisible(), "with an XP bar towards A1");
check((await page.locator(".bookbtn").count()) === 0, "no books on the shelf");
check((await page.locator(".continue").count()) === 0, "no continue-reading card");
check(await page.getByRole("heading", { name: "Add a word list" }).isVisible(), "Home asks for a word list until there is one");
check(await page.getByRole("heading", { name: "Weekly diary challenge" }).isVisible(), "and shows the weekly diary challenge");
check(await page.locator(".tabbar").getByRole("button", { name: /^Words/ }).locator(".dot").isVisible(), "the Words tab is marked too");
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
await tapWord(page.locator(".para .w", { hasText: /^fietst$/ }));
check((await used()) === 1, "one strike used after one tap");
check(await page.locator(".def .meaning", { hasText: "to cycle" }).isVisible(), "dictionary meaning shown for an inflected form");
check(await page.locator(".def .lemma", { hasText: "fietsen" }).isVisible(), "base form from the dictionary's form table (fietst -> fietsen)");
check(translated.length === 0, "a word the dictionary knows isn't looked up");
await tapWord(page.locator(".para .w", { hasText: /^fietst$/ }));
check((await used()) === 1, "tapping the same word again is not a second strike");
await shot("04-reader");
await page.getByRole("button", { name: "Undo tap" }).click();
check((await used()) === 0, "undo within 5 seconds takes the strike back");
await tapWord(page.locator(".para .w", { hasText: /^markt$/ }));
step("signed out, a word the dictionary doesn't know: sign in to look it up, and the tap is free");
await tapWord(page.locator(".para .w", { hasText: /^Elke$/ }));
await page.getByText(/Sign in to look words up with Google Translate/).waitFor();
check(translated.length === 0, "signed out, nothing is looked up");
check((await used()) === 1, "and the tap doesn't count (still 1, for markt)");
check(await page.getByRole("button", { name: "Sign in", exact: true }).isVisible(), "the reader is offered to sign in");
await shot("04a-signin");

step("signed in: Google Translate through the translate function, or no strike when there's no meaning");
await page.evaluate(([k, v]) => localStorage.setItem(k, v), [authKey, fakeSession]);
await page.reload();
await page.locator(".continue").click();
await page.locator(".para .w").first().waitFor();
const pips0 = await used();
await tapWord(page.locator(".para .w", { hasText: /^Elke$/ }));
await page.getByText(/No meaning found for this word, so this tap doesn't count/).waitFor();
check((await used()) === pips0, "no meaning found: no strike");
await tapWord(page.locator(".para .w", { hasText: /^verse$/ }));
await page.getByText("Not in the dictionary: translated by Google Translate, shared by Boekenwurm readers.").waitFor();
check(await page.waitForFunction((k) => Number(document.querySelector(".strikes")?.dataset.used ?? 0) === k, pips0 + 1, { timeout: 5000 }).then(() => true, () => false), "a meaning from Google Translate: the tap counts");
check(true, "a translation another reader already had is marked as shared");
check(await page.locator(".def .meaning", { hasText: "verse (in English)" }).isVisible(), "the translation is shown");
check(translated.join(",") === "Elke,verse", "only the tapped word is sent");
check(lookups.auth === `Bearer ${accessToken}`, "the lookup carries the reader's session, so their own allowance is used");
await tapWord(page.locator(".para .w", { hasText: /^verse$/ }));
check(translated.length === 2, "a word translated once isn't sent again");
await shot("04b-translated");

step("the daily allowance: 200 Google lookups, then the reader is asked instead");
check(lookups.used === 1, "each Google lookup is counted; the shared word used none");
lookups.used = 200;
await tapWord(page.locator(".para .w", { hasText: /^hele$/ }));
await page.getByText(/You've used today's 200 Google Translate lookups/).waitFor();
check(translated.length === 2, "over the limit, nothing is sent to Google");
check((await used()) === pips0 + 1, "and the tap doesn't count yet");
check(await page.getByRole("button", { name: "Connect Claude" }).isVisible(), "the reader can connect Claude");
check((await page.getByRole("link", { name: /Look it up/ }).getAttribute("href")).includes("text=hele"), "or look the word up themselves");
await shot("04c-limit");
await page.getByLabel("Meaning of hele").fill("whole");
await page.getByRole("button", { name: "Save", exact: true }).click();
await page.locator(".def .meaning", { hasText: "whole" }).waitFor();
check((await used()) === pips0 + 2, "a typed meaning makes the tap count");
check(await page.getByText("Your own meaning.").isVisible(), "and is marked as the reader's own");
check(await page.evaluate(() => new Promise((ok) => {
  const req = indexedDB.open("boekenwurm-app");
  req.onsuccess = () => { const g = req.result.transaction("kv").objectStore("kv").get("meanings"); g.onsuccess = () => ok(g.result?.hele?.en === "whole" && g.result?.verse?.from === "translation"); };
})), "typed and translated meanings are saved for the reader");

step("a wrong translation: report it, and the reader's own meaning is used from then on");
const pipsBeforeReport = await used();
await tapWord(page.locator(".para .w", { hasText: /^verse$/ }));
await page.getByRole("button", { name: "Wrong translation? Report it" }).click();
await page.getByLabel("Right meaning of verse").fill("fresh");
await page.getByRole("button", { name: "Report", exact: true }).click();
await page.locator(".def .meaning", { hasText: "fresh" }).waitFor();
for (let i = 0; i < 30 && !reports.length; i++) await page.waitForTimeout(100); // the meaning shows first, then the report goes
check(reports.length === 1 && reports[0].p_word === "verse" && reports[0].p_suggestion === "fresh", "the report names the word and the reader's meaning");
check(await page.getByText("Your own meaning.").isVisible(), "the reader's meaning replaces the translation for them");
check((await used()) === pipsBeforeReport, "reporting costs no strike");
await shot("04d-reported");

lookups.used = 3;
for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Next page →" }).click();
check((await page.locator(".folio .num").textContent()).startsWith("4 /"), "three pages turned");

step("Previous: look back without penalty, then back to where the reader was");
const pipsBefore = await used();
await page.getByRole("button", { name: "← Previous" }).click();
await page.getByText("No fouten here.").waitFor();
check((await page.locator(".strikes").count()) === 0 && (await page.getByText("Looking back", { exact: true }).isVisible()), "the strikes give way to a clear no-penalty banner");
check((await page.locator(".folio .num").textContent()).startsWith("3 /"), "the paragraph before is shown");
await tapWord(page.locator(".para .w:not(.name)").first());
check((await page.locator(".def .head .word").count()) === 1, "tapping a word there shows its meaning");
await shot("05a-previous");
await page.getByRole("button", { name: "← Previous" }).click();
check((await page.locator(".folio .num").textContent()).startsWith("2 /"), "Previous again goes one more back");
check(await page.evaluate(() => { const [p, c] = [...document.querySelectorAll(".turnrow .btn")].map((b) => b.getBoundingClientRect()); return Math.abs(p.top - c.top) < 2; }), "Previous and Continue sit on one line");
for (const width of [320, 390]) {
  await page.setViewportSize({ width, height: 844 });
  check(await page.evaluate(() => { const [p, c] = [...document.querySelectorAll(".turnrow .btn")].map((b) => b.getBoundingClientRect()); return Math.abs(p.top - c.top) < 2 && c.right <= document.documentElement.clientWidth; }), `and fit a ${width}px screen`);
}
await page.getByRole("button", { name: "Continue →" }).click();
await page.locator(".strikes").waitFor();
check((await page.locator(".folio .num").textContent()).startsWith("4 /"), "back on the paragraph the reader was at");
check((await used()) === pipsBefore, "looking back cost no strike");

step("reader: the fouten shown are free; one more reveal ends the session with a study list");
const n = await page.locator(".strikes").evaluate((e) => Number(e.dataset.allowed));
const tapNew = async (i) => {
  await tapWord(page.locator(".para .w:not(.name):not(.rev)").nth(0));
  // A word that has to be translated counts once its meaning arrives.
  await page.waitForFunction((k) => Number(document.querySelector(".strikes")?.dataset.used ?? 0) >= k, i + 1, { timeout: 10000 });
};
for (let i = 0; i < n; i++) await tapNew(i);
if (await page.locator(".wordpop").isVisible()) await page.locator(".wordpop .popclose").click();
check(await page.getByRole("button", { name: "Next page →" }).isVisible() && (await page.getByText(/No fouten left: one more reveal ends the run/).isVisible()),
  `all ${n} fouten used: the page still turns, with a warning that one more reveal ends the run`);
await tapNew(n);
if (await page.locator(".wordpop").isVisible()) await page.locator(".wordpop .popclose").click();
check(await page.getByRole("button", { name: "Review fouten →" }).isVisible() && !(await page.getByRole("button", { name: "Next page →" }).isVisible()),
  "one reveal past the fouten: Next page becomes Review fouten");
const endedAt = Number((await page.locator(".folio .num").textContent()).match(/(\d+) \//)[1]);
await page.getByRole("button", { name: "Review fouten →" }).click();
await page.getByRole("heading", { name: /streak lasted|over your fouten|passed 1 paragraph|passed 3|lasted/ }).waitFor();
check(await page.getByRole("button", { name: /Study these/ }).isVisible(), "summary offers to study the words");
await shot("05-summary");

step("Re-read the paragraph just finished: practice, no strikes");
await page.getByRole("button", { name: "Re-read the last paragraph" }).click();
await page.getByText("No fouten here.").waitFor();
check(await page.getByText("Practice", { exact: true }).isVisible(), "the banner says it's practice");
await tapWord(page.locator(".para .w:not(.name)").first());
check((await page.locator(".def .head .word").count()) === 1, "taps show meanings");
await shot("05b-reread");
await page.getByRole("button", { name: "Back to the summary" }).click();
check(await page.getByRole("button", { name: /Study these/ }).isVisible(), "and the summary is back, unchanged");

step("recap after reading: each revealed word once, rated Hard, Medium, Easy or Skip");
const recapCount = Number((await page.getByRole("button", { name: /Study these/ }).textContent()).match(/\d+/)[0]);
await page.getByRole("button", { name: /Study these/ }).click();
await page.getByRole("button", { name: "Show meaning" }).click();
check(await page.locator(".flash .answer").isVisible(), "card shows its meaning");
check(["Hard", "Medium", "Easy"].every((n) => page.getByRole("button", { name: n, exact: true })), "three answers and a skip");
await shot("06-flashcard");
const recapWords = [];
const order = ["hard", "skip", "medium", "easy"];
for (let i = 0; i < recapCount; i++) {
  recapWords.push(await page.locator(".flash .front").textContent());
  if (i > 0) await page.getByRole("button", { name: "Show meaning" }).click();
  const a = order[i % order.length];
  if (a === "skip") await page.getByRole("button", { name: /^Skip/ }).click();
  else await page.getByRole("button", { name: a[0].toUpperCase() + a.slice(1), exact: true }).click();
}
await page.getByText(`Done: ${recapCount} word${recapCount === 1 ? "" : "s"} rated.`).waitFor();
check(new Set(recapWords).size === recapCount, "each word came up once, with no repeats");
const skippedWord = recapCount > 1 ? recapWords[1] : null;
check(await page.getByRole("button", { name: "Keep reading" }).isVisible(), "after studying a session's words: Keep reading");
await page.getByRole("button", { name: "Keep reading" }).click();
await page.locator(".para .w").first().waitFor();
check((await page.locator(".folio .num").textContent()).includes(`${endedAt + 1} /`), `the book opens again at the next page (${endedAt + 1})`);
await page.getByRole("button", { name: "Back to Home" }).click();
await page.locator(".continue").waitFor();
check(true, "and Home is one tap away");

step("progress is kept: reload and come back");
await page.reload();
await page.locator(".continue").waitFor();
check(await page.getByText("Continue reading").isVisible(), "continue-reading card after a reload");
check((await page.locator(".continue").textContent()).includes("Marktdag"), "it points at the book");
check(/^Daily Challenge: Study 90 words/.test(await page.locator(".studycard").textContent()), "the Daily Challenge on Home");

step("review: a set from the pool, Hard first, repeated until every word is Easy");
await page.locator(".tabbar").getByRole("button", { name: /^Study/ }).click();
const reviewBtn = page.getByRole("button", { name: /^Review \d+ words?$/ });
await reviewBtn.waitFor();
const setCount = Number((await reviewBtn.textContent()).match(/\d+/)[0]);
await reviewBtn.click();
check((await page.locator(".flash .front").textContent()) === recapWords[0], "the word rated Hard comes first");
check(await page.getByText(`0 of ${setCount} learned`).isVisible(), "progress counts words learned (Easy)");
const firstWord = recapWords[0];
await page.getByRole("button", { name: "Show meaning" }).click();
await page.getByRole("button", { name: "Hard", exact: true }).click();
let seenAgain = false, turns = 0;
while (!(await page.getByText(/^Set done/).isVisible()) && turns < 40) {
  const w = await page.locator(".flash .front").textContent();
  if (w === firstWord) seenAgain = true;
  await page.getByRole("button", { name: "Show meaning" }).click();
  await page.getByRole("button", { name: "Easy", exact: true }).click();
  turns++;
}
check(seenAgain, "a word rated Hard comes round again in the same set");
check(await page.getByText(`Set done: all ${setCount} word${setCount === 1 ? "" : "s"} rated Easy.`).isVisible(), "the set ends when every word is Easy");
check(turns === setCount, "each word needed one Easy (the Hard one twice in all)");
await page.getByRole("button", { name: "Back", exact: true }).first().click();
await page.locator(".tabbar").getByRole("button", { name: /^Study/ }).click();
check(await page.getByText("No words to review right now.").isVisible(), "the pool is empty until the Easy words' check-back in 3 days");
if (skippedWord) {
  check(await page.getByRole("button", { name: `Bring back ${skippedWord}` }).isVisible(), "a skipped word is listed and can be brought back");
  await page.getByRole("button", { name: `Bring back ${skippedWord}` }).click();
  await page.getByRole("button", { name: /^Review 1 word$/ }).waitFor();
  check(true, "brought back, it waits in the pool");
}
await shot("06c-study");
const revealedPanel = page.locator(".panel", { has: page.getByRole("heading", { name: "Every word you've revealed" }) });
check(await revealedPanel.evaluate((p) => {
  const exp = [...p.querySelectorAll("button")].find((b) => b.textContent === "Export CSV");
  return Boolean(exp && p.querySelector("table") && exp.compareDocumentPosition(p.querySelector("table")) & Node.DOCUMENT_POSITION_FOLLOWING);
}), "Export CSV sits above the word list");
if (skippedWord) check((await revealedPanel.locator("tbody tr").first().textContent()).includes("Next set"), "the list starts with the next review set's words");
const rowsBefore = await revealedPanel.locator("tbody tr").count();
await revealedPanel.getByRole("searchbox", { name: "Search your words" }).fill(recapWords[0]);
check((await revealedPanel.locator("tbody tr").count()) >= 1 && (await revealedPanel.locator("tbody tr").first().textContent()).includes(recapWords[0]), "search finds a word");
await revealedPanel.getByRole("searchbox", { name: "Search your words" }).fill("zzzz");
check(await revealedPanel.getByText("No word matches “zzzz”.").isVisible(), "and says when nothing matches");
await revealedPanel.getByRole("searchbox", { name: "Search your words" }).fill("");
check((await revealedPanel.locator("tbody tr").count()) === rowsBefore, "clearing the search shows every word again");

step("Words: no list yet, then a pasted list and a CSV file; list words come first in reviews");
await page.locator(".tabbar").getByRole("button", { name: /^Words/ }).click();
await page.getByRole("heading", { name: "Add a word list" }).waitFor();
check(await page.getByRole("button", { name: "Add the 5,000 most common Dutch words" }).isVisible(), "an empty Words tab offers the common words in one tap");
await page.getByRole("button", { name: "Import your own list…" }).click();
await page.getByRole("textbox", { name: "Words to import" }).fill("de markt = the market\nhet brood = bread\nop tijd = on time\nmarkten = markets");
await page.getByRole("button", { name: "Continue" }).click();
await page.getByText(/2 words ticked/).waitFor();
check(await page.getByText(/1 phrase unticked/).isVisible() && await page.getByText(/1 repeat unticked/).isVisible(), "a phrase and a repeat (markten → markt) start unticked");
await page.getByRole("textbox", { name: "Name" }).fill("Hoofdstuk 1");
await shot("06d-import-preview");
await page.getByRole("button", { name: "Add 2 words" }).click();
await page.getByRole("heading", { name: "My lists" }).waitFor();
check(await page.getByText("Hoofdstuk 1").first().isVisible(), "the pasted list is on the Words tab");
await page.getByRole("button", { name: "Import a list…" }).click();
await page.locator('input[type=file][accept*="apkg"]').setInputFiles({ name: "markt-lijst.csv", mimeType: "text/csv", buffer: Buffer.from("Dutch,English\nbakker,baker\nvis,fish\ntrein,train\n") });
await page.getByText(/3 words ticked/).waitFor();
check((await page.getByRole("combobox", { name: "Dutch words" }).inputValue()) === "0" && await page.getByRole("checkbox", { name: "The first row names the columns" }).isChecked(), "a CSV's Dutch column and header row are found");
await page.getByRole("button", { name: "Add 3 words" }).click();
await page.getByText("markt lijst").first().waitFor();
check((await page.locator(".listrow").count()) === 2, "two lists");
check((await page.locator(".wgrid").count()) === 0 && await page.getByRole("button", { name: /^Show all \d+ words$/ }).isVisible(), "the word grid starts folded, with a button to show every word");
await page.getByText("Hoofdstuk 1").first().click();
const chips = await page.evaluate(() => [...document.querySelectorAll(".wgrid .wchip")].map((b) => [b.textContent, b.className]));
check(chips.length === 2 && chips.some(([w, c]) => w === "markt" && /s-(seen|tapped)/.test(c)), "markt was seen in reading");
await page.locator(".wgrid .wchip", { hasText: /^brood$/ }).click();
check(await page.getByText(/Read without tapping: \d+ of 10/).isVisible(), "a word's details show how close it is to learned");
await shot("06e-word-details");
const addBrood = page.getByRole("button", { name: "Add to my reviews" });
if (await addBrood.isVisible()) {
  await addBrood.click();
  if (skippedWord && !["markt", "brood", "bakker", "vis"].includes(skippedWord)) {
    await page.locator(".tabbar").getByRole("button", { name: /^Study/ }).click();
    await page.getByRole("button", { name: /^Review 2 words$/ }).click();
    check((await page.locator(".flash .front").textContent()) === "brood", "a list word rated Medium comes before an older word that isn't on a list");
    await page.getByRole("button", { name: "Back", exact: true }).first().click();
    await page.locator(".tabbar").getByRole("button", { name: /^Words/ }).click();
  }
} else await page.getByRole("button", { name: "Close" }).click();
await page.getByRole("button", { name: "Add the 5,000 most common words" }).click();
await page.getByRole("heading", { name: "Common Dutch words" }).waitFor();
await page.getByRole("button", { name: /^Show all \d+ words$/ }).click();
check(await page.locator(".wgrid .wchip.s-tapped").count() > 0, "tapped words are coloured");
await page.getByText("markt lijst").first().click();
check(/s-unseen/.test(await page.locator(".wgrid .wchip", { hasText: /^trein$/ }).getAttribute("class")), "a word not seen yet in reading is faded");
await shot("06f-words");
for (const width of [320, 768]) {
  await page.setViewportSize({ width, height: 844 });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `the Words tab fits a ${width}px screen (no sideways scrolling)`);
}
await page.setViewportSize({ width: 390, height: 844 });
await page.locator(".tabbar").getByRole("button", { name: "Home", exact: true }).click();
check(!(await page.getByRole("heading", { name: "Add a word list" }).isVisible()), "Home stops asking once there is a list");
check(/^Daily Challenge: Study 90 words/.test(await page.locator(".studycard").textContent()), "Home shows the Daily Challenge");

step("reviews: today's set brings in new common words, at most 90 cards a day");
await page.locator(".tabbar").getByRole("button", { name: /^Study/ }).click();
await page.getByRole("heading", { name: "Daily Challenge: Study 90 words" }).waitFor();
check(await page.getByText("Studying up to 90 words a day will help you improve your vocabulary. Earn extra XP if you complete it today!").isVisible(), "the daily challenge is explained in a line");
check(/^\d+ \/ 90 words reviewed/.test(await page.locator(".panel").first().locator("p.num").textContent()), "with progress towards 90");
check(!/pool/i.test(await page.locator(".panel").first().textContent()), "and no pool details");
await page.getByRole("button", { name: /^Review \d+ words?$/ }).click();
let sawNew = false;
for (let i = 0; i < 40 && !sawNew; i++) {
  if (await page.getByText(/^Set done/).isVisible()) break;
  sawNew = await page.locator(".flash .chip", { hasText: "New word" }).isVisible();
  if (sawNew) break;
  await page.getByRole("button", { name: "Show meaning" }).click();
  await page.getByRole("button", { name: "Easy", exact: true }).click();
}
check(sawNew, "a new common word is marked New word on its card");
await page.getByRole("button", { name: "Show meaning" }).click();
check(await page.locator(".flash .answer").isVisible(), "and shows its meaning from the dictionary");
await page.getByRole("button", { name: "Easy", exact: true }).click();
await page.getByRole("button", { name: "Back", exact: true }).first().click();

step("Daily Challenge: 90 words across partly finished sets completes it (+600), without the set reward");
const seedReviewed = (n) => page.evaluate((n) => {
  const d = new Date(); const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  localStorage.setItem("boekenwurm-reviewed-today", JSON.stringify({ day, lemmas: Array.from({ length: n }, (_, i) => `earlier${i}`), fresh: [] }));
}, n);
await seedReviewed(89); // 89 words reviewed earlier today, in sets left unfinished
await page.locator(".tabbar").getByRole("button", { name: "Home", exact: true }).click();
check(/89 \/ 90 words reviewed/.test(await page.locator(".studycard").textContent()), "Home shows the challenge's progress");
await shot("06g-home-challenge");
await page.locator(".tabbar").getByRole("button", { name: /^Study/ }).click();
check(/Earn extra XP/.test(await page.locator(".panel").first().textContent()), "the last word of the day still offers the extra XP");
await page.getByRole("button", { name: /^Review \d+ words?$/ }).click();
await page.getByRole("button", { name: "Show meaning" }).click();
await page.getByRole("button", { name: "Hard", exact: true }).click(); // the set isn't finished: Hard comes round again
check(await page.getByText(/Daily Challenge completed: 90 words! \+600 XP/).waitFor({ timeout: 5000 }).then(() => true, () => false), "the 90th word completes the Daily Challenge, set finished or not");
await page.getByRole("button", { name: "Back", exact: true }).first().click();
check(!(await page.getByText(/review set finished/).isVisible()), "an unfinished set earns no set reward");
await page.locator(".tabbar").getByRole("button", { name: /^Study/ }).click();
check(/90 \/ 90 words reviewed · done!/.test(await page.locator(".panel").first().textContent()), "Study shows the challenge done");
await page.locator(".tabbar").getByRole("button", { name: "Home", exact: true }).click();
check(await page.getByText("Daily Challenge: Completed!").isVisible() && (await page.locator(".studycard.done").count()) === 1, "Home greys it out: Daily Challenge: Completed!");
await shot("06g-home-challenge-done");
await page.evaluate(() => ["boekenwurm-study-sessions", "boekenwurm-reviewed-today"].forEach((k) => localStorage.removeItem(k))); // later steps start a fresh day
await page.locator(".tabbar").getByRole("button", { name: "Home", exact: true }).click();

step("diary: a weekly prompt in Dutch, word suggestions, LanguageTool corrections, saved only on this phone");
await page.locator(".tabbar").getByRole("button", { name: "Home", exact: true }).click();
await page.getByRole("button", { name: "Write in my diary" }).click();
await page.getByRole("tab", { name: "Diary" }).waitFor();
check(await page.getByRole("tab", { name: "Diary" }).getAttribute("aria-selected") === "true", "Home's weekly card opens Study → Diary");
const consent = page.getByRole("dialog", { name: "Check your writing with LanguageTool?" });
check(await consent.isVisible(), "first visit: asked about LanguageTool, like a cookie notice");
await shot("06i-consent");
check(/LanguageTool GmbH in Germany/.test(await consent.textContent()) && await consent.getByRole("link", { name: "LanguageTool's privacy policy" }).isVisible(), "with what it is, what is sent, and its privacy policy");
await consent.getByRole("button", { name: "No, I'll check it myself" }).click();
check(!(await consent.isVisible()), "the answer is kept");
check(!(await page.getByRole("button", { name: "Check my writing" }).isVisible()) && await page.getByText("Check it yourself: what to look for").isVisible(), "declined: no LanguageTool, a self-check guide instead");
await page.locator(".tabbar").getByRole("button", { name: "Account", exact: true }).click();
await page.getByRole("tab", { name: "Settings" }).click();
await page.getByText("Privacy: what Boekenwurm keeps, and where").click();
check(/LanguageTool for your diary: off/.test(await page.locator(".privacypanel").textContent()) && /contact@emergencepathways\.org/.test(await page.locator(".privacypanel").textContent()), "About → Privacy: the choice, and whom to contact");
await page.locator(".privacypanel").getByRole("button", { name: "Yes, use LanguageTool" }).click();
await page.locator(".tabbar").getByRole("button", { name: /^Study/ }).click();
await page.getByRole("tab", { name: "Diary" }).click();
check(await page.getByRole("button", { name: "Check my writing" }).isVisible(), "changed there: Check my writing appears");
const firstPrompt = await page.locator(".diaryprompt .q").textContent();
await page.getByRole("button", { name: "Show in English" }).click();
check(await page.locator(".diaryprompt .muted").isVisible(), "the prompt can be shown in English");
await page.getByRole("button", { name: "Skip: another prompt" }).click();
check((await page.locator(".diaryprompt .q").textContent()) !== firstPrompt, "Skip brings another prompt");
const box = page.getByRole("textbox", { name: "Your entry, in Dutch" });
check(await box.getAttribute("autocorrect") === "off" && await box.getAttribute("spellcheck") === "true", "autocorrect off (practice typing), spellcheck on");
await box.fill("Op woe");
await page.locator(".suggestions button", { hasText: "woensdag" }).waitFor();
check((await page.locator(".suggestions button").first().textContent()).includes("de"), "word suggestions while typing, with de/het for nouns");
await page.locator(".suggestions button", { hasText: "woensdag" }).click();
check((await box.inputValue()) === "Op woensdag ", "tapping a suggestion completes the word");
await box.pressSequentially("ga ik naar de markt. Het weer is vandag mooi en ik koop verse groente, fruit en een boterhammetje bij de bakker. Daarna drink ik koffie en lees ik mijn boek op het terras.");
check(await page.getByRole("button", { name: "Save entry" }).isEnabled(), "25 words or more: it can be saved");
await page.getByRole("button", { name: "Check my writing" }).click();
await page.locator(".mistakes li").first().waitFor();
check(await page.locator(".marked mark").textContent() === "vandag", "the mistake is marked in the text");
await page.locator(".mistakes").getByRole("button", { name: "vandaag" }).click();
check((await box.inputValue()).includes("Het weer is vandaag mooi"), "tapping the fix corrects the entry");
check((await box.inputValue()).startsWith("Op woensdag ga ik naar de markt.") && (await box.inputValue()).endsWith("terras."), "typing after a suggestion carries on where the word ended");
await shot("06h-diary");
await page.getByRole("button", { name: "Save entry" }).click();
await page.getByRole("heading", { name: "Saved" }).waitFor();
check(await page.getByText(/This week's diary entry: \+600 XP!/).isVisible(), "the week's first entry earns 600 XP");
check(await page.locator(".toast.reward").isVisible(), "a reward shows as a gold bookplate, not a plain toast");
check((await page.locator(".toast.reward .gain").textContent()) === "+600 XP", "with its +XP set apart");
await page.waitForTimeout(1200);
await shot("06h-reward");
await page.getByRole("button", { name: "Done" }).click();
check(await page.getByRole("textbox", { name: "Your entry, in Dutch" }).isVisible() && /adds 30/.test(await page.locator(".panel").first().textContent()), "more entries are welcome: 30 XP each this week");
check(/1 \/ 20 prompts written/.test(await page.locator(".panel").first().textContent()), "1 of 20 prompts");
check(await page.locator("details.entry").count() === 1, "the entry is kept on this phone");
check(ltChecks.length === 1, "LanguageTool was asked once: only on Check my writing");
check(!posted.some((q) => !q.url.includes("api.languagetool.org") && q.body.includes("boterhammetje")), "the diary text went nowhere else (not to Boekenwurm's servers)");
await page.reload();
await page.locator(".tabbar").getByRole("button", { name: /^Study/ }).click();
await page.getByRole("tab", { name: "Diary" }).click();
await page.locator("details.entry").first().waitFor({ timeout: 5000 }).catch(() => {});
check(await page.locator("details.entry").count() === 1, "still there after a reload");
await page.locator(".tabbar").getByRole("button", { name: "Home", exact: true }).click();
check(!(await page.getByRole("heading", { name: "Weekly diary challenge" }).isVisible()), "Home's weekly card is gone for this week");

step("colour-coded text: off by default; on, words revealed before are coloured");
await page.locator(".tabbar").getByRole("button", { name: "Account", exact: true }).click();
await page.getByRole("tab", { name: "Reading" }).click();
const colourBox = page.getByRole("checkbox", { name: "Colour-coded text" });
check(!(await colourBox.isChecked()), "colour-coded text is off by default");
await colourBox.check();
await page.locator(".tabbar").getByRole("button", { name: "Home", exact: true }).click();
await page.locator(".continue").click();
await page.locator(".para .w").first().waitFor();
// Step back through the paragraphs read earlier (no penalty) until one with a word revealed before.
const colours = () => page.evaluate(() => [...document.querySelectorAll(".para .w")].map((b) => [b.textContent, [...b.classList].find((c) => c.startsWith("c-")) ?? ""]));
let coloured = await colours();
for (let i = 0; i < 8 && !coloured.some(([, c]) => c); i++) {
  const prev = page.getByRole("button", { name: "← Previous" });
  if (!(await prev.isEnabled())) break;
  await prev.click();
  coloured = await colours();
}
check(coloured.some(([, c]) => c === "c-green"), "a word revealed before is green (1 to 3 reveals in 14 days)");
check(coloured.some(([, c]) => c === ""), "words never revealed stay plain");
check(await page.locator(".para .w.name.c-green, .para .w.name.c-yellow, .para .w.name.c-red").count() === 0, "names are never coloured");
await shot("06b-colour-text");
await page.getByRole("button", { name: "Continue →" }).click().catch(() => {});
await page.getByRole("button", { name: "Home" }).first().click().catch(() => {});
await page.locator(".tabbar").waitFor();

step("XP and badges: finishing a book earns 1,000 XP, a badge (+80) and rank A1");
await page.locator(".continue").click();
await page.locator(".para .w").first().waitFor();
check(!/XP|%|A\d/.test(await page.locator(".strip").textContent()), "the reader shows no XP, percentage or rank: just the fouten");
check(/^\d+ of \d+ fouten?$/.test((await page.locator(".strikes").textContent()).trim()), "as \"x of y fouten\"");
check(await page.evaluate(() => { const b = document.querySelector('[aria-label="Go to a page"]').getBoundingClientRect(); return Math.abs(b.left + b.width / 2 - document.documentElement.clientWidth / 2) < 2; }), "the page number sits in the middle of the header");

step("font: a button under the page picks the font pairing, bundled with the app");
await page.getByRole("button", { name: /^Font:/ }).click();
await page.getByRole("radio", { name: /Classic book/ }).click();
check(await page.evaluate(() => document.documentElement.dataset.font) === "source", "Classic book: Source Serif 4 + Source Sans 3");
check(await page.evaluate(() => getComputedStyle(document.querySelector(".para")).fontFamily.includes("Source Serif 4")), "the book text uses it");
await page.getByRole("button", { name: "Done" }).click();
check(await page.evaluate(() => document.fonts.check('16px "Source Serif 4 Variable"')), "the font is loaded from Boekenwurm itself");
const paraSize = () => page.evaluate(() => parseFloat(getComputedStyle(document.querySelector(".para")).fontSize));
check(await page.getByRole("button", { name: "Medium text" }).getAttribute("aria-pressed") === "true", "text size: Medium by default, next to the font");
const medium = await paraSize();
await page.getByRole("button", { name: "Large text" }).click();
const large = await paraSize();
await page.getByRole("button", { name: "Small text" }).click();
const small = await paraSize();
check(small < medium && medium < large, `Small, Medium and Large change the book text (${small}px < ${medium}px < ${large}px)`);
await page.getByRole("button", { name: "Medium text" }).click();
check(await paraSize() === medium && await page.getByRole("button", { name: "Medium text" }).getAttribute("aria-pressed") === "true", "and back to Medium");
for (let i = 0; i < 12 && !(await page.getByRole("heading", { name: /read to the end/ }).isVisible()); i++)
  await page.getByRole("button", { name: "Next page →" }).click({ timeout: 3000 }).catch(() => {});
await page.getByRole("heading", { name: /read to the end/ }).waitFor();
await page.getByText(/Book finished: \+1000 XP|Badge: Books finished|New rank: A1/).first().waitFor({ timeout: 5000 }).catch(() => {});
await page.getByRole("button", { name: "Home" }).first().click();
await page.locator(".hello").waitFor();
check(await page.getByRole("img", { name: /^Rank A1/ }).first().isVisible(), "the rank rose to A1 on its own");
check(await page.getByText("Letterproever").first().isVisible(), "with its title");
await page.locator(".tabbar").getByRole("button", { name: "Account", exact: true }).click();
check(await page.getByRole("tab", { name: "Achievements" }).getAttribute("aria-selected") === "true", "Account opens on Achievements");
check(!(await page.getByText("Fouten per paragraph").isVisible()) && !(await page.getByRole("heading", { name: "Connection check" }).isVisible()), "with Reading and Settings in their own categories");
await page.setViewportSize({ width: 320, height: 844 });
check(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), "Account fits a 320px screen");
await page.setViewportSize({ width: 390, height: 844 });
check(await page.evaluate(() => document.querySelectorAll(".subtabs button").length === 5), "five categories: Achievements, Reading, Settings, Experimental, Privacy");
await page.getByRole("tab", { name: "Privacy" }).click();
check(await page.getByRole("heading", { name: /Boekenwurm privacy notice/ }).isVisible(), "Privacy shows the full notice");
check(await page.getByText(/What an export leaves out/).isVisible() && await page.getByRole("heading", { name: /Legal bases/ }).isVisible(), "unabridged: every section, to the legal bases");
check(await page.locator(".legal table").count() >= 1 && await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), "its table scrolls inside itself, not the page");
await shot("07d-privacy");
await page.getByRole("tab", { name: "Settings" }).click();
await page.getByText(/what Boekenwurm keeps, and where/).click();
await page.getByRole("button", { name: "Read the full privacy notice" }).click();
await page.getByRole("heading", { name: /Boekenwurm privacy notice/ }).waitFor({ timeout: 5000 }).catch(() => {});
check(await page.getByRole("tab", { name: "Privacy" }).getAttribute("aria-selected") === "true", "the short summary in About links to it");
await page.getByRole("tab", { name: "Achievements" }).click();
check((await page.locator(".patchcell").count()) === 12, "Achievements shows the 12 badges");
check(await page.locator(".patchcell.got", { hasText: "Books finished" }).isVisible(), "Books finished is earned (Bronze)");
check(await page.getByRole("img", { name: "Books finished: Bronze" }).isVisible(), "its patch wears the Bronze ribbon");
check((await page.locator(".patchcell:not(.got)").count()) >= 5, "others are still locked");
await shot("07-badges");

step("localization: Account → Settings → Localization switches to Ukrainian or Arabic; Dutch stays Dutch and left-to-right");
await page.getByRole("tab", { name: "Settings" }).click();
await page.getByRole("heading", { name: "Localization" }).waitFor();
await page.getByLabel("Your language").selectOption("uk");
await page.locator(".tabbar").getByRole("button", { name: "Головна", exact: true }).waitFor();
check(await page.evaluate(() => document.documentElement.lang === "uk" && document.documentElement.dir === "ltr"), "Ukrainian: <html lang=uk dir=ltr>");
check(await page.getByRole("heading", { name: "Мова інтерфейсу" }).isVisible(), "the settings are in Ukrainian");
check(await page.getByText(/підготовлено за допомогою ШІ/).isVisible(), "with the note that the translation is an AI draft awaiting review");
await page.getByLabel("Ваша мова").selectOption("ar");
await page.locator(".tabbar").getByRole("button", { name: "الرئيسية", exact: true }).waitFor();
check(await page.evaluate(() => document.documentElement.lang === "ar" && document.documentElement.dir === "rtl"), "Arabic: <html lang=ar dir=rtl>");
await page.setViewportSize({ width: 320, height: 844 });
check(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), "Arabic Account fits a 320px screen");
await shot("07b-arabic-settings");
await page.setViewportSize({ width: 390, height: 844 });
await page.locator(".tabbar").getByRole("button", { name: "الرئيسية", exact: true }).click();
await page.locator(".continue").click();
await page.locator(".para").first().waitFor();
check(await page.evaluate(() => getComputedStyle(document.querySelector(".para")).direction === "ltr"), "the Dutch page reads left to right inside the Arabic app");
check(await page.getByRole("button", { name: /الصفحة التالية/ }).isVisible(), "while the buttons around it are Arabic");
check(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), "the Arabic reader has no sideways scrolling");
await shot("07c-arabic-reader");
await page.getByRole("button", { name: "العودة إلى الرئيسية" }).click();
await page.locator(".tabbar").getByRole("button", { name: "الحساب", exact: true }).click();
await page.getByRole("tab", { name: "الإعدادات" }).click();
await page.getByLabel("لغتك").selectOption("en");
await page.locator(".tabbar").getByRole("button", { name: "Home", exact: true }).waitFor();
check(await page.evaluate(() => document.documentElement.lang === "en" && document.documentElement.dir === "ltr"), "back to English");
await page.locator(".tabbar").getByRole("button", { name: "Home", exact: true }).click();

step("unlimited lookup mode: unlocked by a Bronze badge; no fouten, a quarter of the XP, double flashcard XP after");
await page.locator(".continue").click();
await page.locator(".para .w").first().waitFor();
await page.getByRole("button", { name: "Go to a page" }).click();
await page.getByLabel("Paragraph number").fill("1");
await page.getByRole("button", { name: "Go", exact: true }).click();
await page.getByRole("button", { name: "Unlimited ∞" }).click();
await page.getByText("No fouten.", { exact: true }).waitFor();
check((await page.locator(".strikes").count()) === 0, "the fouten give way to the Unlimited banner");
const xpBefore = await totalXp();
const words = page.locator(".para .w:not(.name)");
const tapCount = Math.min(6, await words.count());
for (let i = 0; i < tapCount; i++) await tapWord(words.nth(i));
check((await page.locator(".para .w.rev").count()) >= 1, "words are looked up freely");
await page.getByRole("button", { name: "Next page →" }).click();
await page.locator(".para .w").first().waitFor();
check((await page.getByRole("heading", { name: /streak lasted|over your fouten/ }).count()) === 0, "looking up every word never ends the run");
const xpAfter = await totalXp();
check(xpAfter - xpBefore <= 8 && xpAfter > xpBefore, `a paragraph earned a quarter of the XP (+${xpAfter - xpBefore})`);
await shot("08-unlimited");
await tapWord(page.locator(".para .w:not(.name)").first());
await page.getByRole("button", { name: "End and study these words" }).click();
await page.getByRole("heading", { name: /in unlimited lookup mode/ }).waitFor();
check(true, "ending the session shows its words");
const n2 = Number((await page.getByRole("button", { name: /Study these/ }).textContent()).match(/\d+/)[0]);
await page.getByRole("button", { name: /Study these/ }).click();
for (let i = 0; i < n2; i++) {
  await page.getByRole("button", { name: "Show meaning" }).click();
  await page.getByRole("button", { name: "Easy", exact: true }).click();
}
check(await page.getByText(/Study: \+80 XP/).waitFor({ timeout: 5000 }).then(() => true, () => false), "studying a lookup-mode session's words earns double (+80 XP)");
await page.getByRole("button", { name: "Keep reading" }).click(); // straight back into the book
await page.getByRole("button", { name: "Back to fouten" }).click();
await page.locator(".strikes").waitFor();
check(true, "and back to fouten");
await page.getByRole("button", { name: "Home" }).first().click();
await page.locator(".hello").waitFor();

step("Me: add a Claude key (mocked) and check the connection");
await page.locator(".tabbar").getByRole("button", { name: "Account", exact: true }).click();
await page.getByRole("tab", { name: "Experimental" }).click();
await page.getByLabel("Claude API key").fill("sk-ant-test-key");
await page.locator("#claude").getByRole("button", { name: "Save" }).click();
check(await page.getByText(/saved/).first().isVisible(), "key saved on this device");
await page.getByRole("tab", { name: "Settings" }).click();
check(!(await page.getByLabel("Claude API key").isVisible()), "Claude lives under Experimental, not Settings");
await page.getByRole("button", { name: "Run check" }).click();
await page.locator(".checklist, .verdict").first().waitFor({ timeout: 15000 });
check(await page.getByText(/Not reachable|Sign-in service/).first().isVisible(), "connection check reports Supabase unreachable here");
check(await page.getByText(/12 Dutch words and 3 word forms/).isVisible(), "the dictionary and its credits are shown under About");
await shot("07-me");

step("add an EPUB with a key: graded level, Match my level (admin only), words in context");
await page.locator(".tabbar").getByRole("button", { name: "Home", exact: true }).click();
await page.getByRole("button", { name: "Add a book" }).click();
await page.locator('input[type=file][accept*="epub"]').setInputFiles(epubPath);
await page.getByText("About B1").waitFor({ timeout: 15000 });
check(!(await page.getByRole("button", { name: "Match my level" }).isVisible()), "Match my level is hidden from readers");
vision.admin = true; // the owner's account: experimental settings
await page.reload();
await page.locator(".continue").waitFor();
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
await tapWord(page.locator(".para .w:not(.name)").first());
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
check((await page.locator(".studycard").count()) === 1, "its words stay: the Daily Challenge is still on Home");
await shot("10-home-two-books");

step("photographing a book: only with the access code (Google reads the pages)");
await page.getByRole("button", { name: "Add a book" }).click();
await page.getByText("EPUB file").waitFor();
check((await page.getByRole("button", { name: /Photograph a book/ }).count()) === 0, "without the code, Add a book offers no photographing");
await page.getByRole("button", { name: "Home" }).first().click();
await page.locator(".tabbar").getByRole("button", { name: "Account", exact: true }).click();
await page.getByRole("tab", { name: "Experimental" }).click();
const codeBox = page.getByLabel("Access code");
await codeBox.fill("BW-NOPE-NOPE");
await page.getByRole("button", { name: "Use code" }).click();
check(await page.getByText("That code isn't valid").waitFor({ timeout: 5000 }).then(() => true, () => false), "a wrong code is refused");
await codeBox.fill("bw-e2e test-code");
await page.getByRole("button", { name: "Use code" }).click();
await page.getByText("Google page reading is on.", { exact: true }).waitFor();
check(true, "the right code turns on Google page reading");
await shot("18-access-code");
await page.locator(".tabbar").getByRole("button", { name: "Home", exact: true }).click();

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
  15: ["Na het werk fietste Lotte langs de gracht naar huis, waar de bomen al bijna al hun bladeren kwijt waren.", "Bij de bakker op de hoek kocht ze een bruin brood en twee appelflappen voor haar buurman."],
  16: ["Haar buurman Kees zat zoals altijd op het bankje voor zijn deur en las de krant van gisteren.", "Hij was blij met de appelflap en vertelde over zijn kleinzoon, die net had leren fietsen."],
  17: ["Toen het donker werd, maakte Lotte soep van de groenten die nog in de koelkast lagen.", "Ze at aan het raam en keek naar de lichtjes van de boten die langzaam voorbij voeren."],
};
async function pagePhoto(n, { number = true, blank = false } = {}) {
  const p = await browser.newPage({ viewport: { width: 700, height: 950 } });
  const body = blank
    ? `<div style="filter:blur(14px);opacity:.25">${(STORY[n] ?? STORY[9]).map((t) => `<p>${t}</p>`).join("")}</div>`
    : `${(STORY[n] ?? []).map((t) => `<p>${t}</p>`).join("")}${number ? `<div style="position:absolute;bottom:40px;left:0;right:0;text-align:center">${n}</div>` : ""}`;
  const mark = `<div style="position:absolute;left:0;top:0;width:44px;height:44px;background:rgb(${n * 6},${blank ? 200 : number ? 100 : 0},0)"></div>`;
  await p.setContent(`<html><body style="margin:0;background:#fbfaf5"><div style="position:relative;height:950px;padding:70px 80px;box-sizing:border-box;font:26px/1.55 'Liberation Serif',Georgia,serif;color:#222;text-align:justify">${mark}${body}</div></body></html>`);
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
check(await page.getByText(/Photograph the pages in order, starting at page 9/).waitFor().then(() => true, () => false), "the pages start at the first page");

step("pages are numbered in the order taken; the number read from each photo is shown next to it");
// Taken in this order: 9, 10 (number cut off), 12, 11 (out of order), then a blurry photo where 13 should be.
for (const f of [await pagePhoto(9), await pagePhoto(10, { number: false }), await pagePhoto(12), await pagePhoto(11), await pagePhoto(13, { blank: true })])
  await page.locator("input[type=file][multiple]").setInputFiles(f);
await page.waitForFunction(() => document.querySelectorAll(".thumb .spinner").length === 0, null, { timeout: 180000 });
const thumbs = async () => {
  const pg = (await page.locator(".thumb .pg").allTextContents()).map((t) => t.trim());
  const seen = (await page.locator(".thumb .seen").allTextContents()).map((t) => t.trim());
  return pg.map((t, i) => `${t} (${seen[i]})`);
};
const nums = async () => (await page.locator(".thumb .pg").allTextContents()).map((t) => t.match(/\d+/)[0]).join(",");
const first = await thumbs();
console.log("    thumbnails:", first.join(" | "));
check((await nums()) === "9,10,11,12,13", "photos are pages 9 to 13 in the order taken, whatever was read on them");
check(first[1].includes("read –") && first[2].includes("read 12") && first[3].includes("read 11"), "the number read from each photo is shown next to its page number");
check(first[2].includes("⚑") && first[3].includes("⚑") && !first[1].includes("⚑"), "a different number read is flagged; no number read is not");
check((await page.locator(".thumb .seen.off").count()) === 2, "and the differing readings are marked");
check(await page.getByText("Next photo: page 14").isVisible(), "the next photo will be page 14");
await shot("13-pages-flagged");

step("review: use the numbers read for the two swapped pages, retake the blurry photo in its place");
await page.getByRole("button", { name: "Review", exact: true }).click();
await page.locator("[aria-label='Check this page']").waitFor();
check(await page.getByText(/In order this is page 11, but the photo seems to show page 12/).isVisible(), "the review explains the difference");
await page.getByRole("button", { name: "Use 12" }).click();
check((await nums()) === "9,10,12,13,14", "changing page 11 to 12: the photos after it follow (13, 14)");
await page.locator("[aria-label='Check this page']").waitFor();
check(await page.getByText(/In order this is page 13, but the photo seems to show page 11/).waitFor({ timeout: 5000 }).then(() => true, () => false), "the next difference is the page taken out of order");
await page.getByRole("button", { name: "Use 11" }).click();
check((await nums()) === "9,10,11,12,13", "typing 11 back moves it before 12, and the photo after it stays 13");
// The review moves on to the blurry photo. Retake it.
await page.locator("[aria-label='Check this page']").waitFor();
await page.getByRole("button", { name: "Retake photo" }).click();
await page.locator("input[type=file][multiple]").setInputFiles(await pagePhoto(13));
await page.getByText("Photo replaced. It keeps its place in the book.").waitFor();
await page.waitForFunction(() => document.querySelectorAll(".thumb .spinner").length === 0, null, { timeout: 180000 });
const after = await thumbs();
console.log("    after review:", after.join(" | "));
check((await nums()) === "9,10,11,12,13", "after the review the pages read 9, 10, 11, 12, 13");
check(after.length === 5, "the retake replaced the photo instead of adding one");
check(after.filter((t) => t.includes("*")).length === 2, "the two numbers changed by hand are marked");
await shot("14-pages-ordered");

step("a gap in the page numbers: missed a page, or a page with no text?");
// Page 14 is a picture and page 16 was skipped: the photos of 15 and 17 come out as 14 and 15 until fixed.
for (const n of [15, 17]) {
  await page.locator("input[type=file][multiple]").setInputFiles(await pagePhoto(n));
  await page.waitForFunction(() => document.querySelectorAll(".thumb .spinner").length === 0, null, { timeout: 180000 });
  await page.locator(".thumb", { hasText: `read ${n}` }).click();
  await page.getByRole("button", { name: `Use ${n}` }).click();
  await page.locator("[aria-label='Check this page']").waitFor({ state: "detached" }).catch(() => {});
}
check((await nums()) === "9,10,11,12,13,15,17", "the two fixed pages leave gaps at 14 and 16");
await page.getByRole("button", { name: /^Start reading/ }).click();
const gapPrompt = page.getByRole("group", { name: "Missed a page?" });
await gapPrompt.waitFor();
check(await gapPrompt.getByText("Page 14 isn't in the book.").isVisible(), "before reading, the reader is asked about page 14");
check(await gapPrompt.getByText("(2 gaps to check.)").isVisible(), "with the number of gaps");
await shot("14b-missed-page");
await gapPrompt.getByRole("button", { name: /No text: it's a picture, a map, or left out on purpose/ }).click();
await gapPrompt.getByText("Page 16 isn't in the book.").waitFor();
check(await page.locator(".thumb.notext", { hasText: "p. 14" }).isVisible(), "page 14 is marked as having no text");
await gapPrompt.getByRole("button", { name: "Photograph page 16" }).click();
check(await page.getByText("Photograph page 16. It goes into its place in the book.").isVisible(), "the camera asks for the missed page");
await page.locator("input[type=file][multiple]").setInputFiles(await pagePhoto(16));
await page.waitForFunction(() => document.querySelectorAll(".thumb .spinner").length === 0, null, { timeout: 180000 });
check((await nums()) === "9,10,11,12,13,14,15,16,17", "the missed page slots into place: no gaps left");
check(await page.locator(".thumb", { hasText: "p. 16" }).getByText("read 16").isVisible(), "and it was read as page 16");
check((await gapPrompt.count()) === 0, "no more questions");
await shot("14c-gaps-settled");

step("reading the photographed book in order, and going to a page");
await page.getByRole("button", { name: /^Start reading/ }).click();
await page.locator(".para .w").first().waitFor();
check((await page.locator(".folio .num").textContent()).startsWith("p. 9"), "reading starts at page 9");
check((await page.locator(".para").textContent()).startsWith("Het was nog vroeg"), "with page 9's first paragraph");
// Leaving the camera deletes the photos of pages read and checked; their text stays to read.
const photos = await page.evaluate(async () => {
  const db = await new Promise((ok) => { const r = indexedDB.open("boekenwurm-app"); r.onsuccess = () => ok(r.result); });
  const get = (store, op) => new Promise((ok) => { const r = op(db.transaction(store).objectStore(store)); r.onsuccess = () => ok(r.result); });
  const keys = (await get("blobs", (s) => s.getAllKeys())).filter((k) => String(k).startsWith("page:"));
  const lists = (await get("kv", (s) => s.getAllKeys())).filter((k) => String(k).startsWith("pages:"));
  const entries = (await Promise.all(lists.map((k) => get("kv", (s) => s.get(k))))).flat();
  return { kept: keys.length, deleted: entries.filter((e) => e.photoDeleted).length, taken: entries.filter((e) => !e.noText).length };
});
check(photos.deleted > 0 && photos.kept + photos.deleted === photos.taken, `page photos deleted once read and checked (${photos.deleted} of ${photos.taken}; ${photos.kept} kept to check)`);
await page.getByRole("button", { name: "Go to a page" }).click();
await page.getByLabel("Page number").fill("12");
await page.getByRole("button", { name: "Go", exact: true }).click();
check(await page.waitForFunction(() => document.querySelector(".folio .num")?.textContent?.startsWith("p. 12"), null, { timeout: 10000 }).then(() => true, () => false), "Go to page 12 lands on page 12");
await shot("15-reader-page-12");
await page.getByRole("button", { name: "Go to a page" }).click();
await page.getByLabel("Page number").waitFor();
check(!(await page.getByText(/Missing: page/).isVisible()), "the page with no text isn't listed as missing");
await page.getByLabel("Page number").fill("14");
await page.getByRole("button", { name: "Go", exact: true }).click();
check(await page.getByText("Page 14 has no text to read; going to page 15.").waitFor({ timeout: 5000 }).then(() => true, () => false), "Go to page 14 (a picture) explains and goes to page 15");

// Read to the end of what's photographed: the app asks for the next section.
const nextSection = page.getByText(/Next pages: from page 18, up to 20 a day/);
for (let i = 0; i < 60 && !(await nextSection.isVisible()); i++)
  await page.getByRole("button", { name: "Next page →" }).click({ timeout: 3000 }).catch(() => {});
await nextSection.waitFor();
check(true, "at the end of the photographed pages, the next pages are offered from page 18");
await shot("16-next-section");

step("20 pages a day for the whole account: the camera stops at today's 20, whatever the book");
vision.used = 0; // a new day
await page.getByRole("button", { name: "Photograph the next pages" }).click();
check(await page.getByText(/Photograph the pages in order, starting at page 18\. Google reads each page: up to 20 pages a day, for all your books together/).waitFor().then(() => true, () => false), "the next pages start at page 18, with the daily 20 explained");
check(await page.getByText("20 of today's 20 pages left").waitFor({ timeout: 5000 }).then(() => true, () => false), "a new day: 20 pages left");
const blanks = await Promise.all(Array.from({ length: 21 }, (_, i) => pagePhoto(18 + i, { blank: true })));
await page.locator("input[type=file][multiple]").setInputFiles(blanks.map((b, i) => ({ ...b, name: `leeg-${i}.jpg` })));
await page.getByText("Today's 20 pages are used, for all your books. Photograph more tomorrow.").first().waitFor({ timeout: 60000 });
check((await page.locator(".thumb:not(.notext)").count()) === 28, "20 photos were taken today (the 21st was not)");
check((await page.locator("video").count()) === 0 && (await page.getByRole("button", { name: "Take photo" }).count()) === 0, "the camera closes when today's 20 are used");
await shot("17-section-full");
await page.waitForFunction(() => document.querySelectorAll(".thumb .spinner").length === 0, null, { timeout: 300000 });


step("Google page reading: the page number at the foot; a new book shares today's 20; nothing read on the device");
// From here Google sees the Sem aan zee page; two of today's 20 pages are left.
vision.marked = false;
vision.used = 18;
await page.getByRole("button", { name: /Done/ }).first().click();
await page.locator(".tabbar").getByRole("button", { name: "Home", exact: true }).click();
await page.getByRole("button", { name: "Add a book" }).click();
await page.getByRole("button", { name: /Photograph a book/ }).click();
await page.locator("input[type=file][multiple]").setInputFiles(await coverPhoto());
await page.getByLabel("Title").fill("Sem aan zee");
await page.getByLabel("First page to read").fill("5");
await page.getByLabel("Last page").fill("40");
await page.getByRole("group", { name: "The book's level" }).getByRole("button", { name: "A1" }).click();
await page.getByRole("button", { name: /photograph the pages/ }).click();
check(await page.getByText(/Google reads each page: up to 20 pages a day, for all your books together/).waitFor({ timeout: 5000 }).then(() => true, () => false), "the camera says Google reads the pages, 20 a day for all books");
check(await page.getByText("2 of today's 20 pages left").waitFor({ timeout: 5000 }).then(() => true, () => false), "a new book shares the account's 20: 2 left today");
const callsBefore = vision.calls;
await page.locator("input[type=file][multiple]").setInputFiles(await pagePhoto(9));
await page.waitForFunction(() => document.querySelectorAll(".thumb .spinner").length === 0, null, { timeout: 60000 });
check(vision.calls === callsBefore + 1 && vision.sentJpeg, "the photo was sent to the read-page function as a JPEG");
check((await thumbs())[0] === "p. 5 (read 5)", "the page number at the foot is read; the chapter number above the text isn't taken for it");
await page.locator(".thumb").first().click();
check(await page.getByText(/Read by Google/).isVisible(), "the page says it was read by Google");
await page.getByRole("button", { name: "Close" }).click();
vision.refuse = "Cloud Vision API has not been used in project 123 before or it is disabled.";
await page.locator("input[type=file][multiple]").setInputFiles(await pagePhoto(10));
await page.waitForFunction(() => document.querySelectorAll(".thumb .spinner").length === 0, null, { timeout: 60000 });
await page.locator(".thumb").nth(1).click();
check(await page.getByText(/The Cloud Vision API isn't turned on in the Google Cloud project\. Google said: “Cloud Vision API has not been used/).isVisible(),
  "when Google refuses, the page says why, in plain words and in Google's");
check(!(await page.getByText(/Read on this device/).isVisible()), "and nothing is read on the device instead");
await shot("20-google-refused");
vision.refuse = null;
await page.getByRole("button", { name: "Read again" }).click();
for (let i = 0; i < 300 && vision.used < 20; i++) await page.waitForTimeout(100);
await page.waitForFunction(() => document.querySelectorAll(".thumb .spinner").length === 0, null, { timeout: 60000 });
check(vision.used === 20, "read again, Google reads it: today's 20 are used");
check(await page.getByText("Today's 20 pages are used, for all your books. Photograph more tomorrow.").first().isVisible()
  && (await page.getByRole("button", { name: "Take photo" }).count()) === 0, "the camera is closed until tomorrow");
await shot("19-daily-limit");
await page.getByRole("button", { name: /^Start reading/ }).click();
await page.locator(".para").first().waitFor();
check((await page.locator(".para").first().textContent()).startsWith("1 De bus naar het strand"), "the chapter number is read together with its first paragraph");

step("20 pages read: a milestone unlocks with 100 XP (books without page numbers: 250 words a page)");
{
  // Invented Dutch text: 21 paragraphs of 250 words each, so the 20th page turn finishes page 20.
  const zinnen = [
    "Op zaterdag loopt Sanne met haar hond langs het water van de gracht.",
    "De bakker op de hoek verkoopt elke ochtend warm brood en zoete broodjes.",
    "In de bibliotheek leest een oude man de krant bij het grote raam.",
    "Na de les drinken de studenten samen thee in een klein café.",
    "Het regent zacht, maar de kinderen spelen toch buiten op het plein.",
    "Mijn buurvrouw fietst elke dag naar haar werk in het centrum van de stad.",
    "Op de markt kiest Ahmed rode appels en een bos verse bloemen.",
    "In de trein naar huis schrijft Lotte een lange brief aan haar oma.",
  ];
  const words = zinnen.join(" ").split(" ");
  const para = (k) => Array.from({ length: 250 }, (_, i) => words[(i + k * 7) % words.length]).join(" ").replace(/\.?$/, ".");
  const longPath = await epub("Lange dagen", "Test Auteur", Array.from({ length: 21 }, (_, k) => para(k)), "bw-e2e-lange-dagen.epub");
  await page.getByRole("button", { name: "Back to Home" }).click();
  await page.locator(".tabbar").getByRole("button", { name: "Home", exact: true }).click();
  await page.getByRole("button", { name: "Add a book" }).first().click();
  await page.locator('input[type=file][accept*="epub"]').setInputFiles(longPath);
  await page.getByText("Ready to read").waitFor({ timeout: 30000 });
  await page.getByRole("group", { name: "Book level" }).getByRole("button", { name: "A2" }).click();
  await page.getByRole("button", { name: "Add to my books" }).click();
  await page.locator(".para .w").first().waitFor();
  for (let i = 0; i < 19; i++) {
    await page.getByRole("button", { name: "Next page →" }).click();
    await page.waitForFunction((n) => document.querySelector(".folio .num")?.textContent?.startsWith(`${n} /`), i + 2, { timeout: 5000 });
  }
  check(!(await page.locator(".unlock").isVisible()), "19 pages: nothing yet");
  await page.getByRole("button", { name: "Next page →" }).click();
  const banner = page.locator(".unlock");
  check(await banner.waitFor({ timeout: 5000 }).then(() => true, () => false), "the 20th page unlocks a milestone at the top of the screen");
  check((await banner.textContent()).includes("20 pages read") && (await banner.textContent()).includes("Lange dagen · +100 XP"), "\"20 pages read\", the book and +100 XP");
  await page.waitForTimeout(1900);
  await shot("21-milestone");
  await banner.waitFor({ state: "detached", timeout: 8000 });
  await page.getByRole("button", { name: "Next page →" }).click();
  await page.waitForTimeout(400);
  check(!(await page.locator(".unlock").isVisible()), "page 21 earns nothing more");
  await page.getByRole("button", { name: "Back to Home" }).click();
  await page.locator(".tabbar").getByRole("button", { name: "Account", exact: true }).click();
  check((await page.locator(".patchcell").count()) === 12, "it isn't an achievement: still the same 12 badges");
}

step("the secret Mörk Borg mode: the Hex-bound Collector reads the cursed book until death");
{
  const enterCode = async (code) => {
    await page.locator(".tabbar").getByRole("button", { name: "Account", exact: true }).click();
    await page.getByRole("tab", { name: "Experimental" }).click();
    await page.getByLabel("Access code").fill(code);
    await page.getByRole("button", { name: "Use code" }).click();
  };
  // A C1 reader: none of the books so far (A1–B2) is good enough for the cursed book.
  await page.getByRole("tab", { name: "Reading" }).click();
  await page.getByLabel("Reading level").selectOption("C1");
  await enterCode("MÖRK BORG");
  await page.getByRole("heading", { name: "Hex-bound Collector", exact: true }).waitFor({ timeout: 5000 });
  check(await page.getByText(/Your life will be payment enough/).isVisible(), "the code opens the backstory");
  check(await page.getByText(/Begins with 1d4 × 10s and d2 Omens/).isVisible() && await page.getByText(/your weapon is d6 instead of d10/).isVisible(), "with the class: silver, Omens, HP, the book, the scroll");
  check((await page.locator(".tabbar").count()) === 0, "and nothing else: no tabs");
  await shot("22-hexbound-intro");
  await page.reload();
  await page.getByRole("heading", { name: "Hex-bound Collector", exact: true }).waitFor({ timeout: 10000 });
  check(true, "closing and opening the app keeps the game open");
  check(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), "the intro fits a phone screen (no sideways scrolling)");
  await page.getByRole("button", { name: "Take up the book" }).click();
  await page.getByRole("heading", { name: "The book stays blank" }).waitFor({ timeout: 10000 });
  check(await page.getByText(/at least one above your reading level/).isVisible() && await page.getByText(/more than 20 words/).isVisible(), "no book good enough: the character dies, and the requirements are explained");
  await shot("23-hexbound-no-book");
  await page.getByRole("button", { name: "Return to the living" }).click();
  await page.locator(".tabbar").waitFor();
  check(true, "back to the app");

  // A C1 book with unread pages of more than 20 words, made of words the dictionary knows.
  const base = "Op woensdag fietst de bakker naar de markt en koopt brood, vis, groente en fruit voor de hele week";
  // Five pages (the import needs five), 25 words each: 6 fouten on turn 1 (25%), 5 on turn 2 (22%), 4 on turn 3 (19%), whichever page comes up.
  const pages = [`${base} bij de kraam op het plein.`, `${base}, want het is al heel laat.`, `${base} en gaat dan weer naar huis.`, `${base}, zoals hij al jaren lang doet.`, `${base} met een grote tas aan het stuur.`];
  const zwartPath = await epub("Het zwarte boek", "Test Auteur", pages, "bw-e2e-zwarte-boek.epub");
  await page.locator(".tabbar").getByRole("button", { name: "Home", exact: true }).click();
  await page.getByRole("button", { name: "Add a book" }).first().click();
  await page.locator('input[type=file][accept*="epub"]').setInputFiles(zwartPath);
  await page.getByText("Ready to read").waitFor({ timeout: 30000 });
  await page.getByRole("group", { name: "Book level" }).getByRole("button", { name: "C1" }).click();
  await page.getByRole("button", { name: "Add to my books" }).click();
  await page.locator(".para .w").first().waitFor();
  await page.getByRole("button", { name: "Back to Home" }).click();

  await enterCode("mork borg");
  await page.getByRole("button", { name: "Take up the book" }).click();
  await page.getByRole("button", { name: "Begin my journey" }).waitFor({ timeout: 10000 });
  check(await page.getByRole("button", { name: /Dead, exit game mode/ }).isVisible() && (await page.getByRole("button", { name: /Unlimited/ }).count()) === 0, "a blank book, with Dead, exit game mode instead of Unlimited");
  await page.getByRole("button", { name: "Begin my journey" }).click();
  await page.locator(".hb-para").waitFor();
  const fouten = async () => (await page.locator(".hb-fouten").textContent()).trim();
  const first = await fouten();
  check(/^0 of 6 fouten$/.test(first), `a random unread page, at 25% (${first}: 25 words)`);
  await page.locator(".hb-para").getByRole("button", { name: "markt", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".hb-fouten")?.textContent?.startsWith("1 of"));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1300); // let the ink and the stamp settle
  await shot("24-hexbound-turn");
  await page.getByRole("button", { name: "Close the book" }).click();
  await page.getByRole("heading", { name: "The ink obeys" }).waitFor({ timeout: 5000 });
  check(await page.getByText(/\+2 on every roll this turn/).isVisible(), "within the fouten: blessed, +2 this turn");
  check(await page.locator(".hb-recap td", { hasText: "market" }).count() === 1 && (await page.getByRole("button", { name: /Study/ }).count()) === 0, "the words revealed, and no studying");
  await page.waitForTimeout(1300); // let the ink and the stamp settle
  await shot("25-hexbound-blessed");
  await page.getByRole("button", { name: "Next turn" }).click();
  await page.locator(".hb-para").waitFor();
  const second = await fouten();
  check(/^0 of 5 fouten$/.test(second), `the next page forgives less: 22% (${second})`);
  for (const w of ["woensdag", "fietst", "bakker", "markt", "koopt", "brood"]) {
    await page.locator(".hb-para").getByRole("button", { name: w, exact: true }).click();
    await page.keyboard.press("Escape");
  }
  await page.waitForFunction(() => document.querySelector(".hb-fouten")?.textContent?.startsWith("6 of"));
  await page.getByRole("button", { name: "Close the book" }).click();
  await page.getByRole("heading", { name: "You failed to read the cursed book" }).waitFor({ timeout: 5000 });
  check(await page.getByText(/2 damage/).isVisible() && await page.getByText(/−2 on all rolls this turn/).isVisible(), "past the fouten: cursed, 2 damage and −2 this turn");
  await page.waitForTimeout(1300); // let the ink and the stamp settle
  await shot("26-hexbound-cursed");
  await page.getByRole("button", { name: "Next turn" }).click();
  await page.locator(".hb-para").waitFor();
  check(/^0 of 4 fouten$/.test(await fouten()), "and a failed turn tightens the fouten too: 19%");
  await page.getByRole("button", { name: /Dead, exit game mode/ }).click();
  await page.getByRole("button", { name: "Yes, dead" }).click();
  await page.locator(".tabbar").waitFor();
  await page.locator(".tabbar").getByRole("button", { name: "Account", exact: true }).click();
  await page.getByRole("tab", { name: "Achievements" }).click();
  check(await page.getByRole("img", { name: "Mörk Borg Enjoyer, a secret badge" }).isVisible(), "played until death: the secret badge, Mörk Borg Enjoyer");
}

check(fontRequests.length === 0, `no request to a font service (GDPR)${fontRequests.length ? ": " + fontRequests[0] : ""}`);
check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
await browser.close();
server.close();
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
