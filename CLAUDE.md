# Boekenwurm — instructions for Claude sessions

A Dutch reading-challenge app (web first, a KOReader/Kobo plugin later). Owner: Emergence Pathways (GitHub
`emergencepathways/boekenwurm`). The owner is learning Dutch (A2), lives in Den Haag, and also uses this repo as a
public portfolio project: code, commits and docs should be of a quality a hiring manager would be glad to read.

## Release blocker: remove connected apps before going public

**Connected apps (pairing Poortwachter, the daily summary, active reading time, `connect.json`) are for the owner's
own use only and must be removed completely before any public release, web launch or App Store / Google Play
submission.** The plan, file by file, is `docs/PRELAUNCH.md`; everything involved is marked `PRELAUNCH-REMOVE`. Never
approve, tag or submit a public release while `scripts/prelaunch-check.sh` fails, and don't build new features on
connected apps.

<!-- APPGATE-REMOVE-START -->
## The app gate: an experiment that may be removed before launch

The app gate (`docs/APP_GATE.md`: iPhone Shortcuts send the owner here before TikTok and the like, for a few minutes of
reading and cards) is for the owner's own use. The owner may decide to remove it before launch, so keep it removable
in one step: everything new goes in `apps/web/src/gate/` or `apps/web/test/gate/`, and any line it needs elsewhere sits
between `APPGATE-REMOVE-START` and `APPGATE-REMOVE-END` (or ends with `APPGATE-REMOVE-LINE` where a block can't go,
such as a Markdown table row). `scripts/remove-app-gate.sh --check` lists what is left of it; without `--check` it
removes it. Its privacy rules: which apps are gated, the counts and the gate's own cards stay on the device; the app's
name only ever travels after `#`. Never build other features on it.
<!-- APPGATE-REMOVE-END -->

Read `docs/DESIGN.md` before changing behaviour. The checkpoint rules there are the owner's; change them only when the
owner asks, and update the design doc and the tests together.

## The one hard rule: private content never enters the repo

- The owner's course textbook and books are copyrighted. They live outside the repo or in `private/` (gitignored).
- Never commit, quote, paraphrase at length, or build test fixtures from them. Don't name the textbook in public files.
- Tests use synthetic text written for the tests (`services/ingest/tests/fixtures.py`).
- Before every commit: `git status --ignored` and check that nothing under `private/` and no `.epub/.pdf/.docx` is staged.

## Layout

- `packages/engine/` — pure TypeScript rules: `checkpoint.ts` (strikes, streak tightening, strike minimum), `progress.ts` (streak tokens, level-up offer), `badges.ts` (level badges and titles),
  `review.ts` (flashcard pool, list words first), `wordlist.ts` (word list states, learned, common-words progress),
  `diary.ts` (the 20 prompts, one entry a day, weekly reminder, free writing),
  `xp.ts` (XP and ranks A0–C2), `achievements.ts` (tiered badges), `play.ts` (the synced play record and its merge),
  `session.ts` (paragraph → page turn → continue/end), `words.ts` (reveals vs encounters, study list),
  `definitions.ts` (English/Dutch), `hexbound.ts` (the secret Mörk Borg game mode, docs/HEXBOUND.md),
  `activity.ts` (active reading time for connected apps; PRELAUNCH-REMOVE). No dependencies, so it ports to Lua for KOReader.
- `packages/dutch/` — base forms (`lemma.ts`), twin of `services/ingest/boekenwurm_ingest/lemma.py`; both must pass
  `data/nl/lemma-cases.json`. `data/nl/irregular-verbs.json` is shared data.
