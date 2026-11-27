/**
 * Where a tapped word's meaning is looked for when the dictionary and the reader's word lists don't know it. No I/O,
 * so the rule is tested in Node (test/lookuporder.test.ts).
 *
 * Everyone: Google Translate (200 words a day), then the word split into two dictionary words (a compound). With
 * Claude access (the owner's admin account with her own key on this device, lib/pagereader.ts claudeAllowed),
 * Claude comes last, or first if she chooses: Claude first costs more on her key but saves Google's daily 200 for
 * when Claude can't answer.
 */
export type MeaningSource = "google" | "claude";
export type LookupStep = "translate" | "compound" | "claude";

export function lookupOrder(first: MeaningSource | undefined, claude: boolean): LookupStep[] {
  if (!claude) return ["translate", "compound"];
  return first === "claude" ? ["claude", "translate", "compound"] : ["translate", "compound", "claude"];
}

/** Explaining every tapped word in its sentence: with Claude access, on unless turned off. */
export const explainsWords = (setting: boolean | undefined, claude: boolean): boolean => claude && setting !== false;
