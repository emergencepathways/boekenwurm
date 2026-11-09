// Boekenwurm playtest: the real engine (Engine.*) driving a minimal reader.
// Your books and word lists are read in this browser only; nothing is uploaded.
const E = Engine;
const $ = (sel, el = document) => el.querySelector(sel);
const h = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const STORE = "boekenwurm-playtest-v1";

// ---------------------------------------------------------------- state
const saved = load();
const S = {
  view: "read",
  settings: Object.assign({ preset: "standard", defPref: "en" }, saved.settings),
  wordbook: saved.wordbook || {},
  progress: saved.progress || E.startProgress("A1", Date.now()),
  userGloss: saved.userGloss || null, // { name, entries: {base: [gloss, article]} }
  book: null,           // { title, source, paragraphs: [{text, tokens}] , verdict }
  pos: saved.samplePos || 0,
  session: null,
  sel: null,            // selected token index in current paragraph
  sentences: {},        // lemma -> sentence it was revealed in (this session)
  summary: null,        // { kind, streakLength, list }
  cards: null,          // flashcard queue
  importNote: null,
  matched: new Map(),   // pos -> { status: "pending"|"done"|"failed", text, tokens, changed, originalLevel, note }
  explained: new Map(), // "pos|i|mode" -> { status, data, error }
  waiting: false,       // the current paragraph is being matched to the reader's level
  showOriginal: false,
};
const KEY_STORE = "boekenwurm-claude-key";
S.settings.models = Object.assign({ match: "claude-sonnet-5-5", words: "claude-sonnet-5-5" }, S.settings.models);
function claudeKey() { try { return localStorage.getItem(KEY_STORE) || ""; } catch { return ""; } }
function setClaudeKey(k) { try { k ? localStorage.setItem(KEY_STORE, k) : localStorage.removeItem(KEY_STORE); } catch { /* ignore */ } }

function load() { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; } }
function persist() {
  try {
    localStorage.setItem(STORE, JSON.stringify({
      settings: S.settings, wordbook: S.wordbook, progress: S.progress, userGloss: S.userGloss,
      samplePos: S.book && S.book.source === "sample" ? S.pos : undefined,
    }));
  } catch { /* storage unavailable: progress lasts for this visit */ }
}

