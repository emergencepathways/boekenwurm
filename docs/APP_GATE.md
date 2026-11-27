# The app gate (an experiment, removable in one step)

**Status:** built 2026-11-27 for the owner's own use, on the owner's account only (Account → Experimental → App gate).
The owner may decide before launch to remove it; everything of it comes out with `scripts/remove-app-gate.sh`.

Like the app one sec, but the pause is study: opening an app the reader chose to gate (TikTok, Instagram, YouTube…)
sends them to Boekenwurm first, for a few minutes of reading and cards, before the app is theirs again.

## How it works on an iPhone

Boekenwurm is a web app, so it can't block apps itself. Apple's Shortcuts app does the gating, with **one Shortcut,
"Boekenwurm Gate"**, that has the app-open automation inside it (possible since iOS 27, which lets a shared Shortcut
carry its automation). It does three jobs, told apart by what it receives:

| Input | From | It does |
|---|---|---|
| an app (or nothing) | its own automation, "When TikTok is opened" | Before the unlock time in `boekenwurm-unlocked-until.txt` (iCloud Drive, Shortcuts folder): nothing, the app opens. After it: opens `https://…/#gate=TikTok` in Safari. |
| `unlock|15|tiktok://` | this page, "Unlock" after a review | Writes now + 15 minutes (or 60) into the file, then opens the app's link if there is one. |
| `test` | the setup's "Test the Shortcut" | Opens `https://…/#gate-setup=ok`: the setup shows "✓ It works". |

This is the soft version, like one sec on iOS: turning off the automation gets round it. A hard block needs Apple's
Screen Time API (Family Controls), which only a native app approved by Apple can use; that is for later.

The gate runs in **Safari**, because Shortcuts opens links there. Safari keeps its own copy of the site's data,
separate from the app on the home screen: the reader signs in once in Safari, and the gate then sees the same books
and words through the account.

## Setting up (Account → Experimental → App gate, or `/#gate-setup` in Safari)

A wizard of four steps; everything else has defaults and lives under **Settings**.

1. **Safari**: warns if opened from the home screen; offers sign-in.
2. **Apps**: tap TikTok, Instagram…; others by name (and their link, to reopen them).
3. **Shortcut**: "Add to Shortcuts" opens the shared Shortcut's iCloud link (`SHARED_SHORTCUT_URL` in
   `src/gate/rules.ts`). In Apple's import screen the reader ticks the same apps and leaves the automation on. If "Add
   Shortcut" doesn't respond (a known iOS 27 bug, reported by one sec), "Skip Setup", then turn the automation on.
4. **Test**: runs the Shortcut with `test`; it opens `#gate-setup=ok`, the setup marks it working (also in a new
   tab) and drops the `=ok` from the address. The setup then shows when it was tested and when an app last sent the
   reader here, so a Shortcut that stopped working shows.

**iPhones on iOS 26 or older** can't add automations from a link: "My iPhone has iOS 26 or older" switches to the
two Shortcuts built by hand ("Boekenwurm Gate" and "Boekenwurm Unlock", receiving `15|tiktok://`) with one automation
per app; the unlock link follows that choice. Gates set up before 2026-11-27 keep that mode.

### The shared Shortcut: the owner builds it once (iOS 27)

Until `SHARED_SHORTCUT_URL` is set, step 3 shows this recipe on the owner's account. Build it, share it with
**Copy iCloud Link** (automation included), and put the link in `src/gate/rules.ts`.

1. New shortcut **Boekenwurm Gate**; it receives Text (and Apps, if offered); with no input, Continue.
2. Add a trigger (action library → Automation): **App** → the apps → **Is Opened** → Run Immediately, notifications off.
3. **If** Shortcut Input begins with `unlock|`: Split Text by `|` → item 2 → Adjust Date (add minutes to Current
   Date) → Format Date (ISO 8601, with time) → Save File to Shortcuts, `boekenwurm-unlocked-until.txt`, Ask Where off,
   Overwrite on → item 3 of the split: if it has any value, Open URLs → Stop This Shortcut. End If.
4. **If** Shortcut Input is `test`: Open URLs `https://boekenwurm.pages.dev/#gate-setup=ok` → Stop This Shortcut.
   End If.
5. Get File from Folder (Shortcuts, `boekenwurm-unlocked-until.txt`, Error If Not Found off) → Get Dates from Input
   → **If** Dates is after Current Date: Stop This Shortcut. End If.
6. URL Encode Shortcut Input → Open URLs `https://boekenwurm.pages.dev/#gate=` + URL Encoded Text.
7. Setup: an import question on the trigger's apps ("Which apps should open Boekenwurm first?").

While building, check whether Shortcut Input carries the app's name when the trigger fires. If it doesn't, the gate
says "a gated app", counts all apps as one, and reopens the app only when one app is gated.

## The review

| | Takes (active time) | Unlocks |
|---|---|---|
| Quick review | 5 minutes (a setting, 5 to 10) | 15 minutes |
| Deep review | 20 minutes | 60 minutes |

