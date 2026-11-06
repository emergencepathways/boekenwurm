/**
 * Level badges: one badge and one title for every CEFR level a reader reaches.
 *
 * Titles follow the app's name, a worm working its way through ever bigger
 * pieces of the book. They are placeholders until the visual design is done;
 * change them here and every screen follows.
 */
import type { CefrLevel } from "./definitions.ts";

export interface BadgeInfo {
  level: CefrLevel;
  /** Dutch title shown under the badge. */
  title: string;
  /** English meaning, shown on tap and in the English interface. */
  meaning: string;
}

export const BADGES: Readonly<Record<CefrLevel, BadgeInfo>> = {
  A1: { level: "A1", title: "Letterproever", meaning: "Letter taster" },
  A2: { level: "A2", title: "Bladzijdeknabbelaar", meaning: "Page nibbler" },
  B1: { level: "B1", title: "Hoofdstukvreter", meaning: "Chapter eater" },
  B2: { level: "B2", title: "Boekenwurm", meaning: "Bookworm" },
  C1: { level: "C1", title: "Bibliotheekbewoner", meaning: "Library dweller" },
  C2: { level: "C2", title: "Woordmeester", meaning: "Word master" },
};

/**
 * How a badge was reached:
 *   start      the level the reader began at
 *   level-up   earned through three streak tokens and accepting the offer
 *   placement  a level below the starting level, or one skipped by changing
 *              the level by hand; shown, but marked as not earned in play
 */
export type BadgeSource = "start" | "level-up" | "placement";

export interface Badge {
  level: CefrLevel;
  at: number;
  source: BadgeSource;
}

/** The reader's current title: the badge of their highest level. */
export function currentTitle(badges: Badge[]): BadgeInfo | null {
  const order: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];
  const top = badges.reduce<number>((m, b) => Math.max(m, order.indexOf(b.level)), -1);
  return top >= 0 ? BADGES[order[top]] : null;
}