// ---------------------------------------------------------------- language helpers (mirror services/ingest)
const NL = new Set("de het een en van ik je jij niet dat op te zijn met voor maar er ook naar wat hij zij we wij ze mijn nog bij uit om aan dit deze wordt werd kan moet wil geen veel heel hoe waar wie omdat hebben heeft hun jullie haar zich zo dan toen al nu wel".split(" "));
const EN = new Set("the and of to a that it with for you he she they this are have not but what which from by be at would there their his her was were been has had will can do does said".split(" "));
const DE = new Set("der und ist nicht ich sie das ein eine mit auf sich auch dem zu den es war für von wird aber noch nach wie wenn nur oder bei sind hat haben werden".split(" "));
const OLD = new Set("zoo zooals zoodra zoowel zoolang oogen oogenblik oogenblikje ooren groote grooter grootste loopen koopen rooken hooren boomen noodig heeren eenen eener eenige eenigen eenigszins leeren deelen beenen steenen meenen weenen keeren veele vreezen leezen mensch menschen menschelijk visch vleesch tusschen wensch wenschen engelsch fransch duitsch hollandsch nederlandsch frisch valsch wasch eene mijne uwe hunne onzen dezen welken zijnen haren zeide thans alsdan gaarne zóó zyn myn wy zy hy tyd blyven schryven ryk".split(" "));
const WORD_RE = /\p{L}+(?:['’-]\p{L}+)*/gu;
const words = (t) => t.match(WORD_RE) || [];
function langOf(text) {
  const ws = words(text).map((w) => w.toLowerCase());
  const s = { nl: 0, en: 0, de: 0 };
  for (const w of ws) { if (NL.has(w)) s.nl++; if (EN.has(w)) s.en++; if (DE.has(w)) s.de++; }
  const best = Object.keys(s).sort((a, b) => s[b] - s[a])[0];
  const mixed = s.en + s.de >= 2 && s.en + s.de >= 0.35 * Math.max(s.nl, 1);
  return { lang: s[best] ? best : "und", mixed, n: ws.length };
}
const isOld = (w) => { w = w.toLowerCase(); return OLD.has(w) || (w.length >= 5 && w.endsWith("sch") && !w.endsWith("isch") && !["bosch", "esch", "marsch"].includes(w)); };

// Tokens: word | name | number | punct. "'s" (as in 's avonds) is part of the next word's meaning.
const TOKEN_RE = /((?:'|’)s(?=\s))|(\p{L}+(?:['’-]\p{L}+)*)|(\d+(?:[.,:]\d+)*)|([^\p{L}\d]+)/gu;
function tokenize(text, isName) {
  const out = []; let start = true; let m;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(text))) {
    if (m[2]) {
      const name = isName(m[2], start);
      out.push({ t: m[2], k: name ? "name" : "word" });
      start = false;
    } else if (m[3]) { out.push({ t: m[3], k: "number" }); start = false; }
    else { out.push({ t: m[0], k: "punct" }); if (/[.!?…:]\s*["'“”‘’»)]*\s*$/.test(m[0])) start = true; }
  }
  return out;
}

// Word list from the textbook tool (private/textbook/wordlist.json). Base forms come from
// packages/dutch: irregular verbs always, regular inflections when the word list knows the result.
let lemmatizer = Dutch.createLemmatizer(Dutch.IRREGULAR);
function buildUserIndex() {
  lemmatizer = Dutch.createLemmatizer(Dutch.IRREGULAR, S.userGloss ? Object.keys(S.userGloss.entries) : undefined);
}
buildUserIndex();

function lookup(surface) {
  const w = surface.toLowerCase();
  if (S.book?.source === "sample") {
    const g = SAMPLE.glossary[w];
    if (g) return { lemma: g[0].toLowerCase(), en: g[1], nl: g[2] };
  }
  const lemma = lemmatizer.lemma(w);
  const u = S.userGloss?.entries[lemma];
  if (u) return { lemma, en: u[0], nl: null, article: u[1] };
  return { lemma, en: null, nl: null };
}

// ---------------------------------------------------------------- books
function sampleBook() {
  const names = new Set(SAMPLE.names);
  return {
    title: SAMPLE.title, source: "sample", verdict: { kind: "accept", text: "Sample story, written for Boekenwurm (A1–A2)." },
    isName: (w) => names.has(w.toLowerCase()), mode: "original",
    paragraphs: SAMPLE.paragraphs.map((text) => ({ text, tokens: tokenize(text, (w) => names.has(w.toLowerCase())) })),
  };
}

async function readEpub(file) {
  if (typeof JSZip === "undefined") throw new Error("The EPUB reader didn't load. Check your connection and reload the page.");
  const zip = await JSZip.loadAsync(file);
  const xml = (s) => new DOMParser().parseFromString(s, "application/xml");
  const container = xml(await zip.file("META-INF/container.xml").async("string"));
  const opfPath = container.querySelector("rootfile").getAttribute("full-path");
  const opf = xml(await zip.file(opfPath).async("string"));
  const base = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";
  const title = opf.getElementsByTagNameNS("*", "title")[0]?.textContent?.trim() || file.name;
  const manifest = {};
  for (const it of opf.getElementsByTagNameNS("*", "item")) manifest[it.getAttribute("id")] = it;
  const blocks = [];
  for (const ref of opf.getElementsByTagNameNS("*", "itemref")) {
    const it = manifest[ref.getAttribute("idref")];
    if (!it || (it.getAttribute("properties") || "").includes("nav") || !(it.getAttribute("media-type") || "").includes("html")) continue;
    const path = decodeURIComponent(base + it.getAttribute("href")).replace(/[^/]+\/\.\.\//g, "");
    const f = zip.file(path); if (!f) continue;
    const doc = new DOMParser().parseFromString(await f.async("string"), "text/html");
    for (const el of doc.querySelectorAll("p, li, blockquote, dd")) {
      if (el.querySelector("p, li, blockquote, dd")) continue;
      const t = el.textContent.replace(/\s+/g, " ").trim();
      if (t) blocks.push(t);
    }
  }
  return { title, blocks };
}

function gate({ title, blocks }) {
  let nlWords = 0, allWords = 0; const paras = [];
  for (const t of blocks) {
    const L = langOf(t);
    if (L.n < 8) continue;
    allWords += L.n;
    if (L.lang === "nl" && !L.mixed) { nlWords += L.n; paras.push(t); }
  }
  const dutch = paras.flatMap(words);
  const old = dutch.filter(isOld);
  const per10k = dutch.length ? Math.round((old.length / dutch.length) * 100000) / 10 : 0;
  const share = allWords ? nlWords / allWords : 0;
  const top = Object.entries(old.reduce((m, w) => ((m[w.toLowerCase()] = (m[w.toLowerCase()] || 0) + 1), m), {}))
    .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w, n]) => `${w} ×${n}`).join(", ");
  let verdict;
  if (paras.length < 5) verdict = { kind: "reject", text: `No usable Dutch text: only ${paras.length} Dutch paragraphs of 8 words or more.` };
  else if (per10k > 15) verdict = { kind: "reject", text: `This book uses spelling from before 1955 (${per10k} old forms per 10,000 words: ${top}). Reading it would teach forms that are no longer correct, so it can't be used.` };
  else if (per10k > 5) verdict = { kind: "warn", text: `Some old spelling (${per10k} per 10,000 words: ${top}). Usable, but watch for old forms.` };
  else if (share < 0.6) verdict = { kind: "accept", text: `A learner book: ${Math.round(share * 100)}% Dutch. Its ${paras.length} Dutch passages can be used.` };
  else verdict = { kind: "accept", text: `Modern Dutch, ${paras.length} paragraphs.` };

  // Names: capitalised mid-sentence, and never written in lowercase anywhere in the book.
  const lower = new Set();
  for (const p of paras) for (const w of words(p)) if (w[0] === w[0].toLowerCase()) lower.add(w.toLowerCase());
  const isName = (w, start) => !start && w[0] !== w[0].toLowerCase() && !lower.has(w.toLowerCase());
  return { title, source: "epub", verdict, isName, paragraphs: paras.map((text) => ({ text, tokens: tokenize(text, isName) })) };
}

// ---------------------------------------------------------------- session flow
const rules = () => E.rulesFor(S.settings.preset);
const original = () => S.book.paragraphs[S.pos];
/** The paragraph as the reader sees it: matched to their level when that's on and ready, otherwise the original. */
function para() {
  const m = S.book.mode === "match" ? S.matched.get(S.pos) : null;
  return m && m.status === "done" && m.changed ? { text: m.text, tokens: m.tokens, matched: true } : original();
}
const lemmasOf = (p) => p.tokens.filter((t) => t.k === "word").map((t) => lookup(t.t).lemma);

function startNewSession() {
  S.session = E.startSession(rules(), { id: `s-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` });
  S.sentences = {}; S.summary = null; S.sel = null;
  beginCurrent();
}
function beginCurrent() {
  if (S.pos >= S.book.paragraphs.length) S.pos = 0;
  S.sel = null; S.showOriginal = false;
  if (S.book.mode === "match") {
    for (const ahead of [1, 2]) ensureMatched(S.pos + ahead); // prepare the next pages while this one is read
    const m = S.matched.get(S.pos);
    if (!m || m.status === "pending") {
      S.waiting = true;
      const pos = S.pos;
      ensureMatched(pos).then(() => {
        if (S.pos !== pos || !S.waiting) return;
        S.waiting = false;
        S.session = E.beginParagraph(S.session, `p${pos}`, lemmasOf(para()));
        render();
      });
      return;
    }
  }
  S.waiting = false;
  S.session = E.beginParagraph(S.session, `p${S.pos}`, lemmasOf(para()));
}

