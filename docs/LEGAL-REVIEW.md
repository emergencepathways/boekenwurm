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
  erase and export cover connections; failed pairing attempts keep a one-way hash of the network address for up to
  an hour (legitimate interest: security); no calendar or other data is stored for apps. Basis for the sharing and
  the measuring: consent at pairing, withdrawn by disconnecting. Because the owner decided to remove the feature
  before launch, a full review of it is only needed if that decision changes; please confirm the removal plan is
  enough (deleting the data with the columns and tables, and the notice text).
