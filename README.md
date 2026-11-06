# Boekenwurm

**Read real Dutch. Tap what you don't know. Keep your streak.**

Boekenwurm turns Dutch books into a reading game. You read a paragraph; tap a word to see its meaning and it goes on
your list. At every page turn the paragraph is judged against an allowance of reveals. Pass, and the next paragraph is a
little stricter: a streak. Ten in a row earns a streak token, and three tokens offer the next level (A2 → B1), with a badge and title for every level reached. Use your last strike, and the session ends with the words you needed, how often you've needed
them before, and a flashcard review of exactly those words.

- **Your own content.** Start from your course textbook, then add your own ebooks. An import check reads the text
  itself (not the metadata) to keep out non-Dutch text and pre-1955 spelling.
- **Words that don't stick, found for you.** Every word counts its reveals against its encounters.
- **Dutch definitions on a streak**, and always from B1.
- **Flashcards built in**, with export to Anki (`.apkg` or AnkiConnect) and CSV.

See [docs/DESIGN.md](docs/DESIGN.md) for the full design, the checkpoint rules and the architecture.

## Status

| Part | State |
|---|---|
| `packages/engine` — checkpoint, streaks, streak tokens and levels, word statistics (TypeScript) | working, tested |
| `services/ingest` — import check, paragraphs, private textbook word list (Python) | working, tested |
| `apps/web` — the reader (SvelteKit) | next |
| Boekenwurm for Kobo (KOReader plugin) | after the web app |

## Try it

Requires Node 22.18+ and Python 3.11+.

```bash
# engine tests
cd packages/engine && npm test

# import check on a folder of EPUBs
cd services/ingest
python -m boekenwurm_ingest check -v ~/Books/Dutch
python -m unittest discover -s tests -t tests
```

Example output:

```
modern-novel.epub                       OK                old=  2.8/10k  nl= 99%  paras= 1364
gutenberg-novel.epub                    OLD SPELLING      old=182.8/10k  nl=100%  paras= 1530  written ~1906 (title-page)
learner-book.epub                       OK (Dutch parts)  old=  2.3/10k  nl= 17%  paras=  457
```

## Your books stay yours

Books and textbooks are copyrighted, so they never enter this repository. Put them in `private/` (gitignored) or point
the tools at wherever they live. Tests use synthetic books written for the tests.

---

Built by [Emergence Pathways](https://emergencepathways.org), Den Haag.