- `packages/ai/` — model-agnostic page reading, the only thing Claude does (owner's admin account, her own key):
  `photo.ts` (a page photo → paragraphs), `structure.ts` (Google's text → the printed paragraphs, never changing a
  letter), `json.ts`; prompts, defensive parsing, validation. The network call lives in the app
  (`apps/web/src/lib/claude.ts`, `lib/pagereader.ts`). Grading, level matching, word explanations and cover reading
  were removed on 2026-11-27: don't bring them back unless the owner asks.
- `packages/books/` — getting books in: `stitch.ts` (pages → paragraphs across page breaks, progress through a
  printed book), `pdf.ts` (PDF text → paragraphs, scanned-PDF detection; pdf.js passed in), `ocr.ts` (free on-device page reading:
  Tesseract lines → paragraphs, words to check).
- `packages/books/` also has `vision.ts` (Google Vision's paragraphs → a page: page number vs chapter number) and
  `paragraphs.ts` (paragraphs under 7 words are joined with the next, for every book).
- `supabase/` — database schema with owner-only row-level security; `supabase/tests/run.sh` tests it on local Postgres.
  `supabase/functions/translate/` — the Edge Function that holds the Google Translate key and enforces 200 words a
  day per reader; `supabase/functions/read-page/` — Google Cloud Vision for page photos, access-code holders only,
  20 a day for the whole account, with no reading on the device past it (migration 0004), and the owner's alert at
  200 pages in a month (`_shared/alerts.ts`, migration 0012: email via Resend, push to the owner's phone). In each, `handler.ts` is plain TypeScript, tested under Node, and `index.ts` is the Deno
  entry; `_shared/common.ts` has what they share (CORS, the reader's token, claiming a daily use).
- `docs/CONNECTED_APPS.md` — apps a reader pairs (Poortwachter): consent, pairing code, approval, today's numbers only
  (never text), 90-day expiry, owner's account only, connected by a browser handoff with PKCE; migrations 0013-0015. PRELAUNCH-REMOVE: removed before going public
  (`docs/PRELAUNCH.md`, `scripts/prelaunch-check.sh`).
- `docs/ARCHITECTURE.md` — the hosted app: installable web app (no app stores), React + Vite, Supabase (EU), email
  link + Google sign-in, sync, camera flow, free mode vs. the reader's own Claude key.
- Branch `playtest-v1` — the playtest as the owner tested it, kept as the reference.
- `apps/web/` — the installable app (React + Vite PWA), deployed to Cloudflare Pages by `.github/workflows/publish.yml`.
  `src/lib/importlist.ts` reads word lists (paste, CSV, Excel, Anki) on the device; imported lists are never uploaded.
  Diary entries stay on the device too (`src/lib/diary.ts`): never sync or upload them. `src/lib/grammar.ts` asks
  LanguageTool from the reader's device; `src/lib/push.ts` and `supabase/functions/diary-reminder/` send the weekly
  reminder (Web Push).
  Nothing is preloaded except the open dictionary (`public/dict/nl.json`, built at deploy time, not committed).
  The app's text is in `src/i18n/` (English source, Ukrainian, Arabic); new UI text goes into `en.ts` and every
  catalog in the same change (docs/TRANSLATING.md). Dutch stays Dutch in every language.
  `docs/PRIVACY.md` is the privacy notice, bundled into the app and shown in full under Account → Privacy: edit it as
  published text, and every change to what the app keeps or sends goes into it in the same change, together with the
  short summary under Account → Settings → About (the `privacy.*` keys, in every catalog). Notes for the legal
  reviewer go in `docs/LEGAL-REVIEW.md`, never in the notice.
- `apps/playtest/` — the first reader, built into one page; kept for reference, no longer hosted. It keeps its own
  frozen copy of the old Claude level work (`apps/playtest/legacy/level.ts`); nothing else uses it.
- `services/ingest/` — Python, standard library only (spaCy optional, used when installed): `epub.py`, `language.py`, `spelling.py`, `dating.py`,
  `gate.py` (verdicts), `tokenize.py` (tap tokens), `textbook.py` (private word list), `dictionary.py` (the open
  Wiktionary + wordfreq dictionary), `cli.py`.
- `private/` — the owner's material and everything extracted from it.

## Commands

```bash
cd packages/engine && npm test && npx tsc --noEmit -p .        # engine (Node 22.18+ runs .ts directly)
cd packages/dutch && npm test                                  # base forms (shared cases)
cd packages/ai && npm test                                     # page photos, page structure
cd packages/books && npm test                                  # stitching, progress, PDF (real-PDF tests need pdf-lib + pdfjs-dist)
supabase/tests/run.sh                                          # schema + row-level security on local Postgres
node --test supabase/functions/*/handler.test.ts               # Edge Functions (translate, read-page)
node apps/playtest/build.mjs && node apps/playtest/test/e2e.mjs  # reader + browser test (mocked Claude)
cd services/ingest && python -m unittest discover -s tests -t tests
python -m boekenwurm_ingest check -v DIR_OR_EPUB...             # import check
python -m boekenwurm_ingest paragraphs BOOK.epub private/x.json # paragraphs + tokens for the app
python -m boekenwurm_ingest textbook TEXTBOOK.pdf               # -> private/textbook/ (refuses other repo paths)
python -m boekenwurm_ingest dictionary DUTCH.jsonl.gz OUT.json  # open dictionary (needs wordfreq; source from kaikki.org)
cd apps/web && npm test && npm run build && node test/e2e.mjs   # app: unit tests, build, browser test (mocked Claude, translate)
```

The owner's material, when a session has it: books in `~/Documents/Books/Dutch/` and course files in
`~/Documents/Dutch/Dutch Institute A2/` on the owner's computer.

## Conventions

- Commit subjects in the imperative ("Add streak badge"), body explains why.
- Every rule change comes with a test that states the rule in numbers (see `test/checkpoint.test.ts`).
- Keep the engine pure: no I/O, no clocks (pass `now`), no randomness.
- Never send the owner's books or page photos to a model from a session; tests use invented text and mocked replies.
- Never add a Boekenwurm-owned AI key or a server that calls a model: Claude runs only on the owner's own key, for
  page reading on the admin account. The
  owner-paid Google services are decided by the owner: Cloud Translation for single tapped words (2026-11-11; never
  send more than the tapped word) and Cloud Vision for page photos of access-code holders only (2026-11-12). Keep the
  Google key in the Edge Functions only (never in the app), restricted to those two APIs, and every use counted
  against a per-reader daily limit in the database.
- Access codes are never committed: give the owner the SQL to add one, and store only its hash.
