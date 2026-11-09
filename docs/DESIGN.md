# Boekenwurm — design

A reading game for learners of Dutch. You read real Dutch, paragraph by paragraph. Tap a word you don't know and its
meaning appears; the word goes on your list. Turn the page, and the paragraph is judged: too many taps and the session
ends, showing which words you needed and how often you have needed them before, then flows straight into flashcards.

Two products share this design:

| | Boekenwurm web | Boekenwurm for Kobo (later) |
|---|---|---|
| For | practice on the go, the game, the stats | long, immersive reading on e-ink |
| Runs on | any browser; installable, works offline | KOReader on a Kobo (Lua plugin) |
| Status | **in development** | after the web app has settled the rules |

The rules live in one small, pure engine (`packages/engine`) so the Kobo plugin can port them line for line.

## Where the ideas come from

Boekenwurm grows out of Speurtocht.NL, a World of Warcraft addon that showed quest text in Dutch. What carried over:

- **The dictionary is part of the tool.** Lookups never need the network.
- **One tap reveals and saves**, together with the sentence it came from: that sentence is what makes a flashcard useful.
- **Names are not vocabulary.** A capitalised word that the book never writes in lowercase is a name; it doesn't count.
- **Difficulty is chosen, not stumbled into.** Content is matched to the reader's level.
- **Flashcards without busywork.** Words reach the flashcard app automatically.

What changed: everyday Dutch instead of a game's battle vocabulary, and content the reader controls instead of a
closed game.

## 1. Content

### Sources

1. **The reader's course textbook** (first, and central). The reader uploads or points to their own copy; it is never
   part of this repository. From it the app extracts the textbook's word list and maps each word to the chapter that
   first uses it. Telling the app "I'm at chapter 13" marks chapters 1–13 as probably known, so difficulty is right
   from the first session instead of after weeks of tapping. The chapter texts become the first graded paragraphs.
2. **The reader's own ebooks**, if they pass the import check below.
3. Later: openly licensed modern Dutch texts the app can offer itself.

### The import check

Metadata alone can't be trusted. In the owner's library of 32 EPUBs:

- every Project Gutenberg book carried its *ebook release* date (2005–2025) in `dc:date`, including texts written in
  1880–1927;
- Dutch novels were tagged with language `en`.

So the check reads the text itself, and uses the date only as supporting evidence:

1. **Language, per paragraph.** Frequent function words separate Dutch from English and German. Paragraphs of fewer
   than 8 words (headings, captions) are skipped. *Mixed* paragraphs — a Dutch line with its English translation, common
   in learner books — are dropped, because the translation would give the answer away.
2. **Spelling.** Pre-reform Dutch (before 1947/1955) writes *zoo, oogen, groote, menschen, tusschen*. The check counts
   such markers per 10,000 Dutch words. On the owner's library modern books scored 0–4.3 and every old book 24 or more
   (most above 120): ≤ 5 is modern, ≤ 15 borderline, above that old.
3. **Date.** For Gutenberg texts `dc:date` is ignored and the title page is read; otherwise `dc:date` is used but
   labelled as possibly the edition date. A pre-1955 date turns a borderline spelling score into a warning, and adds a
   note to modern-spelling books ("a modernised edition?"). It never rejects a book on its own.

| Verdict | Meaning | Reader sees |
|---|---|---|
| `accept` | modern Dutch | the book is added |
| `accept_partial` | a learner book, under 60% Dutch | "N Dutch passages can be used" |
| `warn_borderline` | a few old forms | added after confirming |
| `reject_old_spelling` | pre-reform spelling | "This book uses spelling from before 1955" (+ modernised edition, below) |
| `reject_not_dutch` | under 5 usable Dutch paragraphs | "No Dutch text found" |

Result on the owner's library: 4 of 32 books usable (2 novels, 2 learner books); all 26 Gutenberg books rejected for
old spelling, which a date check alone would have let through.

### Old books: a modernised edition (planned)

Much of the old-to-new change is mechanical (*zoo→zo, oogen→ogen, menschen→mensen, -sch→-s, eene→een*). A rule list
handles the bulk, an AI pass handles the rest, and the result is re-checked with the same spelling score. The edition is
labelled "modernised by Boekenwurm" and kept with the reader's own copy.

### Familiar rewording (planned)

