# Boekenwurm app (`apps/web`)

The installable web app: React 19 + Vite + TypeScript, a PWA that runs in any phone or laptop browser and goes on the
home screen like an app. See [../../docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) for how it fits together.

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # import check and sync rules (Node's test runner)
npm run build        # typecheck + production build in dist/
node test/e2e.mjs [path-to-playwright] [screenshot-dir]   # browser test at phone size, Claude mocked (after a build)
```

Sign-in and sync need `.env.local` (git-ignored) with the project's URL and publishable key; copy `.env.example`.
Without it the app runs on the device only. The GitHub Pages build takes both from the repository's Actions secrets.

## Layout

- `src/lib/` — no React: `text.ts` (import check, tap tokens), `store.ts` (state and the device store), `sync.ts` and
  `merge.ts` (Supabase sync), `books.ts` (paragraphs, grading, page photos), `epub.ts`, `pdf.ts`, `ocr.ts`
  (Tesseract on the device), `claude.ts` (the reader's own key), `srs.ts` (FSRS), `check.ts` (connection check).
- `src/screens/` — Home, Reader (the playtest's reader), Study, Me, AddBook, PhotoBook (camera), Welcome, InstallHelp.
- The reading rules come from `packages/engine`, base forms from `packages/dutch`, Claude prompts and checks from
  `packages/ai`, page stitching and PDF text from `packages/books`. The sample story is read from `apps/playtest/src`
  at build time, so there is one copy.

## Privacy

- The content-security policy lets the page talk only to this site, Supabase, Anthropic and the fonts.
- The Claude key stays on the device. Books, covers and progress go only to the reader's own rows and folder in
  Supabase (row-level security).
- Free page reading runs Tesseract on the device; its engine and Dutch model are served from this site (`/tesseract/`).
