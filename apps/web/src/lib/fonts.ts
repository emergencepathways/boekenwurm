/**
 * The reader's font pairing: one font for the book text, one for everything around it. All are SIL Open Font
 * License 1.1 (free in commercial apps) and are served from Boekenwurm itself (fontsource packages, bundled at build
 * time), so opening the app sends nothing to a font service: no reader IP address reaches Google (GDPR).
 */
export type FontChoice = "literata" | "source" | "newsreader";

export interface FontPairing {
  id: FontChoice;
  name: string;
  read: string;
  ui: string;
  about: string;
}

export const FONTS: readonly FontPairing[] = [
  { id: "literata", name: "Easiest to read", read: "Literata", ui: "Atkinson Hyperlegible Next", about: "Letters that are easy to tell apart, made for low vision." },
  { id: "source", name: "Classic book", read: "Source Serif 4", ui: "Source Sans 3", about: "A calm, traditional book face with a matching sans." },
  { id: "newsreader", name: "Warm and friendly", read: "Newsreader", ui: "Lexend", about: "A gentle serif and a rounded, open sans for fluent reading." },
];

export const DEFAULT_FONT: FontChoice = "literata";
export const fontOf = (id: string | null | undefined): FontPairing => FONTS.find((f) => f.id === id) ?? FONTS[0];

/** Switch the whole app to a pairing (styles.css picks the fonts by `data-font`). */
export function applyFont(id: string | null | undefined): void {
  document.documentElement.dataset.font = fontOf(id).id;
}
