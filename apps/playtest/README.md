# Boekenwurm playtest

A single-page reader for trying the rules before the real web app exists. It runs the actual engine
(`packages/engine`), compiled and inlined, with:

- a built-in sample story written for Boekenwurm (A1–A2, 15 paragraphs, every word glossed in English and Dutch);
- **Open an EPUB…**: your own book, read in the browser only and run through the same import check as
  `services/ingest` (Dutch paragraphs only, mixed Dutch/English lines dropped, no pre-1955 spelling);
- **Load word list…**: `wordlist.json` from `python -m boekenwurm_ingest textbook`, for meanings in your own books;
- strikes, streaks, streak tokens, the level-up offer, level badges, the end-of-session study list and a quick review.

Progress is kept in the browser's local storage only.

```bash
node apps/playtest/build.mjs        # -> apps/playtest/dist/boekenwurm-playtest.html (open it in a browser)
```

Needs `tsc` (TypeScript 5.7+) on the PATH.
