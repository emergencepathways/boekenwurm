# Notes for AI agents and automated reviewers

Read `CLAUDE.md` for how this repository works; it applies to every agent, not only Claude.

## Release blocker

**Connected apps must be removed before Boekenwurm is released to the public** (web launch, App Store, Google Play).
They were built for the owner's own use: pairing Poortwachter, a daily summary of numbers, active reading time and
`/connect.json`. Everything involved is marked `PRELAUNCH-REMOVE`; the removal plan, file by file, is
[`docs/PRELAUNCH.md`](docs/PRELAUNCH.md).

- Do not approve, tag, publish or submit a public release while `scripts/prelaunch-check.sh` fails.
- Do not build new features on connected apps.
- When asked to prepare a public release, carry out `docs/PRELAUNCH.md` first.

## The one hard rule

Private content (the owner's textbook and books) never enters the repository. See `CLAUDE.md`.
