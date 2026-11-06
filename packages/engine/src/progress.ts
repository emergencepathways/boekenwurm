/**
 * Long-term progress: streak tokens and the level-up offer.
 *
 * - A session whose streak reaches 10 paragraphs earns one token (one per
 *   session, however long the streak runs; the token is kept even if the
 *   streak later breaks).
 * - Three tokens, from three separate sessions, at the current level, prompt
 *   the reader: "Move up from A2 to B1?"
 * - Accepting raises the level and starts a fresh token count. Declining also
 *   clears the count, so the question comes back after three more tokens
 *   rather than after every session.
 * - C2 is the top: tokens are still awarded there, but no offer is made.
 * - Every level reached comes with its badge and title (badges.ts): the
 *   starting level at once, each level-up when it is accepted. Levels below
 *   the starting level, and levels skipped by changing the level by hand,
 *   are marked "placement". Badges are never taken away, even if the reader
 *   moves back down.
 *
 * The level drives content selection and, from B1, Dutch-only definitions.
 */
import type { CefrLevel } from "./definitions.ts";
import type { Badge, BadgeSource } from "./badges.ts";
import type { Session } from "./session.ts";

export const LEVELS: readonly CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

export interface Token {
  sessionId: string;
  at: number;
  level: CefrLevel;
  streak: number;
}

export interface Progress {
  level: CefrLevel;
  /** Tokens earned at the current level since the last offer. */
  tokens: Token[];
  /** Every token ever earned, for the profile page. */
  history: Token[];
  /** Set when the reader should be asked to move up. */
  offer: { from: CefrLevel; to: CefrLevel } | null;
  /** One per level reached, in the order they were reached. */
  badges: Badge[];
}

export interface ProgressRules {
  tokensForOffer: number;
}

export const DEFAULT_PROGRESS_RULES: Readonly<ProgressRules> = { tokensForOffer: 3 };

export function startProgress(level: CefrLevel, now: number): Progress {
  const upTo = LEVELS.indexOf(level);
  const badges = LEVELS.slice(0, upTo + 1).map((l, i): Badge => ({ level: l, at: now, source: i === upTo ? "start" : "placement" }));
  return { level, tokens: [], history: [], offer: null, badges };
}

function award(badges: Badge[], upTo: CefrLevel, now: number, source: BadgeSource): { badges: Badge[]; added: Badge[] } {
  const have = new Set(badges.map((b) => b.level));
  const target = LEVELS.indexOf(upTo);
  const added = LEVELS.slice(0, target + 1)
    .filter((l) => !have.has(l))
    .map((l): Badge => ({ level: l, at: now, source: l === upTo ? source : "placement" }));
  return { badges: [...badges, ...added], added };
}

export function nextLevel(level: CefrLevel): CefrLevel | null {
  const i = LEVELS.indexOf(level);
  return i >= 0 && i < LEVELS.length - 1 ? LEVELS[i + 1] : null;
}

/** Record a finished (or abandoned) session. Returns whether it earned a token. */
export function recordSession(
  p: Progress,
  s: Session,
  now: number,
  rules: ProgressRules = DEFAULT_PROGRESS_RULES,
): { progress: Progress; earned: boolean } {
  const already = p.history.some((t) => t.sessionId === s.id);
  if (!s.tokenEarned || already) return { progress: p, earned: false };
  const token: Token = { sessionId: s.id, at: now, level: p.level, streak: s.bestStreak };
  const tokens = [...p.tokens, token];
  const to = nextLevel(p.level);
  const offer = !p.offer && to && tokens.length >= rules.tokensForOffer ? { from: p.level, to } : p.offer;
  return { progress: { ...p, tokens, history: [...p.history, token], offer }, earned: true };
}

/** Accept the offer: the new level and its badge. `newBadges` is what the celebration screen shows. */
export function acceptLevelUp(p: Progress, now: number): { progress: Progress; newBadges: Badge[] } {
  if (!p.offer) return { progress: p, newBadges: [] };
  const { badges, added } = award(p.badges, p.offer.to, now, "level-up");
  return { progress: { ...p, level: p.offer.to, tokens: [], offer: null, badges }, newBadges: added };
}

/**
 * Change the level by hand (settings). Moving up awards the badges of the levels passed
 * as "placement"; moving down keeps every badge. Either way the token count restarts.
 */
export function setLevel(p: Progress, level: CefrLevel, now: number): { progress: Progress; newBadges: Badge[] } {
  if (level === p.level) return { progress: p, newBadges: [] };
  const { badges, added } = award(p.badges, level, now, "placement");
  return { progress: { ...p, level, tokens: [], offer: null, badges }, newBadges: added };
}

export function declineLevelUp(p: Progress): Progress {
  if (!p.offer) return p;
  return { ...p, tokens: [], offer: null };
}

/** Tokens still needed before the next offer (0 when an offer is waiting or at C2). */
export function tokensToOffer(p: Progress, rules: ProgressRules = DEFAULT_PROGRESS_RULES): number {
  if (p.offer || !nextLevel(p.level)) return 0;
  return Math.max(0, rules.tokensForOffer - p.tokens.length);
}
