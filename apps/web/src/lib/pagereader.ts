/**
 * Who reads a photographed (or scanned) page. No I/O, so the rule is tested in Node (test/pagereader.test.ts).
 *
 * Google Cloud Vision reads pages for access-code holders. On the owner's admin account, with her own Claude key on
 * this device, she can choose instead:
 * - "google+claude": Google reads the page and Claude, looking at the photo, sorts Google's text into the printed
 *   paragraphs and finds the page number. The words stay Google's (packages/ai/src/structure.ts).
 * - "claude": Claude reads the page instead of Google; Google's daily pages aren't used.
 * Everyone else, and the owner without a key on this device, gets Google. Claude is used for nothing else
 * (DESIGN.md, 2026-11-27).
 */
export type PageReaderChoice = "google" | "google+claude" | "claude";
export type PageReader = PageReaderChoice | "device";

export interface PageReaderAccess {
  /** The owner's admin account (lib/features.ts). */
  admin: boolean;
  /** A Claude key is saved on this device. */
  hasKey: boolean;
  /** Google page reading (an access code). */
  google: boolean;
}

/** Claude can be chosen at all: the admin account, with a key on this device. */
export const claudeAllowed = (a: PageReaderAccess): boolean => a.admin && a.hasKey;

export function pageReaderFor(choice: PageReaderChoice | undefined, a: PageReaderAccess): PageReader {
  if (claudeAllowed(a) && choice === "claude") return "claude";
  if (claudeAllowed(a) && a.google && choice === "google+claude") return "google+claude";
  return a.google ? "google" : "device";
}
