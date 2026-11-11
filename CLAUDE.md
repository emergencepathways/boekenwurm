# Boekenwurm — instructions for Claude sessions

A Dutch reading-challenge app (web first, a KOReader/Kobo plugin later). Owner: Emergence Pathways (GitHub
`emergencepathways/boekenwurm`). The owner is learning Dutch (A2), lives in Den Haag, and also uses this repo as a
public portfolio project: code, commits and docs should be of a quality a hiring manager would be glad to read.

Read `docs/DESIGN.md` before changing behaviour. The checkpoint rules there are the owner's; change them only when the
owner asks, and update the design doc and the tests together.

## The one hard rule: private content never enters the repo

- The owner's course textbook and books are copyrighted. They live outside the repo or in `private/` (gitignored).
- Never commit, quote, paraphrase at length, or build test fixtures from them. Don't name the textbook in public files.
- Tests use synthetic text written for the tests (`services/ingest/tests/fixtures.py`).
- Before every commit: `git status --ignored` and check that nothing under `private/` and no `.epub/.pdf/.docx` is staged.

## Layout

- `packages/engine/` — pure TypeScript rules: `checkpoint.ts` (strikes, streak tightening, strike minimum), `progress.ts` (streak tokens, level-up offer), `badges.ts` (level badges and titles),
  `session.ts` (paragraph → page turn → continue/end), `words.ts` (reveals vs encounters, study list),
  `definitions.ts` (English/Dutch). No dependencies, so it ports to Lua for KOReader.
- `packages/dutch/` — base forms (`lemma.ts`), twin of `services/ingest/boekenwurm_ingest/lemma.py`; both must pass
  `data/nl/lemma-cases.json`. `data/nl/irregular-verbs.json` is shared data.
- `packages/ai/` — model-agnostic level work: book grading, matching a paragraph to a level, word-in-context;
  prompts, defensive parsing, validation. The network call lives in the app.
- `packages/books/` — getting books in: `stitch.ts` (pages → paragraphs across page breaks, progress through a
  printed book), `pdf.ts` (PDF text → paragraphs, scanned-PDF detection; pdf.js passed in), `ocr.ts` (free on-device page reading:
  Tesseract lines → paragraphs, words to check).
- `packages/ai/` also has `photo.ts`: page photos → paragraphs and covers → title/author/ISBN (Claude vision).
- `supabase/` — database schema with owner-only row-level security; `supabase/tests/run.sh` tests it on local Postgres.
- `docs/ARCHITECTURE.md` — the hosted app: installable web app (no app stores), React + Vite, Supabase (EU), email
  link + Google sign-in, sync, camera flow, free mode vs. the reader's own Claude key.
- Branch `playtest-v1` — the playtest as the owner tested it, kept as the reference.
- `apps/web/` — the installable app (React + Vite PWA), deployed to Cloudflare Pages by `.github/workflows/publish.yml`.
  Nothing is preloaded except the open dictionary (`public/dict/nl.json`, built at deploy time, not committed).
- `apps/playtest/` — the first reader, built into one page; kept for reference, no longer hosted.
- `services/ingest/` — Python, standard library only (spaCy optional, used when installed): `epub.py`, `language.py`, `spelling.py`, `dating.py`,
  `gate.py` (verdicts), `tokenize.py` (tap tokens), `textbook.py` (private word list), `dictionary.py` (the open
  Wiktionary + wordfreq dictionary), `cli.py`.
- `private/` — the owner's material and everything extracted from it.

## Commands

```bash
cd packages/engine && npm test && npx tsc --noEmit -p .        # engine (Node 22.18+ runs .ts directly)
cd packages/dutch && npm test                                  # base forms (shared cases)
cd packages/ai && npm test                                     # level work, page photos, covers
cd packages/books && npm test                                  # stitching, progress, PDF (real-PDF tests need pdf-lib + pdfjs-dist)
supabase/tests/run.sh                                          # schema + row-level security on local Postgres
node apps/playtest/build.mjs && node apps/playtest/test/e2e.mjs  # reader + browser test (mocked Claude)
cd services/ingest && python -m unittest discover -s tests -t tests
python -m boekenwurm_ingest check -v DIR_OR_EPUB...             # import check
python -m boekenwurm_ingest paragraphs BOOK.epub private/x.json # paragraphs + tokens for the app
python -m boekenwurm_ingest textbook TEXTBOOK.pdf               # -> private/textbook/ (refuses other repo paths)
python -m boekenwurm_ingest dictionary DUTCH.jsonl.gz OUT.json  # open dictionary (needs wordfreq; source from kaikki.org)
cd apps/web && npm test && npm run build && node test/e2e.mjs   # app: unit tests, build, browser test (mocked Claude)
```

The owner's material, when a session has it: books in `~/Documents/Books/Dutch/` and course files in
`~/Documents/Dutch/Dutch Institute A2/` on the owner's computer.

## Conventions

- Commit subjects in the imperative ("Add streak badge"), body explains why.
- Every rule change comes with a test that states the rule in numbers (see `test/checkpoint.test.ts`).
- Keep the engine pure: no I/O, no clocks (pass `now`), no randomness.
- Never run level matching on the owner's books from a session; tests use invented text and mocked replies.
- Never add a Boekenwurm-owned AI key or a server that calls a model: AI runs only on the reader's own key.
