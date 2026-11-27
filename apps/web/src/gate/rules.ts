/**
 * The app gate's rules (docs/APP_GATE.md), pure: no storage, no clock (times are passed in), no randomness.
 *
 * The gate is an experiment for the owner's own use, built to be removed in one step (scripts/remove-app-gate.sh):
 * everything of it lives in src/gate/ and test/gate/, and the few lines elsewhere are marked APPGATE-REMOVE.
 *
 * - An iPhone Shortcuts automation sends the reader here when they open an app they chose to gate (TikTok, say).
 * - A quick review (5 minutes by default, up to 10) unlocks 15 minutes; a deep review (20 minutes) unlocks an hour.
 * - Only active time counts: the page on screen and a tap, key or scroll in the last 2 minutes.
 * - The Shortcut keeps the unlock time itself, on the phone; Boekenwurm never learns which apps are gated.
 */

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

// ---------------------------------------------------------------- the two reviews

export type Tier = "quick" | "deep";

/** The owner's numbers (2026-11-27). The quick review's length is a setting within `quickMinutes`; the rest are fixed. */
export const TIERS = {
  quick: { reviewMinutes: 5, unlockMinutes: 15 },
  deep: { reviewMinutes: 20, unlockMinutes: 60 },
} as const;

/** The quick review's length, a reader setting: 5 to 10 minutes. */
export const QUICK_MINUTES = { min: 5, max: 10, default: 5 } as const;

export const clampQuickMinutes = (n: number | null | undefined): number =>
  Number.isFinite(n) ? Math.min(QUICK_MINUTES.max, Math.max(QUICK_MINUTES.min, Math.round(n!))) : QUICK_MINUTES.default;

/** How long a review takes, in ms of active time. */
export const reviewMs = (tier: Tier, quickMinutes?: number | null): number =>
  (tier === "quick" ? clampQuickMinutes(quickMinutes) : TIERS.deep.reviewMinutes) * MIN;

/** How long a passed review unlocks the gated apps, in minutes. */
export const unlockMinutes = (tier: Tier): number => TIERS[tier].unlockMinutes;

// ---------------------------------------------------------------- active time

/** Time counts while the page is on screen and the reader did something in the last 2 minutes. */
export const IDLE_AFTER_MS = 2 * MIN;
/** A gap longer than this between two ticks (the phone slept, the tab was frozen) adds nothing. */
export const MAX_TICK_MS = 5_000;

export interface Clock {
  /** Active time so far. */
  activeMs: number;
  /** The last tick. */
  at: number;
  /** The reader's last tap, key or scroll. */
  inputAt: number;
}

export const startClock = (now: number): Clock => ({ activeMs: 0, at: now, inputAt: now });

/** The reader did something: time counts again. */
export const touch = (c: Clock, now: number): Clock => ({ ...c, inputAt: Math.max(c.inputAt, now) });

/** Is the review paused (hidden, or idle for 2 minutes)? */
export const isIdle = (c: Clock, now: number, visible: boolean): boolean => !visible || now - c.inputAt > IDLE_AFTER_MS;

/** Advance the clock to `now`: the time since the last tick counts if the page was visible and the reader active. */
export function tick(c: Clock, now: number, visible: boolean): Clock {
  const gap = Math.max(0, now - c.at);
  const counts = visible && gap <= MAX_TICK_MS && now - c.inputAt <= IDLE_AFTER_MS;
  return { ...c, at: now, activeMs: c.activeMs + (counts ? gap : 0) };
}

/** Take time back (a paragraph failed under Boekenwurm's rules: the time spent on it doesn't count). */
export const deduct = (c: Clock, ms: number): Clock => ({ ...c, activeMs: Math.max(0, c.activeMs - Math.max(0, ms)) });

export const isDone = (c: Clock, tier: Tier, quickMinutes?: number | null): boolean => c.activeMs >= reviewMs(tier, quickMinutes);

/** "3:05": minutes and seconds, for the timer. */
export function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// ---------------------------------------------------------------- reading a paragraph

/**
 * The shortest time a paragraph stays up before "Next" works: 120 words a minute (an unhurried A2 pace), at least
 * 8 seconds. With unlimited lookups (the default) this is the paragraph's only rule.
 */
export const READ_WORDS_PER_MINUTE = 120;
export const MIN_READ_MS = 8_000;
export const minReadMs = (words: number): number => Math.max(MIN_READ_MS, Math.round((Math.max(0, words) / READ_WORDS_PER_MINUTE) * MIN));

/** How reading at the gate is judged: unlimited lookups with a timer (default), or Boekenwurm's normal fouten. */
export type ReadingRules = "unlimited" | "boekenwurm";

// ---------------------------------------------------------------- what comes next

/** Cards between two paragraphs. */
export const CARDS_PER_ROUND = 5;

export type Activity = "paragraph" | "cards" | "none";

/**
 * Reading and cards take turns: a paragraph, then a round of cards, then a paragraph… Whatever has nothing left
 * (no book to read, no cards due) is skipped; with neither, there's nothing to review.
 */
export function nextActivity(last: Activity | null, has: { paragraph: boolean; cards: boolean }): Activity {
  if (!has.paragraph && !has.cards) return "none";
  if (!has.paragraph) return "cards";
  if (!has.cards) return "paragraph";
  return last === "paragraph" ? "cards" : "paragraph";
}

