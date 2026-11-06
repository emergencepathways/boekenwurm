// Boekenwurm playtest: the real engine (Engine.*) driving a minimal reader.
// Your books and word lists are read in this browser only; nothing is uploaded.
"use strict";
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
};

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
  return { title, source: "epub", verdict, paragraphs: paras.map((text) => ({ text, tokens: tokenize(text, isName) })) };
}

// ---------------------------------------------------------------- session flow
const rules = () => E.rulesFor(S.settings.preset);
const para = () => S.book.paragraphs[S.pos];
const lemmasOf = (p) => p.tokens.filter((t) => t.k === "word").map((t) => lookup(t.t).lemma);

function startNewSession() {
  S.session = E.startSession(rules(), { id: `s-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` });
  S.sentences = {}; S.summary = null; S.sel = null;
  beginCurrent();
}
function beginCurrent() {
  if (S.pos >= S.book.paragraphs.length) S.pos = 0;
  S.session = E.beginParagraph(S.session, `p${S.pos}`, lemmasOf(para()));
  S.sel = null;
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
    <p class="para" lang="nl">${text}</p>
    <div class="def" aria-live="polite">${defPanel(onStreak)}</div>
    <div class="actions">
      <button class="btn ghost small" data-act="library">Change book</button>
      <button class="btn primary next" data-act="turn">Next page →</button>
    </div>
  </article>
  <p class="muted" style="margin:0;font-size:.82rem">Tap a word to see its meaning. Swipe left, press → or Space to turn the page.</p>
  ${S.importNote ? libraryPanel() : ""}`;
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
    ${meaning}${why ? `<span class="note">${why}</span>` : ""}`;
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
  <section class="panel"><h3>Playtest tools</h3>
    <p>Shortcuts for trying the level-up flow without reading 30 paragraphs.</p>
    <div class="actions"><button class="btn small" data-act="sim-token">Add a streak token</button>
      <button class="btn small ghost" data-act="reset">Reset all progress</button></div>
  </section>`;
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
    case "undo": return undo();
    case "library": S.importNote = S.importNote || {}; render(); return $("#library")?.scrollIntoView({ behavior: "smooth" });
    case "close-lib": S.importNote = null; return render();
    case "sample": S.book = sampleBook(); S.pos = saved.samplePos || 0; S.importNote = null; S.cards = null; startNewSession(); return render();
    case "study": S.cards = { queue: [...S.summary.list], done: 0, flipped: false }; return render();
    case "card-flip": S.cards.flipped = true; return render();
    case "card-again": S.cards.queue.push(S.cards.queue.shift()); S.cards.flipped = false; return render();
    case "card-good": S.cards.queue.shift(); S.cards.done++; S.cards.flipped = false; return render();
    case "again": S.cards = null; startNewSession(); S.view = "read"; return render();
    case "accept": { const r = E.acceptLevelUp(S.progress, now); S.progress = r.progress; persist(); render(); return r.newBadges.length ? showBadge(r.newBadges.at(-1)) : closeModal(); }
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
  if (id === "set-level") {
    const r = E.setLevel(S.progress, ev.target.value, now); S.progress = r.progress; persist(); render();
    if (r.newBadges.length) showBadge(r.newBadges.at(-1));
  }
  if (id === "f-epub" && ev.target.files[0]) {
    const file = ev.target.files[0];
    S.importNote = { title: file.name, verdict: { kind: "accept", text: "Reading…" } }; render();
    try {
      const book = gate(await readEpub(file));
      S.importNote = { title: book.title, verdict: book.verdict };
      if (book.verdict.kind !== "reject") { S.book = book; S.pos = 0; S.cards = null; S.summary = null; startNewSession(); S.importNote = null; toast(`Opened “${book.title}”: ${book.paragraphs.length} paragraphs.`); }
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
S.book = sampleBook();
startNewSession();
render();
