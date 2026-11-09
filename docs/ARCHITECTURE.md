# Boekenwurm — architecture of the app

How the hosted, mobile-first app is put together. The reading rules live in [DESIGN.md](DESIGN.md); this document
covers where things run, where data lives, and how books get in. Decided with the owner on 2026-11-09.

The playtest that came before is kept on the branch `playtest-v1` (also deployed from there if needed) as a reference
for every behaviour the app must keep.

## At a glance

```
 phone or laptop browser (installable app, works offline)
 ┌──────────────────────────────────────────────────────────────┐
 │ apps/web   React + Vite + TypeScript, PWA                    │
 │   screens: Home · Reader · Add book · Camera · Study · Me    │
 │   packages/engine   strikes, streaks, tokens, badges         │
 │   packages/dutch    base forms                               │
 │   packages/ai       prompts, parsing, checks (Claude)        │
 │   packages/books    page stitching, PDF text, progress       │
 │   local store: IndexedDB (everything works offline)          │
 └───────────────┬──────────────────────────────┬───────────────┘
                 │ sync when signed in          │ reader's own Claude key
                 ▼                              ▼
 Supabase (EU, Frankfurt)                Anthropic API
   Auth: email link, Apple, Google         page photos → paragraphs
   Postgres: books, progress, words        book level, matching, words
   Storage: covers, page photos, EPUB/PDF  in their sentence
   Row-level security: own rows only
```

There is no server of our own. The app is static files on a CDN; Supabase is the backend; Claude is called from the
reader's device with the reader's key. That keeps hosting close to free, keeps book text out of anything we run, and
leaves one clear place to add a server later (a Supabase Edge Function) if a feature ever needs one.

## Choices and why

| Need | Choice | Why |
|---|---|---|
| App framework | React 19 + Vite + TypeScript | Most-requested front-end skill (portfolio); fast builds; large ecosystem |
| Feels like a phone app | PWA: web manifest, service worker (`vite-plugin-pwa`), full-screen, home-screen icon | Installs from the browser on iOS and Android; camera works; no store review needed |
| App stores later | Capacitor wrapper around the same build | Same code; native camera and sign-in sheets when needed |
| Hosting the app | Cloudflare Pages (or Netlify/Vercel) | Free tier, global CDN, preview deploy per pull request, custom domain. GitHub Pages works for now but has no preview deploys or headers control |
| Accounts, database, files | Supabase, EU region | Postgres + auth + private storage in one; row-level security; GDPR-friendly; generous free tier; open source, so no lock-in |
| Sign-in | Email link (magic link) + Sign in with Apple + Google | One tap on phones; no passwords to manage. Apple sign-in is required anyway if the iOS app offers Google |
| Offline and speed | Local-first: IndexedDB is the source of truth on the device; changes sync to Supabase in the background | Reading never waits for the network; works on a train |
| Page photos → text | Claude vision with the reader's key | Most accurate Dutch: joins hyphenated words, drops running heads and page numbers, keeps paragraphs |
| Default dictionary | Wiktionary (via the wiktextract/kaikki.org extract) + wordfreq frequencies | Both CC BY-SA (commercial use with attribution). Frequency bands give a rough CEFR level per word |
| Textbook tracking | Private import from the reader's own copy | Publisher content never ships with the app |

## Screens (mobile first)

Bottom tab bar, like a native app: **Home · Study · Me**. The reader opens full-screen over the tabs.

- **Home** — greeting with title badge and streak tokens; **Continue reading** card (last book, % done);
  **My books** as a grid of covers with a progress ring and level chip; a **+** card to add a book; a **Study words**
  card showing how many words are due.
- **Add book** — three choices, each a large tile:
  - **EPUB file** — the import check (Dutch, modern spelling), then the book level.
  - **PDF file** — text PDFs are read directly; scanned PDFs are offered the photo route, page by page.
  - **Photograph a book** — see below.
- **Reader** — the playtest reader: tap-to-reveal, strikes, streaks, Match my level, Show original, words in context.
- **Study** — flashcards of revealed words, due words first (FSRS scheduling), "not sticking" list, export to Anki/CSV.
- **Me** — level, badges, word list (default dictionary or imported textbook), Claude key and models, account, export
  and delete my data.