// ---------------------------------------------------------------- the link from the Shortcut

/** The app's name as the Shortcut sends it, after "#gate=": letters, digits, spaces and . - _ &, at most 40. */
export function gateAppFromHash(hash: string): string | null {
  const m = /^#gate(?:=(.*))?$/.exec(hash);
  if (!m) return null;
  let name = "";
  try {
    name = decodeURIComponent((m[1] ?? "").replace(/\+/g, " "));
  } catch {
    name = "";
  }
  name = name.replace(/[^\p{L}\p{N} .\-_&]/gu, "").replace(/\s+/g, " ").trim().slice(0, 40);
  return name || "an app";
}

export const isSetupHash = (hash: string): boolean => hash === "#gate-setup";

// ---------------------------------------------------------------- back to the Shortcut

/** The two Shortcuts the reader builds (docs/APP_GATE.md). */
export const SHORTCUT_GATE = "Boekenwurm Gate";
export const SHORTCUT_UNLOCK = "Boekenwurm Unlock";

/**
 * The link that hands a passed review back to the phone: it runs the Unlock Shortcut with "minutes|app link", which
 * saves the new unlock time and opens the app again (when the reader gave its link, e.g. tiktok://).
 */
export function unlockUrl(minutes: number, appLink?: string | null): string {
  const text = `${Math.round(minutes)}|${safeAppLink(appLink) ?? ""}`;
  return `shortcuts://run-shortcut?name=${encodeURIComponent(SHORTCUT_UNLOCK)}&input=text&text=${encodeURIComponent(text)}`;
}

/** An app's own link ("tiktok://"): a scheme and nothing that could be a web page or a script. */
export function safeAppLink(link: string | null | undefined): string | null {
  const l = (link ?? "").trim();
  if (!/^[a-z][a-z0-9+.-]{1,30}:\/\/[\w\-./?=&%]*$/i.test(l)) return null;
  return /^(https?|javascript|data|file|shortcuts):/i.test(l) ? null : l;
}

/** The address the Gate Shortcut opens, for the setup screen. The app's name goes after "#": it is never sent to a server. */
export const gatePageUrl = (origin: string): string => `${origin.replace(/\/$/, "")}/#gate=`;

/** Links for well-known apps, offered when the reader adds one. The reader can change them. */
export const KNOWN_APPS: ReadonlyArray<{ name: string; link: string }> = [
  { name: "TikTok", link: "tiktok://" },
  { name: "Instagram", link: "instagram://" },
  { name: "YouTube", link: "youtube://" },
  { name: "Facebook", link: "fb://" },
  { name: "X", link: "twitter://" },
  { name: "Reddit", link: "reddit://" },
  { name: "Snapchat", link: "snapchat://" },
  { name: "Threads", link: "barcelona://" },
  { name: "Pinterest", link: "pinterest://" },
  { name: "Bluesky", link: "bluesky://" },
];

// ---------------------------------------------------------------- how often the gate opened

/** Counts are kept for 30 days, then dropped (only on the device). */
export const KEEP_DAYS = 30;

export interface DayCount {
  /** Times the gate opened for the app. */
  shown: number;
  /** Reviews passed (quick or deep). */
  passed: number;
}

/** Per day ("2026-11-27"), per app name. */
export type AttemptLog = Record<string, Record<string, DayCount>>;

const bump = (log: AttemptLog, day: string, app: string, field: keyof DayCount): AttemptLog => {
  const d = log[day] ?? {};
  const c = d[app] ?? { shown: 0, passed: 0 };
  return { ...log, [day]: { ...d, [app]: { ...c, [field]: c[field] + 1 } } };
};

export const recordShown = (log: AttemptLog, day: string, app: string): AttemptLog => bump(log, day, app, "shown");
export const recordPassed = (log: AttemptLog, day: string, app: string): AttemptLog => bump(log, day, app, "passed");

/** Day keys are local dates ("YYYY-MM-DD"); a day is dropped once it is `KEEP_DAYS` or more days before `today`. */
export function prune(log: AttemptLog, today: string): AttemptLog {
  const cutoff = Date.parse(`${today}T00:00:00Z`) - KEEP_DAYS * DAY;
  return Object.fromEntries(Object.entries(log).filter(([day]) => Date.parse(`${day}T00:00:00Z`) > cutoff));
}

/** Totals for one app (or all) over the last `days` days up to `today`, today included. */
export function totals(log: AttemptLog, today: string, days: number, app?: string): DayCount {
  const from = Date.parse(`${today}T00:00:00Z`) - (days - 1) * DAY;
  const out = { shown: 0, passed: 0 };
  for (const [day, apps] of Object.entries(log)) {
    if (Date.parse(`${day}T00:00:00Z`) < from || day > today) continue;
    for (const [name, c] of Object.entries(apps)) {
      if (app && name !== app) continue;
      out.shown += c.shown;
      out.passed += c.passed;
    }
  }
  return out;
}

/** Every app name in the log, most shown first. */
export function appsInLog(log: AttemptLog): string[] {
  const n: Record<string, number> = {};
  for (const apps of Object.values(log)) for (const [name, c] of Object.entries(apps)) n[name] = (n[name] ?? 0) + c.shown;
  return Object.keys(n).sort((a, b) => n[b] - n[a] || a.localeCompare(b));
}
