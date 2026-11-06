/**
 * Which language the definition popup uses.
 *
 * - Readers at B1 and above always get Dutch definitions.
 * - During a streak, definitions are always Dutch: part of the challenge.
 * - Otherwise the reader's own setting applies (English by default).
 */
export type CefrLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
export type DefinitionLanguage = "en" | "nl";

const ORDER: readonly CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

export function atLeast(level: CefrLevel, min: CefrLevel): boolean {
  return ORDER.indexOf(level) >= ORDER.indexOf(min);
}

export function definitionLanguage(opts: {
  level: CefrLevel;
  preference?: DefinitionLanguage;
  onStreak: boolean;
}): DefinitionLanguage {
  if (atLeast(opts.level, "B1") || opts.onStreak) return "nl";
  return opts.preference ?? "en";
}
