# Connected apps

> **Release blocker: PRELAUNCH-REMOVE.** Connected apps exist for the owner's own use (her study gate,
> Poortwachter) and are **removed completely before Boekenwurm is offered to the public**, on the web, iOS or
> Android. See [PRELAUNCH.md](PRELAUNCH.md) for the removal plan. Do not build on this feature.

The owner's account (the `admin` feature, migration 0010; the database checks it) can let an app see **today's
numbers**, so the app can act on them. The only app is
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

## Connecting (migration 0015)

A browser handoff with PKCE, the way desktop apps sign in ([RFC 8252](https://www.rfc-editor.org/rfc/rfc8252),
[RFC 7636](https://www.rfc-editor.org/rfc/rfc7636)). Nothing to type, and no Supabase settings in Poortwachter.

1. **Account → Experimental → Connected apps → Connect Poortwachter on this computer** opens
   `http://127.0.0.1:7623/boekenwurm/connect?site=<this Boekenwurm>` (Poortwachter must be running). Poortwachter
   also has a Connect button that opens the same address.
2. Poortwachter goes on only for the Boekenwurm address it is set to (`https://boekenwurm.pages.dev` by default). It
   makes a one-time secret (the *verifier*), keeps it, and sends the browser back to
   `<site>/?connect=poortwachter&challenge=<SHA-256 of the verifier>&state=<random>&name=Poortwachter on <computer>`.
3. Boekenwurm takes the request out of the address bar (kept 10 minutes, in this tab only) and opens Connected apps.
   Signed in, the reader sees exactly what will be shared, active reading time included, and clicks **Allow**.
4. `link_app(challenge, name)` keeps a one-time code (240 bits, stored as a hash) bound to that challenge for
   2 minutes, and the browser goes to `http://127.0.0.1:7623/boekenwurm/linked?code=…&state=…`. The address is fixed
   in the app: no request can send a code anywhere else.
5. Poortwachter checks the state is one it made, reads `<site>/connect.json` for the database address, and calls
   `claim_app_link(code, verifier)`: the database checks the verifier against the challenge and returns a token
   (360 bits, stored as a hash). A code without the verifier connects nothing and is used up by the try, so there is
   nothing to guess and no attempt log (0014's hashed addresses are gone).
6. The connection shows when it was allowed, last used, and when it expires: **90 days without use**, then it is
   deleted. **Disconnect** at any time. If the account loses the admin feature, its connections stop and are deleted.

No calendar or other data is stored for apps.

## Your data

- **Export everything** includes the reader's connections and the reading activity measured for them.
- **Erase from my account** removes every connection, request and pairing code (`forget_app_connections()`).

## Rolling it out (owner's deployment only)

Run `0013_connected_apps.sql`, `0014_connected_apps_hardening.sql` and `0015_connected_apps_link.sql` in the
Supabase SQL Editor, give the owner's account the admin feature if it doesn't have it
(`insert into feature_access (user_id, feature) select id, 'admin' from auth.users where email = '…';`), then deploy
the app. The app copes without the migrations.

## Tests

- `supabase/tests/run.sh`: owner only, PKCE (RFC 7636 test vector), codes work once and only with the verifier,
  hashes only, today-only windows, no history, 90-day expiry, admin removed → connection gone, active time dropped
  without a connection and deleted with the last one, erase, no calendar, no attempt log.
- `packages/engine/test/activity.test.ts`: active time.
- `apps/web/test/e2e.mjs`: Connect link → Poortwachter's request → what is shared → Allow → back to Poortwachter →
  disconnect; malformed requests ignored.
