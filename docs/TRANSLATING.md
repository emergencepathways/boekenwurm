# Translating Boekenwurm

Boekenwurm is for people learning Dutch, and many of them are newcomers who read English as a second language or not
at all. The app's own text (buttons, explanations, messages) can be shown in the reader's language. Dutch stays Dutch:
books, Dutch words, the diary prompts and the Dutch badge titles are never translated, because they are what the reader
is learning.

## Where the text lives

| File | What |
|---|---|
| `apps/web/src/i18n/en.ts` | The source: every message, by key. Plain English, short sentences. |
| `apps/web/src/i18n/uk.ts` | Ukrainian (draft). |
| `apps/web/src/i18n/ar.ts` | Arabic, Modern Standard (draft). |
| `apps/web/src/lib/i18n.ts` | The language list, plural rules, number and date formats, right-to-left. |
| `apps/web/test/i18n.test.ts` | Every key present, every plural form, the same `{placeholders}`. |

A message can have:

- `{name}` placeholders, filled in by the app. Keep every one; move it wherever the sentence needs it.
- `**bold**`, shown in bold.
- Plural forms, chosen by `Intl.PluralRules`: Ukrainian uses `one`, `few`, `many`, `other`; Arabic uses `zero`, `one`,
  `two`, `few`, `many`, `other`. A form may write the number out ("كلمتان") instead of `{n}`.

Words that stay as they are in every language: **fouten** / **fout** (the game's word for a looked-up word),
**Gefeliciteerd!**, **Goed gedaan!**, **Schrijf hier…**, Dutch examples (`ik werk, jij werkt`), product names
(Boekenwurm, LanguageTool, Google Translate, Claude, Anki), and **XP**.

## Status

Ukrainian and Arabic were drafted with AI from the English catalog (2026-11-17) and are marked as drafts in the app
(Account → Settings → Localization), with an invitation to report anything unclear to contact@emergencepathways.org.
They have **not yet been reviewed by a native speaker**.

Choices a reviewer may want to revisit:

- **Ukrainian** addresses the reader with the polite «ви», which also keeps past-tense verbs free of gender
  («ви прочитали»).
- **Arabic** prefers verbal nouns for buttons («متابعة القراءة») and the unvowelled «ـك», so most text reads the same for
  every reader whatever their gender; a few imperatives («المس») are masculine by convention. Digits are Western
  (`ar-u-nu-latn`) to match the Dutch page numbers. Back arrows point right, forward arrows left.

## Reviewing a translation

Without a budget, the plan is volunteer review by native speakers who are learning Dutch themselves:

1. **Weblate** (hosted.weblate.org) hosts open-source projects for free and can read and write these TypeScript files
   through a JSON export, or the catalogs can move to JSON if that proves easier. Reviewers suggest changes in the
   browser; nobody needs to know Git.
2. Until then, a reviewer can comment on a pull request against `uk.ts` or `ar.ts`, or send notes by email.
3. When a language has been reviewed, set its `draft` to `false` in `lib/i18n.ts`: the draft note disappears.

## Adding a language

1. Add it to `Lang` and `LANGUAGES` in `lib/i18n.ts` (its own name, `dir`, a locale for numbers and dates).
2. Copy `uk.ts` to `<code>.ts` and translate every message; `npm test` lists anything missing.
3. Check its letters are covered by the bundled fonts (Noto Sans covers Latin, Cyrillic and Greek; Noto Sans Arabic
   covers Arabic, Persian and Urdu); add a fontsource Noto package for other scripts.
