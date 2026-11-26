/**
 * PRELAUNCH-REMOVE (docs/PRELAUNCH.md): only for connected apps, removed before a public release.
 *
 * Active reading time: how long the reader actually read in a session, for connected apps such as Poortwachter
 * (docs/CONNECTED_APPS.md). Wall-clock time from start to end would count a book left open on the table; this only
 * counts time while the book is on screen and the reader did something (turned a paragraph, tapped a word, scrolled,
 * pressed a key) in the last two minutes. A long gap between ticks (the device slept) counts for nothing.
 *
 * Pure: the clock is passed in.
 */

/** No input for this long and the reader is taken to be away; time stops counting at the last input + this. */
export const IDLE_MS = 120_000;
/** A gap between two ticks longer than this (sleep, a frozen tab) adds nothing. */
export const MAX_TICK_GAP_MS = 60_000;

export interface ActiveClock {
  /** Active time counted so far. */
  activeMs: number;
  /** The last moment counted up to. */
  lastTick: number;
  /** The last input. */
  lastInput: number;
}

export function startClock(now: number): ActiveClock {
  return { activeMs: 0, lastTick: now, lastInput: now };
}

/** Count the time since the last tick: only while on screen, and only up to two minutes after the last input. */
export function tickClock(c: ActiveClock, now: number, visible: boolean): ActiveClock {
  if (now <= c.lastTick) return c;
  const gap = now - c.lastTick;
  let add = 0;
  if (visible && gap <= MAX_TICK_GAP_MS) {
    const until = Math.min(now, c.lastInput + IDLE_MS);
    add = Math.max(0, until - c.lastTick);
  }
  return { ...c, activeMs: c.activeMs + add, lastTick: now };
}

/** The reader did something: count up to now first, then restart the idle window. */
export function noteInput(c: ActiveClock, now: number, visible: boolean): ActiveClock {
  return { ...tickClock(c, now, visible), lastInput: Math.max(c.lastInput, now) };
}

export const activeSeconds = (c: ActiveClock): number => Math.round(c.activeMs / 1000);