For a paragraph that is too hard, the app can offer a version reworded with words the reader has shown they know
(met often, rarely revealed). An AI model rewrites it; the app then measures the share of known words and rejects
rewrites that don't improve it or that change the meaning. The original is always one tap away. Rewrites run on the
reader's own content only and are never shared between readers.

### Your own books at your level

The goal: read the books you own and care about, at your level, and see them come closer to the original with every
level you gain, until you read the original.

**On upload, the book is ranked.** After the import check, Boekenwurm computes locally how many of the book's words the
reader already knows (word list plus words met often and rarely revealed). Then Claude grades 12 paragraphs spread through
the book on vocabulary, grammar and context cues. The reader sees the result before reading:

> **About B1** · words you know 72% · at your level 34% · grammar: past perfect, relative clauses

If the book is above the reader's level, they are told it needs processing and choose:

- **Match my level** (recommended): each paragraph above their level is rewritten at their level when they reach it,
  about one request per paragraph; the next two paragraphs are prepared ahead so there is no waiting.
- **Read the original.**

**While reading,** a matched paragraph is labelled *Matched to A2 · original about B1*, with **Show original** one tap
away. Strikes and word statistics count the text the reader actually reads.

**Every adaptation is checked before it is shown:** names unchanged, length within 45–180% of the original, Dutch,
no pre-1955 spelling, and at least as many known words as the original. A failed check is retried once with the
problems listed; if it fails again the original is shown with the reason. The model is told to keep every event and
add nothing, and that the paragraph is text to adapt, never instructions.

**Each level-up** clears the matches, so the next paragraphs are written at the new level. At the book's own level the
reader reads the original.

**Words in context (online).** Tapping a word shows the dictionary meaning at once, then what the word means *in this
sentence* from Claude: the real base form (*belt … op → opbellen*), the meaning here, a simple Dutch explanation, and a
note for idioms or separable verbs. On the Kobo, definitions stay dictionary-only.

**Bring your own Claude.** Readers use their own Claude API key. The page calls Anthropic directly from the reader's
browser (Anthropic allows this with the `anthropic-dangerous-direct-browser-access` header); the key is stored in that
browser only, and the page's content-security policy allows network calls to `api.anthropic.com` and nowhere else.
Matched paragraphs and explanations are cached in the reader's browser (IndexedDB). The model is a setting (Sonnet by
default; Opus for the most careful Dutch; Haiku for speed), and `packages/ai` is model-agnostic, so another provider can
be compared on the same checks if it proves better at Dutch.

**Copyright.** A matched paragraph is an adaptation of the reader's own copy, made with their own key, kept only in
their browser, and never shared or reused. Whether that is enough for a commercial product needs legal advice before
launch.

## 2. The reading challenge

### Tapping

- A tap reveals the meaning and records a **reveal**. Tapping the same word again in the same paragraph reads the
  definition again; it is not a second mistake.
- A reveal can be undone within 5 seconds (a mis-tap on a phone).
- Names and numbers are never counted.
- Reveals are keyed on the base form, so *liep, loopt* and *gelopen* all count for *lopen* (see "Base forms" below).

### Base forms

Two layers find the base form of a word, and give the same answers in the browser and on the server
(`packages/dutch`, `services/ingest/boekenwurm_ingest/lemma.py`, one shared test file `data/nl/lemma-cases.json`):

1. **Rules, everywhere.** A table of 135 common irregular verbs (409 forms, `data/nl/irregular-verbs.json`) plus
   compounds with inseparable (*verkocht → verkopen*) and separable prefixes (*opgestaan → opstaan*). Then the regular
   inflections: verb endings, plurals, adjective *-e*, comparatives, diminutives, with the spelling changes undone
   (*huizen → huis, bomen → boom, leest → lezen, zit → zitten*). Rules over-generate, so a regular form is only accepted
   when the reader's word list or dictionary knows the result.
2. **spaCy, on the server.** At import, spaCy's Dutch model reads whole sentences. Besides better base forms, it joins
   separable verbs that are split up in a sentence: in *Ze belt haar moeder op*, both *belt* and *op* become *opbellen*.
   Used automatically when spaCy and a Dutch model are installed; otherwise the rules.

