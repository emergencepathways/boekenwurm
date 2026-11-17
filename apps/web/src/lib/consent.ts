/**
 * Consent for LanguageTool, the diary's spelling and grammar check (lib/grammar.ts). Asked the first time a reader
 * opens the Diary, like a cookie notice: both answers are equally easy, and the diary works either way. Without
 * consent nothing in the diary is sent to any outside service; the reader checks their own writing. The answer and
 * its date are kept in the reader's settings, and can be changed in Account → Settings → About.
 *
 * The text is in the reader's own language: the language meanings are translated into from Dutch. That is English for
 * now; a new language adds an entry to CONSENT_TEXT.
 */
import { getState, updateProfile } from "./store.ts";

export type HelpLanguage = "en";

/** The language Boekenwurm explains Dutch in (meanings, notices). English for now. */
export const helpLanguage = (): HelpLanguage => "en";

export interface ConsentText {
  title: string;
  intro: string;
  points: string[];
  privacyLink: string;
  yes: string;
  no: string;
  change: string;
  without: string;
}

export const LANGUAGETOOL_PRIVACY = "https://languagetool.org/legal/privacy";

export const CONSENT_TEXT: Record<HelpLanguage, ConsentText> = {
  en: {
    title: "Check your writing with LanguageTool?",
    intro:
      "Boekenwurm can check your diary for spelling and grammar mistakes with LanguageTool, a writing checker made by LanguageTool GmbH in Germany (EU).",
    points: [
      "Only when you tap “Check my writing”, the text of that entry is sent from your phone to LanguageTool. Nothing is sent while you type.",
      "Boekenwurm never sees or stores your diary: entries stay on this phone.",
      "LanguageTool checks the text and sends the mistakes back. How it handles the text is set out in its privacy policy.",
      "Your choice is saved with your settings. You can change it any time in Account → Settings → About.",
    ],
    privacyLink: "LanguageTool's privacy policy",
    yes: "Yes, use LanguageTool",
    no: "No, I'll check it myself",
    change: "Change",
    without: "LanguageTool is off: nothing you write is sent anywhere. Read your entry through and correct it yourself.",
  },
};

export const consentText = (): ConsentText => CONSENT_TEXT[helpLanguage()];

/** true: allowed; false: declined; null: not asked yet. */
export const languageToolAllowed = (): boolean | null => getState().profile.settings.languageTool?.allowed ?? null;

export async function setLanguageTool(allowed: boolean): Promise<void> {
  await updateProfile((p) => ({ ...p, settings: { ...p.settings, languageTool: { allowed, at: Date.now() } } }));
}
