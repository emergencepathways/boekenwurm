# Boekenwurm reader (playtest)

A single-page reader for trying the rules before the real web app exists. It runs the actual engine
(`packages/engine`), compiled and inlined, with:

- a built-in sample story written for Boekenwurm (A1–A2, 15 paragraphs, every word glossed in English and Dutch);
- **Open an EPUB…**: your own book, read in the browser only and run through the same import check as
  `services/ingest` (Dutch paragraphs only, mixed Dutch/English lines dropped, no pre-1955 spelling);
- **Load word list…**: `wordlist.json` from `python -m boekenwurm_ingest textbook`, for meanings in your own books;
- strikes, streaks, streak tokens, the level-up offer, level badges, the end-of-session study list and a quick review;
- with your own Claude API key (Profile → Claude): the book's level on upload, **Match my level** for books above
  your level (original one tap away), and word meanings in their sentence.

## Hosted

The playtest is no longer published: the app (`apps/web`) replaced it on the live site. CI still builds it, and the
branch `playtest-v1` keeps it exactly as it was tested.

The hosted page sends network requests only to `api.anthropic.com` (enforced by its content-security policy), with the
reader's own key, which stays in their browser.

Progress is kept in the browser's local storage only.

```bash
node apps/playtest/build.mjs        # -> dist/boekenwurm-playtest.html and dist/site/index.html (the hosted page)
node apps/playtest/test/e2e.mjs     # browser test of the hosted page with Claude's replies mocked (needs Playwright)
```

Needs `tsc` (TypeScript 5.7+) on the PATH.