Measured on the owner's books with the textbook word list, the rules raise the share of words that match the list from
71% to 89% (*a modern novel*), 68% to 85% (a translated novel) and 59% to 76% (a learner book's Dutch passages).

### The checkpoint at every page turn

Each paragraph has an allowance of **strikes**, and the last strike ends the session: with 3 strikes, the 3rd reveal
fails the paragraph. The allowance is the larger of

- the **percentage allowance**: ⌊percent × countable words⌋ strikes (25% of 40 words: the 10th reveal fails), and
- the **strike minimum**: 3 strikes, so short paragraphs (where 25% of 8 words rounds to 2) stay fair.

While reading, the reader sees how many strikes are left; at 0, the next reveal will end the run.

Presets, adjustable under advanced settings:

| Preset | Base percentage |
|---|---|
| Strict | 10% |
| Standard | 25% |
| Relaxed | 35% |

**Streaks.** Two passed paragraphs in a row start a streak, shown to the reader. From the third paragraph on, every
paragraph tightens the allowance:

- the percentage drops by 3 points per paragraph, to a floor of 5%;
- the strike minimum drops by 1 per paragraph, long or short, to a floor of 1 (any reveal ends the run).

| Paragraph | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9+ |
|---|---|---|---|---|---|---|---|---|---|
| Standard % | 25 | 25 | 22 | 19 | 16 | 13 | 10 | 7 | 5 |
| Strict % | 10 | 10 | 7 | 5 | 5 | 5 | 5 | 5 | 5 |
| Strike minimum | 3 | 3 | 2 | 1 | 1 | 1 | 1 | 1 | 1 |

Relaxed reaches 5% on paragraph 12.

**Failure.** Using the last strike ends the session at the page turn: "Your streak lasted N paragraphs." The next
session starts again from the base. (Advanced setting `failWhen: "exceeds"` turns the allowance into "N mistakes
allowed, N+1 ends it".)

### Streak tokens and moving up a level

- A session whose streak reaches **10 paragraphs** earns a **streak token**, on the 10th paragraph, with a small
  celebration. One token per session however long the streak runs, and it is kept if the streak later breaks.
- **Three tokens from three separate sessions** at the same level bring up an offer: "Move up from A2 to B1?"
  - Yes: the level rises (A1 → A2 → B1 → B2 → C1 → C2) and a new count starts.
  - Not yet: the count also restarts, so the question comes back after three more tokens rather than every session.
- The level chooses which paragraphs are offered, and from B1 switches definitions to Dutch.
- At C2 tokens are still earned and kept on the profile, with no further offer.

### Level badges and titles

Every level reached comes with a badge and a title, shown on the profile and under the reader's name. The current
title is the one for the highest level reached.

| Level | Title | Meaning |
|---|---|---|
| A1 | Letterproever | Letter taster |
| A2 | Bladzijdeknabbelaar | Page nibbler |
| B1 | Hoofdstukvreter | Chapter eater |
| B2 | Boekenwurm | Bookworm |
| C1 | Bibliotheekbewoner | Library dweller |
| C2 | Woordmeester | Word master |

- The starting level's badge is given at once (an A1 reader starts with the A1 badge).
- Each accepted level-up earns that level's badge, with a celebration screen.
- Levels below the starting level, and levels skipped by changing the level by hand in settings, get their badges
  marked *placement*, so the profile shows which were earned in play.
- Badges are never taken away, even if the reader moves back down a level.
- Titles are placeholders until the visual design is done (`packages/engine/src/badges.ts`).

### Definitions: English or Dutch

- From B1 up, definitions are always in Dutch.
- During a streak, definitions are always in Dutch: part of the challenge.
- Otherwise the reader chooses (English by default).

Sources: Wiktionary (English glosses and Dutch definitions, CC BY-SA, attributed in the app) and, privately, the
reader's own textbook word list.

## 3. After the session

### Word statistics

Every word has two counters:

- **reveals**: how often it was tapped (once per paragraph at most);
- **encounters**: how often it appeared in a finished paragraph.

The **reveal rate** (reveals ÷ encounters) is the measure that matters. A word met 10 times and revealed 9 times is
*not sticking*; a word met 40 times and revealed 3 times is on its way. Words met in a paragraph and not tapped count as
quiet evidence they are known; that evidence also drives paragraph selection and familiar rewording.

### Study list → flashcards

The end-of-session screen lists every word revealed in the session, the ones revealed most often over time first, each
with its forms as they appeared and the sentence they came from. One button starts a flashcard review of exactly those
words, inside the app, scheduled with FSRS (the algorithm modern Anki uses, via `ts-fsrs`).

Export, for readers who keep their cards elsewhere:

- **Anki**: an `.apkg` deck download (works on every device), or direct sync through AnkiConnect on a desktop.
- **Other apps**: CSV / tab-separated export (Quizlet, Mochi, RemNote and most others import it).
- The Kobo version will write Anki-ready files that sync the same way.

## 4. Architecture

```
apps/playtest          the reader today: one page built from the packages; hosted on GitHub Pages
apps/web               React + Vite + TypeScript, installable PWA (see ARCHITECTURE.md)  (next)
packages/books         page stitching, progress through printed books, PDF text
packages/ai            level work: grading, matching, word-in-context prompts, parsing and checks
packages/engine        checkpoint, streaks, sessions, word statistics, tokens and levels — pure TypeScript
services/ingest        Python: import check, paragraphs, textbook extraction; spaCy lemmatisation next;
                       later .apkg export (genanki) and the modernised-edition pipeline
private/               the owner's books and textbook, and everything extracted from them — never committed
```

Why this split:

- **Language work in Python.** The best free Dutch NLP (spaCy's Dutch models for base forms and word types), the Anki
  deck library (genanki) and the PDF/EPUB tooling are all Python. Import happens once per book, so it runs on the server.
- **The game in TypeScript.** Tapping, timing and the checkpoint must be instant and work offline, so they run in the
  browser. The engine has no dependencies, so it can be tested on its own and ported to Lua for KOReader.
- **Hosting.** Supabase in its EU region for accounts, the database and file storage (GDPR-friendly from day one);
  the web app on a static host. Each reader's books and textbook live in private storage only they can read.
- **Swappable.** The engine and the ingest service talk through plain JSON (paragraphs with tokens, word statistics).
  If a part ever needs another language or framework, it can be rewritten behind the same JSON.

### Paragraph format (ingest → app)

```json
{ "id": "p00042", "text": "Op zaterdag gaat Sanne ...", "countable": 14,
  "tokens": [ { "t": "Op", "k": "word", "s": 0, "e": 2, "lemma": "op" },
              { "t": " ", "k": "punct", "s": 2, "e": 3 }, ... ] }
```

`k` is `word` (counts), `name`, `number` or `punct`; `s`/`e` are character offsets into `text`.

## 5. Private content

The textbook and the owner's books are copyrighted. They stay on the owner's machine or in the owner's private
storage. The repository holds only code, openly licensed data, and synthetic test material written for the tests.
`private/` and all book and document file types are gitignored. The textbook tool refuses to write inside the repo
anywhere except `private/`.

## 6. Milestones

1. ✅ Engine: checkpoint, streaks, sessions, word statistics, streak tokens, level-up offers and level badges. Import check.
   Private textbook extraction.
2. ✅ Base forms (rules everywhere, spaCy on the server). Next: the Wiktionary dictionary build, chapter reading
   texts as paragraphs.
3. Web app: library, reader with tap-to-reveal, checkpoint, session summary, built-in flashcards.
4. Accounts and hosting; Anki and CSV export.
5. Paragraph selection by known-word share; modernised editions; familiar rewording.
6. Boekenwurm for Kobo: KOReader plugin with the same rules and word statistics.

## Open questions


- A licence for the code (and separately for any data the project publishes).

## Decided

- The app: React + Vite PWA, Supabase (EU) with email-link, Apple and Google sign-in; page photos read by Claude;
  an open Wiktionary dictionary for everyone plus a private textbook import. See ARCHITECTURE.md. 2026-11-09.

- The last strike ends the run (3 strikes: the 3rd reveal fails). 2026-11-06.
- During a streak the strike minimum drops on every paragraph, long or short. 2026-11-06.
- A 10-paragraph streak earns one token per session; three tokens from separate sessions offer the next level. 2026-11-06.
- Every level reached earns its badge and title, starting level included. 2026-11-06.
- Books above the reader's level are ranked on upload and, by choice, matched to the reader's level paragraph by
  paragraph, with the original one tap away. Words get an explanation in their sentence online. Readers bring their own
  Claude key. 2026-11-06.
