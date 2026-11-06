/**
 * Checkpoint rules: how many words a reader may reveal in a paragraph before
 * the page turn ends the session.
 *
 * Two allowances apply to every paragraph and the larger one wins:
 *   - the percentage allowance: floor(percent × countable words)
 *   - the strike minimum: a fixed number of reveals that is always allowed,
 *     so short paragraphs (where a percentage rounds to 0–2) stay playable.
 *
 * Both tighten while the reader is on a streak:
 *   - a streak starts once `streakStartsAfter` paragraphs in a row have passed
 *     (default 2), so the tightening begins on the 3rd paragraph;
 *   - from then on every further paragraph lowers the percentage by
 *     `stepPercent` (default 3) down to `floorPercent` (default 5), and the
 *     strike minimum by 1 down to `minStrikesFloor` (default 1).
 * A failed paragraph ends the session; the next session starts from the base.
 *
 * A paragraph passes while reveals <= allowed (the allowance is the number of
 * mistakes you may make). Set `failWhen: "reaches"` to make reaching the
 * allowance itself the failure ("third strike and you're out").
 */

export type Preset = "strict" | "standard" | "relaxed";

/** Base percentages offered in the settings. Advanced settings may override. */
export const PRESET_PERCENT: Readonly<Record<Preset, number>> = {
  strict: 10,
  standard: 25,
  relaxed: 35,
};

export interface CheckpointRules {
  /** Percentage of countable words that may be revealed, outside a streak. */
  basePercent: number;
  /** Passed paragraphs in a row needed before the streak tightening begins. */
  streakStartsAfter: number;
  /** Percentage points removed for each paragraph played on a streak. */
  stepPercent: number;
  /** The percentage never drops below this. */
  floorPercent: number;
  /** Reveals always allowed at the start, however short the paragraph. */
  minStrikes: number;
  /** The strike minimum never drops below this during a streak. */
  minStrikesFloor: number;
  /** "exceeds": fail when reveals > allowed. "reaches": fail when reveals >= allowed. */
  failWhen: "exceeds" | "reaches";
}

export const DEFAULT_RULES: Readonly<CheckpointRules> = {
  basePercent: PRESET_PERCENT.standard,
  streakStartsAfter: 2,
  stepPercent: 3,
  floorPercent: 5,
  minStrikes: 3,
  minStrikesFloor: 1,
  failWhen: "exceeds",
};

export function rulesFor(preset: Preset, overrides: Partial<CheckpointRules> = {}): CheckpointRules {
  const rules = { ...DEFAULT_RULES, basePercent: PRESET_PERCENT[preset], ...overrides };
  validateRules(rules);
  return rules;
}

export function validateRules(r: CheckpointRules): void {
  const problems: string[] = [];
  if (!(r.basePercent > 0 && r.basePercent <= 100)) problems.push("basePercent must be in (0, 100]");
  if (!(r.floorPercent >= 0 && r.floorPercent <= r.basePercent)) problems.push("floorPercent must be in [0, basePercent]");
  if (!(r.stepPercent >= 0)) problems.push("stepPercent must be >= 0");
  if (!(Number.isInteger(r.streakStartsAfter) && r.streakStartsAfter >= 1)) problems.push("streakStartsAfter must be an integer >= 1");
  if (!(Number.isInteger(r.minStrikes) && r.minStrikes >= 0)) problems.push("minStrikes must be an integer >= 0");
  if (!(Number.isInteger(r.minStrikesFloor) && r.minStrikesFloor >= 0 && r.minStrikesFloor <= r.minStrikes))
    problems.push("minStrikesFloor must be an integer in [0, minStrikes]");
  if (problems.length) throw new RangeError("Invalid checkpoint rules: " + problems.join("; "));
}

/** True once enough paragraphs in a row have passed for the streak to show. */
export function inStreak(passesInARow: number, rules: CheckpointRules): boolean {
  return passesInARow >= rules.streakStartsAfter;
}

/** How many tightening steps apply to the paragraph about to be read. */
export function streakSteps(passesInARow: number, rules: CheckpointRules): number {
  return inStreak(passesInARow, rules) ? passesInARow - rules.streakStartsAfter + 1 : 0;
}

export interface Allowance {
  /** Percentage in force for this paragraph. */
  percent: number;
  /** Strike minimum in force for this paragraph. */
  strikes: number;
  /** floor(percent × countable words). */
  byPercent: number;
  /** The reveals allowed: max(byPercent, strikes). */
  allowed: number;
  /** Which rule set the allowance. */
  source: "percent" | "strikes";
}

export function allowanceFor(countableWords: number, passesInARow: number, rules: CheckpointRules): Allowance {
  if (!(Number.isInteger(countableWords) && countableWords >= 0)) throw new RangeError("countableWords must be a non-negative integer");
  const steps = streakSteps(passesInARow, rules);
  // Round to 2 decimals so 25 - 3*n never drifts (e.g. 21.999999).
  const percent = Math.max(rules.floorPercent, Math.round((rules.basePercent - rules.stepPercent * steps) * 100) / 100);
  const strikes = Math.max(rules.minStrikesFloor, rules.minStrikes - steps);
  const byPercent = Math.floor((countableWords * percent) / 100 + 1e-9);
  const allowed = Math.max(byPercent, strikes);
  return { percent, strikes, byPercent, allowed, source: byPercent >= strikes ? "percent" : "strikes" };
}

export function passes(reveals: number, allowance: Allowance, rules: CheckpointRules): boolean {
  return rules.failWhen === "reaches" ? reveals < allowance.allowed : reveals <= allowance.allowed;
}
