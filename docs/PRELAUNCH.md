# Before a public release: remove connected apps

**Status: open release blocker.** Decided by the owner on 2026-11-26.

Boekenwurm will be sold to the public in the EU (web, iOS and Android). The **connected apps** feature (pairing
Poortwachter, the daily summary, active reading time, `connect.json`) was built for the owner's own use. It may stay
while Boekenwurm has no public users, but **it must be removed completely, from code, database and privacy notice,
before any public release or app-store submission**. Data minimisation is the reason: a public Boekenwurm should not
measure active reading time or share anything with other apps.

**Agents and reviewers:** do not approve, tag or submit a public release (web launch, App Store, Google Play) while
`scripts/prelaunch-check.sh` finds anything. Do not build new features on connected apps.

<!-- APPGATE-REMOVE-START -->
**Also decide on the app gate** (`docs/APP_GATE.md`), an experiment for the owner's own use. It isn't a blocker:
nothing of it reaches the servers. To keep it for readers, have its privacy text reviewed (`docs/LEGAL-REVIEW.md`); to
remove it, run `scripts/remove-app-gate.sh` (it takes this paragraph out too).

<!-- APPGATE-REMOVE-END -->
## Removal steps

1. **Database.** Copy `supabase/prelaunch/remove_connected_apps.sql` into `supabase/migrations/` with the next
   number, and run it in the Supabase SQL Editor. It drops the tables, functions and triggers of migrations 0013 and
   0014 and 0015, deletes every connection, and removes the three reading-session columns (active time, text level, rank).
   Keep 0013 to 0015 in history: migrations are never edited after they ran.
2. **App code.** Remove everything marked `PRELAUNCH-REMOVE`:
   - `apps/web/src/lib/connections.ts` (delete the file)
   - `apps/web/src/App.tsx`: the `?connect=poortwachter` handling and its import
   - `apps/web/src/screens/Me.tsx`: the `ConnectedApps` section (Account → Experimental), its imports, and the connected-apps lines in
     `exportJson` and `eraseAccount`
   - `apps/web/src/screens/Reader.tsx`: the active-time effect, `sessionExtras()`, `clock` in the reader state
   - `apps/web/src/lib/store.ts`: `appsConnected`, the three `FinishedSession` fields and the three row fields
   - `apps/web/src/lib/types.ts`: `active_seconds`, `text_level`, `reader_rank` in `SessionRow`
   - `apps/web/src/lib/sync.ts`: `refreshAppsConnected()` and the column fallback in `pushSessions`
   - `apps/web/vite.config.ts`: `connect.json`; `apps/web/public/_headers`: its entry
   - `apps/web/src/i18n/en.ts`, `uk.ts`, `ar.ts`: every `apps.*` key and `privacy.apps`
   - `packages/engine/src/activity.ts` and its test (delete), its export in `index.ts`, `isAtOrAboveRank` in `xp.ts`
   - `apps/web/test/e2e.mjs`: the connected-apps mocks and step
   - `supabase/tests/rls_test.sql`: the connected-apps block (and add a check that the tables are gone)
3. **Privacy notice.** In `docs/PRIVACY.md`, remove the connected-apps rows, the "Apps you connect" bullet, the two
   legal-basis lines and the sentence about disconnecting under "Your rights"; in the app, `privacy.apps` and its
   list item. Update `docs/LEGAL-REVIEW.md` to say the feature was removed and when.
4. **Docs.** Delete `docs/CONNECTED_APPS.md`; remove its line in `CLAUDE.md`, the `activity.ts` mention, and the
   release-blocker sections in `CLAUDE.md`, `AGENTS.md` and `README.md`. Mark this file **Done** with the date and
   commit, or delete it.
5. **Check.** `scripts/prelaunch-check.sh` must pass (it finds no marker or connected-apps name), and every test
   suite must pass (see `CLAUDE.md`, Commands).
6. **Tell paired readers** (the owner): Poortwachter's Boekenwurm tasks stop working once the functions are gone; it
   says so and falls back to its other tasks.
