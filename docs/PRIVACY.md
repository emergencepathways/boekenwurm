# Boekenwurm privacy notice (draft)

> Draft written for the owner's review. It describes how the app works as built; have it checked by someone qualified
> in Dutch/EU privacy law before launch. The in-app summary (Account → Settings → About → Privacy) must say the same.

**Who is responsible:** Emergence Pathways B.V., Den Haag, the Netherlands. Questions and requests about your data:
**contact@emergencepathways.org**.

## What Boekenwurm keeps, and where

| Data | Where | Why | How long |
|---|---|---|---|
| Your books, reading progress, words, flashcards, settings | On your device | So the app works, also offline | Until you delete them or clear the app's data |
| The same, if you sign in | Your account at Supabase (servers in the EU) | To keep them in step between your devices | Until you erase your account data (Account → Settings → Your data) |
| Your email address, if you sign in | Supabase (EU) | To send you sign-in links and codes | As long as you have an account |
| **Your diary entries** | **Only on your device** | They are yours; Boekenwurm never receives or stores them | Until you delete them or clear the app's data |
| Which diary prompts you wrote, and on which days (not the text) | With your progress | For XP, badges and the weekly reminder | As your progress |
| Your LanguageTool choice and its date | With your settings | To respect your choice on every device | As your settings |
| Your device's notification address and time zone, if you turn on the weekly reminder | Supabase (EU) | To send the reminder | Until you turn it off or erase your account |
| Photos of book pages (access-code holders only) | Only on your device | To read the page's text, and for you to check it | **Deleted as soon as the page is read and checked**; photos with something still to check are kept until it's checked |
| Text read from photographed pages | On your device, and in your account if you sign in | So you can read the book here, on all your devices | Until you delete the book or erase your data; **not included in exports** (see "Your rights") |

## Services that receive data, and when

- **LanguageTool** (LanguageTool GmbH, Germany, EU): **only if you agree** when you first open the Diary, and only when
  you tap “Check my writing”, the text of that diary entry is sent from your device to LanguageTool to find spelling and
  grammar mistakes. Nothing is sent while you type, and Boekenwurm's servers are not involved. If you don't agree,
  nothing you write is sent anywhere. You can change your choice any time (Account → Settings → About → Privacy). See
  [LanguageTool's privacy policy](https://languagetool.org/legal/privacy).
- **Google Cloud Translation** (Google): the single word you tapped, when the dictionary doesn't know it (signed-in
  readers only). Never more than that word.
- **Google Cloud Vision** (Google): photos of book pages, only for readers with an access code (photographing books is
  available only to them). Each photo is sent once, to read its text, and is not kept by Boekenwurm's servers.
- **Anthropic (Claude)**: only if you add your own Claude API key (Account → Experimental), the text a feature needs
  (for example a paragraph to match to your level). Your key stays on your device.
- **Web Push services** (Apple, Google or Mozilla, depending on your device): if you turn on the weekly reminder, a
  short reminder message is sent through your device's push service.

Fonts and the dictionary are part of the app: opening Boekenwurm sends nothing to a font or dictionary service.

## Your rights

You can see, export and erase your data in the app (Account → Settings → Your data), and you can withdraw your
LanguageTool consent or turn off the weekly reminder at any time.

**What an export leaves out.** For books you photographed, the export lists each book's title, author, ISBN, level,
pages read, progress and when you added it, but not the book's text. That text is the author's and publisher's work,
not information about you, and a copy of your data mustn't harm the rights of others (GDPR article 15(4)), copyright
included. The same applies to a request by email. The photos themselves are deleted once read and checked, so there
are none to export. Erasing your data deletes the books, their text and anything left of the photos. For anything else (access, correction, erasure,
objection, a copy of your data), write to contact@emergencepathways.org. You can also complain to the Dutch Data
Protection Authority (Autoriteit Persoonsgegevens).

## Legal bases (for the reviewer)

- Running the app and syncing your account: performance of the service you asked for.
- LanguageTool: **explicit consent**, asked before first use, as diary entries may contain special-category data
  (health, sexuality, beliefs). Declining keeps the diary fully usable.
- Weekly reminder: consent (you turn it on; the browser also asks).
- Translation and page reading: performance of the service, limited to what the feature needs.
- Page photos: deleted once read and checked (data minimisation, storage limitation). Text read from them is left out
  of exports under article 15(4) and recital 63 (others' rights, copyright); the reader's own data about those books
  (titles, progress, pages read) is included. The reviewer should confirm this, and the copyright position of reading
  photographed books in the app, under Dutch law (Auteurswet, art. 16c).
