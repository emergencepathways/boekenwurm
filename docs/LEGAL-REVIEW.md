# Points for the legal review

Notes for the person who reviews Boekenwurm's privacy notice (`docs/PRIVACY.md`). They were in the notice while it
was a draft; the notice itself is now shown to readers in full (Account → Privacy), so they live here instead.

- **Whole notice:** written by the owner with Claude, describing how the app works as built. To be checked by someone
  qualified in Dutch/EU privacy law: the legal bases, retention, and the services named.
- **Page photos and exports:** photos are deleted once their page is read and checked; the text read from them is
  left out of exports under GDPR article 15(4) and recital 63, while the reader's own data about those books (titles,
  progress, pages read) is included. Confirm this reading.
- **Copyright:** confirm the position of reading photographed books in the app under Dutch law (Auteurswet, art. 16c,
  the private copy), given that the text is kept only for the reader to read in the app and is never exported.
- **LanguageTool consent:** explicit consent, asked before first use, because diary entries may contain
  special-category data. Confirm the consent text (in English, Ukrainian and Arabic) is sufficient.
- **Usage alert (2026-11-20):** at 200 Google page readings in a calendar month, the owner gets one email through
  Resend naming the reader's account email (legitimate interest: cost control of a paid-for service). Resend is a US
  service: confirm the transfer basis (EU-US Data Privacy Framework certification or standard contractual clauses)
  and add Resend to the processor list.
- **Connected apps (2026-11-26), for the owner's own use; to be removed before any public release
  (docs/PRELAUNCH.md).** After a privacy and security review the owner tightened it (migration 0014): the reader
  sees what will be shared and agrees before a pairing code exists, then allows the app's request; only today's
  numbers (pages, active reading minutes, cards reviewed, diary yes/no), no history; active reading time is measured
  only while an app is connected and deleted when the last one goes; connections expire after 90 days unused;
  erase and export cover connections; no calendar or other data is stored for apps. Migration 0015 (same day) limits
  the feature to the owner's account and replaces typed codes with a browser handoff (PKCE): consent and approval are
  one signed-in click, and the log of hashed network addresses for failed attempts is gone (nothing to guess). Basis for the sharing and
  the measuring: consent at pairing, withdrawn by disconnecting. Because the owner decided to remove the feature
  before launch, a full review of it is only needed if that decision changes; please confirm the removal plan is
  enough (deleting the data with the columns and tables, and the notice text).
<!-- APPGATE-REMOVE-START (docs/APP_GATE.md) -->
- **App gate (2026-11-27), an experiment on the owner's account; may be removed before launch in one step
  (`scripts/remove-app-gate.sh`).** Designed so that nothing new reaches Boekenwurm's servers: the list of gated apps
  (which can reveal special-category data, e.g. a dating or religious app), the per-app counts and the reader's own
  gate cards are kept only on the device, counts for 30 days; the app's name travels in the URL fragment, which is
  not sent in HTTP requests, so it is not in Cloudflare's or Supabase's logs; the unlock time is kept by the reader's
  own Shortcut in their iCloud Drive. Reading and flashcard answers at the gate go into the existing tables, covered
  by export and erase. The device-only data is outside Boekenwurm's servers, so it is not in the account export; the
  gate has its own "Delete all app gate data", and wiping the device's data removes it too. Basis: performance of the
  service the reader turned on. Please confirm (1) the fragment approach and device-only storage keep the gated-app
  list outside Boekenwurm's processing, and (2) whether the purpose (helping the reader limit their social media use
  through study) needs anything beyond the notice text if the feature is ever offered to readers.
<!-- APPGATE-REMOVE-END -->
