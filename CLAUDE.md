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

- `packages/engine/` — pure TypeScript rules: `checkpoint.ts` (allowance, streak tightening, strike minimum),
  `session.ts` (paragraph → page turn → continue/end), `words.ts` (reveals vs encounters, study list),
  `definitions.ts` (English/Dutch). No dependencies, so it ports to Lua for KOReader.
- `services/ingest/` — Python, standard library only for now: `epub.py`, `language.py`, `spelling.py`, `dating.py`,
  `gate.py` (verdicts), `tokenize.py` (tap tokens), `textbook.py` (private word list), `cli.py`.
- `private/` — the owner's material and everything extracted from it.

## Commands

```bash
cd packages/engine && npm test && npx tsc --noEmit -p .        # engine (Node 22.18+ runs .ts directly)
cd services/ingest && python -m unittest discover -s tests -t tests
python -m boekenwurm_ingest check -v DIR_OR_EPUB...             # import check
python -m boekenwurm_ingest paragraphs BOOK.epub private/x.json # paragraphs + tokens for the app
python -m boekenwurm_ingest textbook TEXTBOOK.pdf               # -> private/textbook/ (refuses other repo paths)
```

The owner's material, when a session has it: books in `~/Documents/Books/Dutch/` and course files in
`~/Documents/Dutch/Dutch Institute A2/` on the owner's computer.

## Conventions

- Commit subjects in the imperative ("Add streak badge"), body explains why.
- Every rule change comes with a test that states the rule in numbers (see `test/checkpoint.test.ts`).
- Keep the engine pure: no I/O, no clocks (pass `now`), no randomness.
