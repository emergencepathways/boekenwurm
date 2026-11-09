/**
 * Where the reader is: a tab (Home · Study · Me) and, on top of it, at most one full screen (the reader, Add
 * book, the camera flow). Full screens go into the browser history, so the phone's back gesture closes them.
 */
import { useSyncExternalStore } from "react";

export type Tab = "home" | "study" | "me";
export type Screen =
  | { name: "reader"; bookId: string }
  | { name: "add" }
  | { name: "photo"; bookId?: string }
  | { name: "study-session"; lemmas?: string[] };

interface Nav {
  tab: Tab;
  screen: Screen | null;
}

let nav: Nav = { tab: "home", screen: null };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function useNav(): Nav {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => void listeners.delete(l)),
    () => nav,
  );
}

/** Switch tab (closing any full screen). `section` scrolls to an element id on the new tab. */
export function setTab(tab: Tab, section?: string): void {
  if (nav.screen && history.state?.bw) history.back();
  nav = { tab, screen: null };
  emit();
  window.scrollTo(0, 0);
  if (section) setTimeout(() => document.getElementById(section)?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
}

export function open(screen: Screen): void {
  const replace = Boolean(nav.screen);
  nav = { ...nav, screen };
  if (replace) history.replaceState({ bw: 1 }, "");
  else history.pushState({ bw: 1 }, "");
  emit();
  window.scrollTo(0, 0);
}

/** Close the full screen (the same as the phone's back gesture). */
export function close(): void {
  if (nav.screen && history.state?.bw) history.back();
  else {
    nav = { ...nav, screen: null };
    emit();
  }
}

window.addEventListener("popstate", () => {
  if (!nav.screen) return;
  nav = { ...nav, screen: null };
  emit();
});
