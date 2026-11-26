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
- **Connected apps (2026-11-26):** a reader can pair an app (first: Poortwachter, the owner's own study gate) that
  then receives a daily summary of numbers only (pages, active reading minutes, cards reviewed, whether a diary entry
  counted that day, rank), never text. Basis: performance of the service the reader asked for. The `diary_done` flag
  reveals only that an entry was written, not its content; confirm that this needs no separate consent. Active
  reading time is a new per-session measurement: confirm it is covered by the notice as written.
