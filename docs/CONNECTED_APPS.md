# Connected apps

Boekenwurm can share a reader's **daily numbers** with an app the reader pairs, so that app can act on them. The
first one is [Poortwachter](https://github.com/emergencepathways/poortwachter), the owner's study gate for Linux:
it keeps Steam closed until the day's Dutch study is done, and Boekenwurm reading, flashcards and the diary count.

## What an app can see

Only numbers, for a window it asks for (at most three days):

| Field | Meaning |
|---|---|
| `sessions`, `paragraphs` | reading sessions started in the window, and paragraphs read in them |
| `pages` | printed pages (photographed and PDF books), plus 250 countable words = 1 page in books without page numbers (as for XP) |
| `active_minutes` | active reading time: book on screen, with a tap, page turn, scroll or key in the last 2 minutes (`packages/engine/src/activity.ts`) |
| `*_at_level` | the same, counting only sessions whose text level is at or above the reader's rank at the time |
| `cards_reviewed` | flashcards reviewed in the window (each card once) |
| `diary_done` | whether a diary entry counted on that day; the text never leaves the device |
| `rank` | the reader's rank (A0–C2) in the latest session |

Never book titles, book text, words, meanings or diary entries. The summary is `connection_summary()` in
`supabase/migrations/0013_connected_apps.sql`, versioned by its `version` field (1).

**The text's level** is the level of what was on screen: the matched level in "Match my level" mode, otherwise the
book's level, graded or set by the reader. A text without a level never counts as "at level".

## Pairing

1. Account → Settings → **Connected apps** → **Pair Poortwachter** shows a code like `K7QM-3XPA`, valid 10 minutes.
2. The reader types it into the app. The app finds this deployment's database in `/connect.json` (built from the
   same public values as the app) and calls `claim_pairing_code(code, name)`, once.
3. The app gets its own token (360 random bits). It is not a sign-in: it opens only `connection_summary()` and
   `put_app_calendar()`. Codes and tokens are stored only as SHA-256 hashes.
4. The reader sees the connection (name, when connected, when last used) and can **Disconnect** it; the token then
   opens nothing.

## Calendar feed

An app may publish one iCalendar (Poortwachter: its study plan for the coming week) with `put_app_calendar()`. The
first call returns a secret; `https://<project>.supabase.co/functions/v1/calendar?f=<secret>` serves it
(`supabase/functions/calendar/`), so Google Calendar and others can subscribe. The app can replace the secret, which
stops the old address. Disconnecting the app deletes its calendar.

## Rolling it out

Run `supabase/migrations/0013_connected_apps.sql` in the Supabase SQL Editor **before** this version of the app is
deployed. The app also copes without it: session rows are sent without the new columns, and Connected apps says the
database isn't set up yet.

## Tests

- `supabase/tests/run.sh`: pairing (codes work once, expire, ignore case and dashes), the summary's numbers on
  invented sessions, at-level counting, a three-day limit, wrong and disconnected tokens, the calendar secret.
- `packages/engine/test/activity.test.ts`: active time stops two minutes after the last input, hidden time and
  sleep gaps don't count.
- `supabase/functions/calendar/handler.test.ts`: the feed.