function sentenceAround(text, word) {
  const parts = text.match(/[^.!?]+[.!?"”]*/g) || [text];
  return (parts.find((s) => s.toLowerCase().includes(word.toLowerCase())) || text).trim();
}

function tap(i) {
  const tok = para().tokens[i];
  S.sel = i;
  if (tok.k === "word") {
    const d = lookup(tok.t);
    const before = E.status(S.session).used;
    S.session = E.reveal(S.session, { lemma: d.lemma, surface: tok.t, at: Date.now() });
    if (E.status(S.session).used > before) S.sentences[d.lemma] ??= sentenceAround(para().text, tok.t);
    explain(i);
  }
  render();
}
function undo() {
  const tok = para().tokens[S.sel];
  S.session = E.undoReveal(S.session, lookup(tok.t).lemma, Date.now());
  render();
}

function turn() {
  if (!S.session?.current) return;
  const out = E.turnPage(S.session);
  S.session = out.session;
  if (out.kind === "continue") {
    if (out.tokenEarnedNow) {
      S.progress = E.recordSession(S.progress, S.session, Date.now()).progress;
      toast("Streak token earned: 10 paragraphs in a row!");
    }
    S.pos++;
    if (S.pos >= S.book.paragraphs.length) return finish("complete", out.session.passesInARow);
    beginCurrent();
  } else {
    S.pos++;
    finish("ended", out.streakLength);
  }
  persist(); render();
}

function finish(kind, streakLength) {
  const now = Date.now();
  S.wordbook = E.applySession(S.wordbook, S.session, now);
  S.progress = E.recordSession(S.progress, S.session, now).progress;
  S.summary = { kind, streakLength, list: E.studyList(S.session, S.wordbook), paragraphs: S.session.results.length };
  S.session = null;
  if (S.pos >= S.book.paragraphs.length) S.pos = 0;
  persist(); render();
  if (S.progress.offer) showOffer();
}

// ---------------------------------------------------------------- Claude: book level, level matching, words in context
// The reader's own Claude key, sent only to api.anthropic.com from this browser.
class AiError extends Error {}
async function claude(prompt, model) {
  const key = claudeKey();
  if (!key) throw new AiError("Add your Claude API key under Profile to use this.");
  let res;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({ model, max_tokens: prompt.maxTokens, system: prompt.system, messages: [{ role: "user", content: prompt.user }] }),
    });
  } catch {
    throw new AiError("Couldn't reach Claude from this page. Level matching works on the hosted Boekenwurm site, or check your connection.");
  }
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json())?.error?.message || ""; } catch { /* no body */ }
    if (res.status === 401 || res.status === 403) throw new AiError("Claude refused your API key. Check it under Profile.");
    if (res.status === 404) throw new AiError(`Claude doesn't know the model "${model}". Pick another under Profile.`);
    if (res.status === 429) throw new AiError("Too many requests to Claude right now, or your spending limit was reached. Try again in a minute.");
    if (res.status === 529 || res.status >= 500) throw new AiError("Claude is busy. Try again in a moment.");
    throw new AiError(`Claude returned an error (${res.status}). ${detail}`);
  }
  const body = await res.json();
  return (body.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
}

// IndexedDB cache: matched paragraphs and explanations stay in this browser, for this reader only.
const idb = (() => {
  let dbp = null;
  const open = () => (dbp ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open("boekenwurm", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("cache");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  }));
  const run = async (mode, fn) => {
    const db = await open(); if (!db) return undefined;
    return new Promise((resolve) => {
      try { const r = fn(db.transaction("cache", mode).objectStore("cache")); r.onsuccess = () => resolve(r.result); r.onerror = () => resolve(undefined); }
      catch { resolve(undefined); }
    });
  };
  return { get: (k) => run("readonly", (st) => st.get(k)), set: (k, v) => run("readwrite", (st) => st.put(v, k)) };
})();

function hash(s) { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return (x >>> 0).toString(36); }
const bookId = (b) => b.id ??= hash(b.title + "|" + b.paragraphs.length + "|" + (b.paragraphs[0]?.text || "").slice(0, 300));

/** Words the reader knows: the word list plus words met often and rarely revealed. */
function knownLemmas() {
  const known = new Set(S.userGloss ? Object.keys(S.userGloss.entries) : []);
  for (const w of Object.values(S.wordbook)) if (w.encounters >= 3 && E.revealRate(w) < 0.5) known.add(w.lemma);
  return known;
}
function knownShare(text, known = knownLemmas()) {
  if (!known.size) return null;
  const toks = tokenize(text, S.book.isName).filter((t) => t.k === "word");
  if (!toks.length) return null;
  return toks.filter((t) => known.has(lookup(t.t).lemma)).length / toks.length;
}

const inflight = new Map();
function ensureMatched(pos) {
  if (!S.book || pos >= S.book.paragraphs.length || S.book.mode !== "match") return Promise.resolve();
  const have = S.matched.get(pos);
  if (have && have.status !== "pending") return Promise.resolve();
  if (inflight.has(pos)) return inflight.get(pos);
  const book = S.book, target = S.progress.level, model = S.settings.models.match;
  const orig = book.paragraphs[pos];
  const key = `m|${bookId(book)}|${pos}|${target}|${model}`;
  S.matched.set(pos, { status: "pending" });
  const job = (async () => {
    const cached = await idb.get(key);
    if (cached) return cached;
    const names = orig.tokens.filter((t) => t.k === "name").map((t) => t.t);
    const checks = { names, language: (t) => langOf(t).lang, isOldForm: isOld, knownShare: (t) => knownShare(t) };
    let prompt = AI.matchPrompt(orig.text, target, names), problems = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = AI.parseMatch(await claude(prompt, model), orig.text);
      problems = AI.validateMatch(orig.text, result, checks);
      if (!problems.length) {
        const value = { status: "done", changed: result.changed, text: result.text, originalLevel: result.originalLevel };
        await idb.set(key, value);
        return value;
      }
      prompt = { ...prompt, user: prompt.user + `\n\nYour previous version had these problems: ${problems.join(" ")} Fix them.` };
    }
    return { status: "failed", note: `Couldn't match this paragraph to ${target}: ${problems.join(" ")} Showing the original.` };
  })().catch((e) => ({ status: "failed", note: e instanceof AiError ? e.message : "Something went wrong while matching this paragraph. Showing the original." }))
    .then((v) => {
      if (S.book !== book) return;
      if (v.status === "done" && v.changed) v.tokens = tokenize(v.text, book.isName);
      S.matched.set(pos, v);
      inflight.delete(pos);
      if (v.status === "failed" && pos === S.pos) toast(v.note);
    });
  inflight.set(pos, job);
  return job;
}