## Photographing a book you own

1. **Cover** (required): take a photo. Claude reads the title and author from it; the reader confirms or edits.
2. **Details**: number of pages (required, for progress), the book's level (A1–C2, required for now), ISBN
   (optional: photograph the back cover or type it).
3. **Pages**: the camera stays open; the reader photographs pages one after another. Each photo becomes paragraphs
   in the background (one Claude request per page). The page number printed on the page is read too, so progress is
   "page 34 of 212" even when pages are skipped.
4. Paragraphs that run over a page break are joined, and words hyphenated across lines or pages are rejoined.
5. The book appears on Home with its cover and progress. More pages can be added any time ("Add pages").

Camera access: the app asks the first time the reader taps **Take photo**, after a short screen that says why. On
phones the back camera is used (`facingMode: environment`, or `<input capture="environment">` as the fallback that
always works on iOS). If permission is refused, the reader can pick photos from their library instead.

Photos are kept privately (the reader's own storage folder) so a page can be re-read if recognition improves; the
reader can choose "keep text only" to delete photos after reading.

## Data model

See `supabase/migrations/0001_init.sql`. Every table carries `user_id` and row-level security limits each reader to
their own rows; storage buckets are private with the same rule (`{user_id}/…` paths).

- `profiles` — level, settings, badges, streak tokens.
- `books` — source (`epub`, `pdf`, `photo`, `sample`), title, author, ISBN, cover path, page count, level (set by the
  reader for photographed books; graded for files), status, last position.
- `book_pages` — for photographed books: page number, photo path, recognition status and model.
- `paragraphs` — book, order, page, text, tokens with base forms; matched versions per level live in
  `paragraph_versions` (reader-only, regenerated on level change).
- `reading_sessions` and `paragraph_results` — every run: strikes, passes, streak length, token earned.
- `word_stats` — reveals and encounters per base form; `cards` — flashcard state (FSRS).
- `word_lists` and `word_list_entries` — the default dictionary is public read-only data shipped with the app (not a
  table); a reader's imported textbook list is a private `word_lists` row.

Sync: each local change gets an `updated_at`; the client pushes changed rows and pulls rows newer than its last sync.
Conflicts resolve last-write-wins per row, except counters (`word_stats`), which are merged by adding the deltas.

## Formats

| Format | Today (playtest) | App |
|---|---|---|
| EPUB | ✅ | ✅ (same import check) |
| PDF with text | Python tool for the textbook only | ✅ `packages/books/pdf.ts` (pdf.js): paragraphs from line gaps, running heads and page numbers removed, hyphenation joined |
| PDF scanned (images) | — | Detected (no text layer) and sent through the photo route |
| Photos of pages | — | ✅ Claude vision |
| Kobo store books (DRM) | — | Not possible; DRM-free files only |

## Word lists

- **Default for everyone:** an open Dutch dictionary built from Wiktionary (meanings) and wordfreq (frequency).
  Built by a script in CI, shipped as a static JSON file the app caches; attribution on the Me → About screen.
- **Your textbook (private):** each reader can import their own textbook's word list from their own copy. Nothing from
  any textbook is part of the app or this repository.
- Words are tracked against the active list: "known", "in my textbook up to chapter 13", "new".

## Security and privacy

- Content-security policy: scripts from the app only; network to Supabase and `api.anthropic.com` only.
- The Claude key never leaves the device except to Anthropic; it is not synced to Supabase.
- Readers can export everything (JSON) and delete their account and all files (GDPR).
- Book text, photos and matched versions are private to their owner; nothing is shared between readers.
- Before a commercial launch: legal advice on matched versions of copyrighted books (see DESIGN.md).

## Build order

1. ✅ `packages/books`: page stitching, progress, PDF text; `packages/ai`: page and cover reading. Database schema.
2. `apps/web` skeleton: tabs, Home with sample story, reader ported from the playtest, local store.
3. Add book: EPUB and PDF; then the camera flow.
4. Supabase: sign-in, sync, storage.
5. Study tab with FSRS; default dictionary build; textbook import.
6. Hosting on Cloudflare Pages with preview deploys; installable PWA; then the Kobo plugin.