- **Active time** counts while the page is on screen and the reader tapped, typed or scrolled in the last 2 minutes;
  a gap of more than 5 seconds between two ticks (the phone slept) adds nothing. "Unlock" appears once the time is
  reached; the reader can finish what's on screen first.
- **Reading and cards take turns:** a paragraph, then up to 5 cards, then a paragraph… A source with nothing left is
  skipped. With nothing at all to review, the screen is a plain pause and being on screen is enough.
- **Reading:** the paragraph after the reader's place in the book they read last, full screen (the Mörk Borg
  feeling, but in order, to be useful). Default rules: unlimited lookups, and "Next" works after a reading time of
  120 words a minute (at least 8 seconds). Stricter, as a setting: Boekenwurm's normal fouten (the reader's preset,
  tightening paragraph by paragraph); a paragraph past its fouten still moves the place on, but its time is taken
  off the review. Either way the words tapped join the word book and flashcards, and the place in the book moves on
  on every device. It earns no XP and no streak.
- **Boekenwurm's flashcards:** the reader's due words, as in Study → Review (Hard, Medium, Easy, Skip). The answers
  count towards the day's 90 and sync. No XP.
- **My cards:** cards on any subject, made in the setup screen: one by one, or pasted (Quizlet's export with a tab
  between term and definition, a spreadsheet, or "front - back", "front;back", "front,back" per line). They follow
  the same Hard / Medium / Easy pool. Shown as **multiple choice** when the deck has at least three other answers (a
  setting, on by default): keep choosing until right; right first time is Easy, one miss Medium, more Hard.
- **Counts:** every arrival from the Shortcut counts as an attempt for that app, and every finished review as an
  unlock. The gate's first screen shows today's and this week's attempts; the setup screen shows today, 7 and 30
  days per app.

The rules in numbers: `apps/web/test/gate/rules.test.ts` and `decks.test.ts`.

## Privacy by design

Decided by the owner on 2026-11-27, so that the gate adds nothing to what Boekenwurm's servers keep:

1. **Which apps are gated, the counts, the settings and the reader's own cards stay on the device** (IndexedDB, `kv`
   key `appGate`): never synced, never uploaded. A list of gated apps can reveal special-category data (a dating or a
   religious app), so it never leaves the phone. Counts are kept 30 days.
2. **The app's name travels after `#`** (`/#gate=TikTok`). Browsers don't send the fragment to a server, so it never
   reaches Cloudflare's or Supabase's logs.
3. **The unlock time is the reader's own file**, written by their Shortcut in their iCloud Drive. Boekenwurm never
   receives it.
4. **What the reader learns at the gate goes where reading and reviews already go:** paragraphs read (the place in
   the book, the words tapped) and Boekenwurm flashcards answered, in the existing tables, covered by export and
   erase. Nothing new is stored on the server.

The setup screen has "Delete all app gate data"; wiping the device's data removes it too. The privacy notice
(`docs/PRIVACY.md`) and the in-app summary (`privacy.gate`) say the same, and `docs/LEGAL-REVIEW.md` has the points
for the reviewer.

## Where it lives

Everything is in two folders, and the rest of the app reaches it only at lines marked `APPGATE-REMOVE`:

- `apps/web/src/gate/`: `rules.ts` (the rules and the Shortcut's links, pure), `decks.ts` (my cards, pure), `state.ts` (device storage, the
  address, reading's next paragraph), `Gate.tsx` (start → review → done), `Reading.tsx`, `Cards.tsx`, `Setup.tsx` (the wizard and Settings),
  `index.tsx` (what the app imports), `gate.css`.
- `apps/web/test/gate/`: the rules and cards in numbers.
- Marked lines: `apps/web/src/App.tsx` (the route), `apps/web/src/screens/Me.tsx` (the Experimental entry and the
  privacy summary line), `apps/web/src/i18n/{en,uk,ar}.ts` (`privacy.gate`), `docs/PRIVACY.md`,
  `docs/LEGAL-REVIEW.md`, `docs/PRELAUNCH.md`, `CLAUDE.md`, `AGENTS.md`.

The gate's own screens are in English only, like the other experiments; only its privacy line is in every catalog.

## Removing it

1. On the iPhone, in Safari: App gate → Settings → **Delete all app gate data**. Then delete the Boekenwurm Gate
   Shortcut (and Boekenwurm Unlock and the automations, if built by hand).
2. In the repo: `scripts/remove-app-gate.sh`. It deletes the two folders and this file, cuts every marked block and
   line, checks nothing is left (`--check` does only that), and deletes itself.
3. Run every test suite (`CLAUDE.md`, Commands) and commit ("Remove the app gate").

There is no database migration: the gate has no tables or columns.

## Later, if it stays

- An AI comprehension check after a paragraph (on the reader's own key, as for page reading).
- Android (an accessibility service or usage access), a browser extension for websites, and Poortwachter on Linux.
- A hard block on iPhone with Screen Time, which needs a native app.