/** Grade the book from paragraphs spread through it; combine with the local word match. */
async function scanBook(book) {
  const known = knownLemmas();
  const shares = book.paragraphs.map((p) => knownShare(p.text, known));
  const valid = shares.filter((x) => x != null);
  const wordMatch = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
  book.scan = { wordMatch, level: null, status: claudeKey() ? "grading" : "local" };
  render(); showScan(book);
  if (!claudeKey()) return;
  const cacheKey = `g|${bookId(book)}|${S.settings.models.match}`;
  try {
    let grades = await idb.get(cacheKey);
    if (!grades) {
      const picks = AI.samplePositions(book.paragraphs.length, 12).map((i) => ({ id: `p${i}`, text: book.paragraphs[i].text, wordMatch: shares[i] }));
      grades = AI.parseGrades(await claude(AI.gradePrompt(picks), S.settings.models.match), picks.map((p) => p.id));
      await idb.set(cacheKey, grades);
    }
    book.scan = { ...book.scan, status: "done", ...AI.bookLevel(grades, S.progress.level, wordMatch) };
  } catch (e) {
    book.scan = { ...book.scan, status: "error", error: e instanceof AiError ? e.message : "Couldn't grade this book." };
  }
  if (S.book === book) { render(); showScan(book); }
}

function explain(i) {
  const tok = para().tokens[i];
  const k = `${S.pos}|${i}|${para().matched ? "m" : "o"}`;
  if (!claudeKey() || tok.k !== "word" || S.explained.has(k)) return;
  const sentence = sentenceAround(para().text, tok.t);
  const cacheKey = `x|${hash(sentence)}|${tok.t.toLowerCase()}|${S.progress.level}|${S.settings.models.words}`;
  S.explained.set(k, { status: "pending" });
  (async () => {
    const cached = await idb.get(cacheKey);
    if (cached) return cached;
    const data = AI.parseExplanation(await claude(AI.explainPrompt(tok.t, sentence, S.progress.level), S.settings.models.words), tok.t);
    await idb.set(cacheKey, data);
    return data;
  })().then((data) => S.explained.set(k, { status: "done", data }))
    .catch((e) => S.explained.set(k, { status: "error", error: e instanceof AiError ? e.message : "Couldn't explain this word." }))
    .finally(() => { if (S.view === "read") render(); });
}

