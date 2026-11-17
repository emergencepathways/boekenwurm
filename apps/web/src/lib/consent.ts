/**
 * Consent for LanguageTool, the diary's spelling and grammar check (lib/grammar.ts). Asked the first time a reader
 * opens the Diary, like a cookie notice: both answers are equally easy, and the diary works either way. Without
 * consent nothing in the diary is sent to any outside service; the reader checks their own writing. The answer and
 * its date are kept in the reader's settings, and can be changed in Account → Settings → About.
 *
 * The text is in the reader's own language (src/i18n, keys consent.*).
 */
import { getState, updateProfile } from "./store.ts";

export const LANGUAGETOOL_PRIVACY = "https://languagetool.org/legal/privacy";

/** true: allowed; false: declined; null: not asked yet. */
export const languageToolAllowed = (): boolean | null => getState().profile.settings.languageTool?.allowed ?? null;

export async function setLanguageTool(allowed: boolean): Promise<void> {
  await updateProfile((p) => ({ ...p, settings: { ...p.settings, languageTool: { allowed, at: Date.now() } } }));
}
