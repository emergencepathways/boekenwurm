# Connected apps

> **Release blocker: PRELAUNCH-REMOVE.** Connected apps exist for the owner's own use (her study gate,
> Poortwachter) and are **removed completely before Boekenwurm is offered to the public**, on the web, iOS or
> Android. See [PRELAUNCH.md](PRELAUNCH.md) for the removal plan. Do not build on this feature.

A reader can let an app they pair see **today's numbers**, so the app can act on them. The only app is
[Poortwachter](https://github.com/emergencepathways/poortwachter): it keeps the owner's Steam closed until the day's
Dutch study is done.

## What an app can see

Only today (or yesterday, for apps whose day ends after midnight), as one whole day in the reader's time zone:

| Field | Meaning |
|---|---|
| `pages` | printed pages (photographed and PDF books), plus 250 countable words = 1 page in books without page numbers |
| `active_minutes` | active reading time: book on screen, with a tap, page turn, scroll or key in the last 2 minutes (`packages/engine/src/activity.ts`) |
| `*_at_level` | the same, counting only sessions whose text level is at or above the reader's rank at the time |
| `cards_reviewed` | flashcards reviewed that day (each card once) |
| `diary_done` | whether a diary entry counted that day; the text never leaves the device |

Never history, book titles, book text, words, meanings or diary entries. `connection_summary()` in
`supabase/migrations/0014_connected_apps_hardening.sql`, `version` 2.

**Active reading time is measured only while an app is connected.** The app doesn't measure it otherwise, and the
database drops it for readers without an approved connection, whatever a device sends. When the last connection
goes (disconnected, expired, erased), what was measured for it is deleted.

## Pairing

1. Account → Settings → **Connected apps** → **Pair Poortwachter** first shows exactly what the app will see,
   including active reading time. Only after **I agree** is there a code, like `K7QM-3XPA`, valid 10 minutes.
2. The reader types it into the app. The app finds the database in `/connect.json` and calls
   `claim_pairing_code(code, name)`. Wrong codes are counted: 10 per network address in 10 minutes and 300 in all
   per minute, then everyone waits (only a hash of the address is kept, for up to an hour).
3. The app gets a token (360 random bits), but the connection is **pending**: Boekenwurm shows "Poortwachter on
   laptop wants to connect" with **Allow** / **Deny**. Until the reader allows it (within 10 minutes), the token
   opens nothing.
4. An allowed connection shows when it was allowed, last used, and when it expires: **90 days without use**, then it
   is deleted. **Disconnect** at any time.

Codes and tokens are stored only as SHA-256 hashes. No calendar or other data is stored for apps.

## Your data

- **Export everything** includes the reader's connections and the reading activity measured for them.
- **Erase from my account** removes every connection, request and pairing code (`forget_app_connections()`).

## Rolling it out (owner's deployment only)

Run `0013_connected_apps.sql` and `0014_connected_apps_hardening.sql` in the Supabase SQL Editor before the app
version that uses them is deployed. The app copes without them.

## Tests

- `supabase/tests/run.sh`: consent-free code refused to anon, codes work once, guessing limits, approval, today-only
  windows, no history, 90-day expiry, active time dropped without a connection and deleted with the last one,
  erase, no calendar.
- `packages/engine/test/activity.test.ts`: active time.
- `apps/web/test/e2e.mjs`: agree → code → the app's request → allow → disconnect.