// ---------------------------------------------------------------- rendering
function render() {
  document.querySelectorAll("nav.tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.view === S.view)));
  const t = E.currentTitle(S.progress.badges);
  $("#titlechip").innerHTML = t ? `<span class="label">${h(S.progress.level)}</span><b>${h(t.title)}</b>` : "";
  const main = $("#main");
  if (S.view === "words") main.innerHTML = viewWords();
  else if (S.view === "profile") main.innerHTML = viewProfile();
  else if (S.cards) main.innerHTML = viewCards();
  else if (S.summary) main.innerHTML = viewSummary();
  else main.innerHTML = viewRead();
}

function tokensPips() {
  const need = 3, have = S.progress.offer ? need : S.progress.tokens.length;
  return `<span class="tokens" title="${have} of ${need} streak tokens toward the next level">${Array.from({ length: need }, (_, i) => `<i class="tok ${i < have ? "on" : ""}"></i>`).join("")}</span>`;
}

function viewRead() {
  if (S.waiting || !S.session?.current) {
    return `<article class="sheet"><div class="folio"><span>${h(S.book.title)}</span><span class="num">${S.pos + 1} / ${S.book.paragraphs.length}</span></div>
      <p class="para muted" aria-live="polite">Matching this paragraph to ${h(S.progress.level)}…</p>
      <div class="actions"><button class="btn ghost small" data-act="read-original-now">Read the original instead</button></div></article>`;
  }
  const st = E.status(S.session);
  const r = S.session.rules;
  const lastStrike = r.failWhen === "reaches";
  const pips = Array.from({ length: Math.min(st.allowed, 30) }, (_, i) =>
    `<i class="pip ${i < st.used ? "used" : ""} ${lastStrike && i === st.allowed - 1 && i >= st.used ? "last" : ""}"></i>`).join("");
  const p = para();
  const revealed = new Set(S.session.current.reveals.map((x) => x.lemma));
  const text = p.tokens.map((t, i) => {
    if (t.k === "punct" || t.k === "number") return h(t.t);
    const cls = t.k === "name" ? "name" : revealed.has(lookup(t.t).lemma) ? "rev" : "";
    return `<button class="w ${cls}" data-i="${i}">${h(t.t)}</button>`;
  }).join("");
  const onStreak = E.inStreak(S.session.passesInARow, r);
  return `
  <section class="strip" aria-label="Checkpoint">
    <span><span class="label">Strikes</span> <span class="strikes" aria-label="${st.used} of ${st.allowed} used">${pips}</span></span>
    <span class="num">${st.percent}% · ${st.allowed} ${st.allowed === 1 ? "strike" : "strikes"}</span>
    ${onStreak ? `<span class="streak">Streak ${st.streak}</span>` : ""}
    <span class="grow"></span>
    <span><span class="label">Level</span> ${tokensPips()}</span>
  </section>
  ${st.strikesLeft === 0 && lastStrike ? `<div class="warn">No strikes left: one more reveal ends the run at the page turn.</div>` : ""}
  <article class="sheet" id="sheet">
    <div class="folio"><span>${h(S.book.title)}</span><span class="num">${S.pos + 1} / ${S.book.paragraphs.length}</span></div>
    ${S.book.mode === "match" ? matchedLine(p) : ""}
    <p class="para" lang="nl">${text}</p>
    ${S.showOriginal && p.matched ? `<div class="original"><span class="label">Original</span><p lang="nl">${h(original().text)}</p></div>` : ""}
    <div class="def" aria-live="polite">${defPanel(onStreak)}</div>
    <div class="actions">
      <button class="btn ghost small" data-act="library">Change book</button>
      <button class="btn primary next" data-act="turn">Next page →</button>
    </div>
  </article>
  <p class="muted" style="margin:0;font-size:.82rem">Tap a word to see its meaning. Swipe left, press → or Space to turn the page.</p>
  ${S.importNote ? libraryPanel() : ""}`;
}

function matchedLine(p) {
  const m = S.matched.get(S.pos);
  if (p.matched) return `<div class="matched"><span class="chip">Matched to ${h(S.progress.level)}</span>
    ${m?.originalLevel ? `<span class="muted">original about ${h(m.originalLevel)}</span>` : ""}
    <button class="btn small ghost" data-act="toggle-original">${S.showOriginal ? "Hide original" : "Show original"}</button></div>`;
  if (m?.status === "done") return `<div class="matched"><span class="chip ok">Already at your level</span></div>`;
  if (m?.status === "failed") return `<div class="matched"><span class="chip warn">Original</span><span class="muted">${h(m.note)}</span></div>`;
  return "";
}

function contextPanel(i, lang) {
  const x = S.explained.get(`${S.pos}|${i}|${para().matched ? "m" : "o"}`);
  // The hint only makes sense where the page can reach Claude (the hosted site), not in a preview.
  if (!x) return claudeKey() || !window.BW_HOSTED ? "" : `<span class="note">Add your Claude key under Profile to see what this word means in this sentence.</span>`;
  if (x.status === "pending") return `<span class="note">Checking this sentence…</span>`;
  if (x.status === "error") return `<span class="note">${h(x.error)}</span>`;
  const d = x.data;
  const meaning = lang === "nl" && d.meaningNl ? `<span lang="nl">${h(d.meaningNl)}</span>` : h(d.meaningEn || d.meaningNl);
  return `<div class="ctx-meaning"><span class="label">In this sentence</span>
    <div class="meaning ${lang === "nl" && d.meaningNl ? "nl" : ""}">${d.lemma ? `<b lang="nl">${h(d.lemma)}</b>: ` : ""}${meaning}</div>
    ${d.note ? `<span class="note">${h(d.note)}</span>` : ""}</div>`;
}

function defPanel(onStreak) {
  if (S.sel == null) return `<span class="note">Tap any word you don't know. Names and numbers never count.</span>`;
  const tok = para().tokens[S.sel];
  if (tok.k === "name") return `<div class="head"><span class="word">${h(tok.t)}</span><span class="lemma">name</span></div><span class="note">A name stays as it is. It doesn't use a strike.</span>`;
  const d = lookup(tok.t);
  const lang = E.definitionLanguage({ level: S.progress.level, preference: S.settings.defPref, onStreak });
  const r = S.session.current.reveals.find((x) => x.lemma === d.lemma);
  const canUndo = r && Date.now() - r.at <= S.session.undoWindowMs;
  let meaning;
  if (lang === "nl" && d.nl) meaning = `<div class="meaning nl" lang="nl">${h(d.nl)}</div>`;
  else if (d.en) meaning = `<div class="meaning">${h(d.en)}</div>${lang === "nl" ? `<span class="note">No Dutch explanation for this word yet, so here is the English.</span>` : ""}`;
  else meaning = `<span class="note">Not in your word list yet. The reveal still counts, and the word goes on your list.</span>`;
  const why = lang === "nl" ? (onStreak ? "Dutch explanation: you're on a streak." : "Dutch explanation from B1.") : "";
  const lifetime = S.wordbook[d.lemma]?.reveals || 0;
  return `<div class="head"><span class="word" lang="nl">${h(tok.t)}</span>
      ${d.lemma !== tok.t.toLowerCase() ? `<span class="lemma">${h(d.article ? d.article + " " : "")}${h(d.lemma)}</span>` : d.article ? `<span class="lemma">${h(d.article)}</span>` : ""}
      ${lifetime ? `<span class="lemma">revealed ${lifetime}× before</span>` : ""}
      ${canUndo ? `<button class="btn small ghost undo" data-act="undo">Undo tap</button>` : ""}</div>
    ${meaning}${why ? `<span class="note">${why}</span>` : ""}
    ${contextPanel(S.sel, lang)}`;
}

function viewSummary() {
  const s = S.summary;
  const head = s.kind === "complete"
    ? `<h2 class="big">You read to the end. ${s.streakLength} paragraphs passed in a row.</h2>`
    : `<h2 class="big">${s.streakLength >= 2 ? `Your streak lasted ${s.streakLength} paragraphs.` : s.streakLength === 1 ? "You passed 1 paragraph this time." : "That paragraph used your last strike."}</h2>`;
  const rows = s.list.map((w) => `<tr><td><b lang="nl">${h(w.lemma)}</b><div class="forms">${h(w.forms.join(", "))}</div></td>
      <td>${h(lookupLemma(w.lemma, w.forms[0]))}</td><td class="n">${w.sessionReveals}</td><td class="n">${w.lifetimeReveals}</td></tr>`).join("");
  return `<section class="panel">
    ${head}
    <p>${s.list.length ? `You revealed ${s.list.length} ${s.list.length === 1 ? "word" : "words"}. The ones you've needed most often come first.` : "You didn't reveal a single word."}</p>
    ${s.list.length ? `<div class="tablewrap"><table><thead><tr><th>Word</th><th>Meaning</th><th>Today</th><th>All time</th></tr></thead><tbody>${rows}</tbody></table></div>` : ""}
    <div class="actions">
      ${s.list.length ? `<button class="btn primary" data-act="study">Study these ${s.list.length} words</button>` : ""}
      <button class="btn" data-act="again">Keep reading</button>
    </div>
  </section>`;
}
function lookupLemma(lemma, surface) { const d = lookup(surface); return d.en || "—"; }

function viewCards() {
  const c = S.cards;
  if (!c.queue.length) return `<section class="panel"><h2>Done: ${c.done} ${c.done === 1 ? "word" : "words"} reviewed.</h2>
    <p>These words now carry their reveal counts. The ones that keep coming back show up under Words.</p>
    <div class="actions"><button class="btn primary" data-act="again">Keep reading</button></div></section>`;
  const w = c.queue[0];
  const ctx = S.sentences[w.lemma] || "";
  const blanked = ctx ? h(ctx).replace(new RegExp(`\\b(${w.forms.map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "giu"), "<b>$1</b>") : "";
  return `<section class="panel"><div class="row"><h2>Review</h2><span class="muted num">${c.done + 1} of ${c.done + c.queue.length}</span></div>
    <div class="card">
      <div class="front" lang="nl">${h(w.lemma)}</div>
      ${blanked ? `<div class="ctx" lang="nl">${blanked}</div>` : ""}
      ${c.flipped ? `<div class="back">${h(lookupLemma(w.lemma, w.forms[0]))}</div>` : ""}
    </div>
    <div class="actions">${c.flipped
      ? `<button class="btn" data-act="card-again">Again</button><button class="btn primary" data-act="card-good">Got it</button>`
      : `<button class="btn primary" data-act="card-flip">Show meaning</button>`}</div>
  </section>`;
}

function viewWords() {
  const all = Object.values(S.wordbook).filter((w) => w.reveals > 0).sort((a, b) => b.reveals - a.reveals || a.lemma.localeCompare(b.lemma));
  const stuck = E.notSticking(S.wordbook);
  const row = (w) => { const rate = E.revealRate(w); return `<tr><td><b lang="nl">${h(w.lemma)}</b></td><td class="n">${w.reveals}</td><td class="n">${w.encounters}</td>
    <td><div class="bar" title="${Math.round(rate * 100)}% of encounters revealed"><i style="width:${Math.round(rate * 100)}%"></i></div></td></tr>`; };
  const table = (list) => `<div class="tablewrap"><table><thead><tr><th>Word</th><th>Revealed</th><th>Met</th><th>Reveal rate</th></tr></thead><tbody>${list.map(row).join("")}</tbody></table></div>`;
  return `<section class="panel"><h2>Not sticking yet</h2>
    <p>Words you've met at least 3 times and revealed in half of them or more.</p>
    ${stuck.length ? table(stuck) : `<p class="empty">Nothing yet. Words appear here once they keep coming back.</p>`}</section>
  <section class="panel"><h2>Every word you've revealed</h2>
    ${all.length ? table(all) : `<p class="empty">Read a page and tap a word to start your list.</p>`}</section>`;
}

function viewProfile() {
  const p = S.progress;
  const got = new Map(p.badges.map((b) => [b.level, b]));
  const badges = E.LEVELS.map((l) => {
    const b = got.get(l), info = E.BADGES[l];
    return `<div class="badge ${b ? "got" : ""} ${b?.source === "placement" ? "placement" : ""}"><div class="medal">${l}</div>
      <div class="t" lang="nl">${h(info.title)}</div><div class="m">${h(info.meaning)}${b?.source === "placement" ? " · placed" : ""}</div></div>`;
  }).join("");
  const left = E.tokensToOffer(p);
  return `<section class="panel"><h2>Your badges</h2>
    <p>Every level you reach earns its badge. A dashed ring means the level was set, not earned in play.</p>
    <div class="badges">${badges}</div>
    <div class="row"><span class="label">Toward ${E.nextLevel(p.level) || "—"}</span> ${tokensPips()}
      <span class="muted">${E.nextLevel(p.level) ? (p.offer ? "An offer is waiting." : `${left} more ${left === 1 ? "token" : "tokens"}, each from a separate session with a 10-paragraph streak.`) : "Top level reached."}</span></div>
    <div class="row"><span class="muted">Tokens earned in total: <span class="num">${p.history.length}</span></span></div>
  </section>
  <section class="panel"><h2>Settings</h2>
    <div class="row"><label for="set-preset">Strikes per paragraph</label>
      <select id="set-preset">${["strict", "standard", "relaxed"].map((k) => `<option value="${k}" ${S.settings.preset === k ? "selected" : ""}>${k[0].toUpperCase() + k.slice(1)} · ${E.PRESET_PERCENT[k]}%</option>`).join("")}</select></div>
    <div class="row"><label for="set-def">Definitions below B1</label>
      <select id="set-def"><option value="en" ${S.settings.defPref === "en" ? "selected" : ""}>English</option><option value="nl" ${S.settings.defPref === "nl" ? "selected" : ""}>Dutch</option></select></div>
    <div class="row"><label for="set-level">Level</label>
      <select id="set-level">${E.LEVELS.map((l) => `<option ${p.level === l ? "selected" : ""}>${l}</option>`).join("")}</select>
      <span class="muted">Changing it by hand gives placement badges.</span></div>
    <p>Preset changes apply from your next session.</p>
  </section>
  <section class="panel"><h2>Claude</h2>
    <p>Book levels, matching paragraphs to your level, and word meanings in their sentence use your own Claude API key. It's stored in this browser only and sent only to Anthropic. Use a key with a spending limit (console.anthropic.com → Limits).</p>
    <div class="row"><label for="set-key">API key</label>
      <input id="set-key" type="password" autocomplete="off" spellcheck="false" placeholder="${claudeKey() ? "••••••••  saved" : "sk-ant-…"}" style="flex:1;min-width:0">
      <button class="btn small" data-act="save-key">Save</button>${claudeKey() ? `<button class="btn small ghost" data-act="forget-key">Remove</button><button class="btn small ghost" data-act="test-key">Test</button>` : ""}</div>
    <div class="row"><label for="set-model-match">Book level and matching</label><select id="set-model-match">${modelOptions(S.settings.models.match)}</select></div>
    <div class="row"><label for="set-model-words">Words in context</label><select id="set-model-words">${modelOptions(S.settings.models.words)}</select></div>
    <p>Sonnet is the default: accurate Dutch at a moderate cost. Opus is the most careful and slowest; Haiku is the fastest and cheapest.</p>
  </section>
  <section class="panel"><h3>Playtest tools</h3>
    <p>Shortcuts for trying the level-up flow without reading 30 paragraphs.</p>
    <div class="actions"><button class="btn small" data-act="sim-token">Add a streak token</button>
      <button class="btn small ghost" data-act="reset">Reset all progress</button></div>
  </section>`;
}

const MODELS = [["claude-sonnet-5-5", "Claude Sonnet 5.5"], ["claude-opus-5-5", "Claude Opus 5.5"], ["claude-haiku-5-5", "Claude Haiku 5.5"]];
function modelOptions(current) { return MODELS.map(([id, name]) => `<option value="${id}" ${id === current ? "selected" : ""}>${name}</option>`).join(""); }
async function testKey() {
  try { await claude({ system: "Reply with the single word: ok", user: "ok?", maxTokens: 5 }, S.settings.models.words); toast("Your Claude key works."); }
  catch (e) { toast(e.message); }
}

function libraryPanel() {
  const n = S.importNote;
  return `<section class="panel" id="library"><h2>Choose what to read</h2>
    <div class="actions">
      <button class="btn" data-act="sample">Sample story (A1–A2)</button>
      <label class="file btn" for="f-epub">Open an EPUB…<input id="f-epub" type="file" accept=".epub,application/epub+zip"></label>
    </div>
    <p>Your book is read in this browser only and never uploaded. It goes through the same check as the app: Dutch text only, and no spelling from before 1955.</p>
    ${n?.verdict ? `<div class="verdict ${n.verdict.kind === "reject" ? "bad" : ""}"><b>${h(n.title)}</b><span>${h(n.verdict.text)}</span></div>` : ""}
    ${n?.error ? `<div class="verdict bad"><b>Couldn't open that file</b><span>${h(n.error)}</span></div>` : ""}
    ${S.book?.scan ? `<p><button class="btn small ghost" data-act="rescan">Show this book's level again</button></p>` : ""}
    <h3>Definitions for your own books</h3>
    <p>${S.userGloss ? `Using <b>${h(S.userGloss.name)}</b>: ${Object.keys(S.userGloss.entries).length.toLocaleString()} words.` : "Load the word list made by the textbook tool (wordlist.json) to get meanings for your own books."}</p>
    <div class="actions"><label class="file btn" for="f-gloss">${S.userGloss ? "Replace word list…" : "Load word list…"}<input id="f-gloss" type="file" accept=".json,application/json"></label>
      ${S.importNote ? `<button class="btn ghost" data-act="close-lib">Close</button>` : ""}</div>
  </section>`;
}

// ---------------------------------------------------------------- overlays
let toastTimer;
function toast(msg) {
  clearTimeout(toastTimer);
  const el = document.createElement("div"); el.className = "toast"; el.role = "status"; el.textContent = msg;
  document.querySelectorAll(".toast").forEach((t) => t.remove());
  document.body.append(el); toastTimer = setTimeout(() => el.remove(), 3200);
}
function modal(html) { $("#overlay").innerHTML = `<div class="scrim"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`; $("#overlay .btn")?.focus(); }
function closeModal() { $("#overlay").innerHTML = ""; }
function showScan(book) {
  const sc = book.scan, lvl = S.progress.level;
  const wm = sc.wordMatch == null ? "" : `<div class="stat"><span class="label">Words you know</span><b class="num">${Math.round(sc.wordMatch * 100)}%</b></div>`;
  let body;
  if (sc.status === "grading") body = `<p class="muted">Ranking this book's level with Claude: vocabulary, grammar and context in 12 paragraphs from across the book…</p>`;
  else if (sc.status === "local") body = `<p class="muted">Add your Claude API key under Profile to rank this book's level and read it matched to yours.</p>`;
  else if (sc.status === "error") body = `<p class="muted">${h(sc.error)}</p>`;
  else {
    const above = E.LEVELS.indexOf(sc.level) > E.LEVELS.indexOf(lvl);
    body = `<div class="stats">
        <div class="stat"><span class="label">Book level</span><b>About ${h(sc.level)}</b></div>${wm}
        <div class="stat"><span class="label">At your level</span><b class="num">${Math.round(sc.withinReach * 100)}%</b></div></div>
      ${sc.grammar.length ? `<p><span class="label">Grammar</span> ${h(sc.grammar.join(", "))}</p>` : ""}
      ${sc.context.length ? `<p class="muted">${h(sc.context[0])}</p>` : ""}
      ${above ? `<p>You're reading at ${h(lvl)}. Boekenwurm can match each paragraph above ${h(lvl)} to your level when you reach it, using your Claude key: about one request per paragraph. The original is always one tap away.</p>` : `<p>This book is within your level. Enjoy the original.</p>`}`;
    return modal(`<span class="label">${h(book.title)}</span>${body}
      <div class="actions">${above ? `<button class="btn primary" data-act="mode-match">Match my level</button><button class="btn" data-act="mode-original">Read the original</button>` : `<button class="btn primary" data-act="mode-original">Start reading</button>`}</div>`);
  }
  modal(`<span class="label">${h(book.title)}</span>${sc.status === "grading" ? "" : `<div class="stats">${wm}</div>`}${body}
    <div class="actions">${sc.status === "grading" ? `<button class="btn" data-act="mode-original">Read the original while I wait</button>` : `<button class="btn primary" data-act="mode-original">Read the original</button>`}</div>`);
}

function showOffer() {
  const o = S.progress.offer;
  modal(`<div class="medal">${o.to}</div><h2 class="big" style="font-size:1.4rem">Move up from ${o.from} to ${o.to}?</h2>
    <p class="muted">Three sessions with a 10-paragraph streak. At ${o.to} you'll get harder paragraphs${o.to === "B1" ? ", and explanations in Dutch" : ""}.</p>
    <div class="actions"><button class="btn primary" data-act="accept">Yes, move up</button><button class="btn" data-act="decline">Not yet</button></div>`);
}
function showBadge(b) {
  const info = E.BADGES[b.level];
  modal(`<div class="medal">${b.level}</div><span class="label">New badge</span><h2 class="big" style="font-size:1.6rem" lang="nl">${h(info.title)}</h2>
    <p class="muted">${h(info.meaning)}. You're now reading at ${b.level}.</p><button class="btn primary" data-act="close-modal">Keep reading</button>`);
}

// ---------------------------------------------------------------- events
document.addEventListener("click", (ev) => {
  const tab = ev.target.closest("nav.tabs button");
  if (tab) { S.view = tab.dataset.view; return render(); }
  const w = ev.target.closest(".w");
  if (w) return tap(Number(w.dataset.i));
  const a = ev.target.closest("[data-act]")?.dataset.act;
  if (!a) return;
  const now = Date.now();
  switch (a) {
    case "turn": return turn();
    case "toggle-original": S.showOriginal = !S.showOriginal; return render();
    case "mode-match": closeModal(); S.book.mode = "match"; S.matched.clear(); startNewSession(); return render();
    case "mode-original": closeModal(); if (S.book.mode !== "original") { S.book.mode = "original"; startNewSession(); } return render();
    case "read-original-now": S.book.mode = "original"; S.waiting = false; startNewSession(); toast("Reading the original. Change it under Read → Change book."); return render();
    case "rescan": if (S.book) scanBook(S.book); return;
    case "save-key": { const v = $("#set-key").value.trim(); setClaudeKey(v); toast(v ? "Key saved in this browser." : "Key removed."); return render(); }
    case "forget-key": setClaudeKey(""); toast("Key removed from this browser."); return render();
    case "test-key": testKey(); return;
    case "undo": return undo();
    case "library": S.importNote = S.importNote || {}; render(); return $("#library")?.scrollIntoView({ behavior: "smooth" });
    case "close-lib": S.importNote = null; return render();
    case "sample": S.matched.clear(); S.explained.clear(); S.book = sampleBook(); S.pos = saved.samplePos || 0; S.importNote = null; S.cards = null; startNewSession(); return render();
    case "study": S.cards = { queue: [...S.summary.list], done: 0, flipped: false }; return render();
    case "card-flip": S.cards.flipped = true; return render();
    case "card-again": S.cards.queue.push(S.cards.queue.shift()); S.cards.flipped = false; return render();
    case "card-good": S.cards.queue.shift(); S.cards.done++; S.cards.flipped = false; return render();
    case "again": S.cards = null; startNewSession(); S.view = "read"; return render();
    case "accept": { const r = E.acceptLevelUp(S.progress, now); S.progress = r.progress; S.matched.clear(); persist(); render(); return r.newBadges.length ? showBadge(r.newBadges.at(-1)) : closeModal(); }
    case "decline": S.progress = E.declineLevelUp(S.progress); persist(); closeModal(); return render();
    case "close-modal": closeModal(); return render();
    case "sim-token": {
      let s = E.startSession(E.rulesFor("relaxed"), { id: `sim-${now}` });
      for (let i = 0; i < 10; i++) s = E.turnPage(E.beginParagraph(s, `x${i}`, [])).session;
      S.progress = E.recordSession(S.progress, s, now).progress; persist(); render();
      toast("Added a streak token (simulated session)."); if (S.progress.offer) showOffer(); return;
    }
    case "reset":
      if (ev.target.dataset.confirm !== "1") { ev.target.dataset.confirm = "1"; ev.target.textContent = "Tap again to erase everything"; return; }
      S.wordbook = {}; S.progress = E.startProgress("A1", now); S.pos = 0; saved.samplePos = 0; persist();
      S.book = sampleBook(); startNewSession(); toast("Progress reset."); return render();
  }
});

document.addEventListener("change", async (ev) => {
  const id = ev.target.id, now = Date.now();
  if (id === "set-preset") { S.settings.preset = ev.target.value; persist(); toast("Applies from your next session."); }
  if (id === "set-def") { S.settings.defPref = ev.target.value; persist(); }
  if (id === "set-model-match") { S.settings.models.match = ev.target.value; S.matched.clear(); persist(); }
  if (id === "set-model-words") { S.settings.models.words = ev.target.value; persist(); }
  if (id === "set-level") {
    const r = E.setLevel(S.progress, ev.target.value, now); S.progress = r.progress; S.matched.clear(); persist(); render();
    if (r.newBadges.length) showBadge(r.newBadges.at(-1));
  }
  if (id === "f-epub" && ev.target.files[0]) {
    const file = ev.target.files[0];
    S.importNote = { title: file.name, verdict: { kind: "accept", text: "Reading…" } }; render();
    try {
      const book = gate(await readEpub(file));
      S.importNote = { title: book.title, verdict: book.verdict };
      if (book.verdict.kind !== "reject") {
        book.mode = "original"; S.book = book; S.pos = 0; S.cards = null; S.summary = null; S.matched.clear(); S.explained.clear();
        startNewSession(); S.importNote = null; scanBook(book);
      }
    } catch (e) { S.importNote = { error: e.message || String(e) }; }
    render();
  }
  if (id === "f-gloss" && ev.target.files[0]) {
    try {
      const list = JSON.parse(await ev.target.files[0].text());
      if (!Array.isArray(list) || !list[0]?.base) throw new Error("This doesn't look like wordlist.json from the textbook tool.");
      const entries = {};
      for (const e of list) if (e.base && e.gloss) entries[e.base] = [e.gloss, e.article || null];
      S.userGloss = { name: ev.target.files[0].name, entries }; buildUserIndex(); persist();
      toast(`Loaded ${Object.keys(entries).length.toLocaleString()} words.`);
    } catch (e) { S.importNote = { ...(S.importNote || {}), error: e.message }; }
    render();
  }
});

document.addEventListener("keydown", (ev) => {
  if (S.view !== "read" || S.summary || S.cards || $("#overlay").innerHTML || /INPUT|SELECT|TEXTAREA/.test(ev.target.tagName)) return;
  if (ev.key === "ArrowRight" || (ev.key === " " && !ev.target.closest("button"))) { ev.preventDefault(); turn(); }
});
let touchX = null;
document.addEventListener("touchstart", (ev) => { if (ev.target.closest("#sheet")) touchX = ev.touches[0].clientX; }, { passive: true });
document.addEventListener("touchend", (ev) => {
  if (touchX == null) return;
  const dx = ev.changedTouches[0].clientX - touchX; touchX = null;
  if (dx < -70) turn();
}, { passive: true });
// keep the "Undo tap" button honest: hide it once the 5 seconds are up
setInterval(() => { if (S.view === "read" && S.session?.current && S.sel != null && $(".undo")) render(); }, 1000);

// ---------------------------------------------------------------- start
try {
  S.book = sampleBook();
  startNewSession();
  render();
} catch (e) {
  // Saved progress from an older version is the likeliest cause; start clean rather than show nothing.
  try { localStorage.removeItem(STORE); } catch { /* ignore */ }
  S.wordbook = {}; S.progress = E.startProgress("A1", Date.now()); S.pos = 0;
  S.book = sampleBook();
  startNewSession();
  render();
  toast("Your saved progress couldn't be read, so the story starts fresh.");
}
