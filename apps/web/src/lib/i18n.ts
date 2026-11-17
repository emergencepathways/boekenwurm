/**
 * The app's languages (Account → Settings → Localization). One setting decides both the language of the app's own
 * text and the language Dutch is explained in. Text lives in catalogs (src/i18n/<lang>.ts); a phrase missing from a
 * catalog shows in English, so a language can grow screen by screen. Book text, Dutch words and diary prompts stay
 * Dutch, and left-to-right inside an Arabic page.
 *
 * Messages: "{name}" is replaced by vars.name; a message can also be plural forms ({ one, few, many, other, … }),
 * chosen with vars.n by the language's plural rules (Ukrainian has 4, Arabic 6). "**bold**" is shown bold by <T>.
 */
import { createElement, Fragment, useMemo, type ReactNode } from "react";
import { getState, useStore } from "./store.ts";
import { en, type Key } from "../i18n/en.ts";
import { uk } from "../i18n/uk.ts";
import { ar } from "../i18n/ar.ts";

export type Lang = "en" | "uk" | "ar";
export type Plural = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };
export type Message = string | Plural;
export type Catalog = Partial<Record<Key, Message>>;

export interface Language {
  id: Lang;
  /** In English, for the docs. */
  name: string;
  /** In the language itself: what the reader picks. */
  native: string;
  dir: "ltr" | "rtl";
  /** For numbers and dates. Arabic keeps Western digits, as in the Dutch around it. */
  locale: string;
  /** Machine-drafted, waiting for a native speaker's review. */
  draft: boolean;
}

export const LANGUAGES: readonly Language[] = [
  { id: "en", name: "English", native: "English", dir: "ltr", locale: "en-GB", draft: false },
  { id: "uk", name: "Ukrainian", native: "Українська", dir: "ltr", locale: "uk-UA", draft: true },
  { id: "ar", name: "Arabic (Modern Standard)", native: "العربية", dir: "rtl", locale: "ar-u-nu-latn", draft: true },
];

const CATALOGS: Record<Lang, Catalog> = { en, uk, ar };

export const languageOf = (id: string | null | undefined): Language => LANGUAGES.find((l) => l.id === id) ?? LANGUAGES[0];
export const currentLang = (): Lang => languageOf(getState().profile.settings.language).id;

const rules = new Map<Lang, Intl.PluralRules>();
const pluralRule = (lang: Lang) => {
  let r = rules.get(lang);
  if (!r) rules.set(lang, (r = new Intl.PluralRules(languageOf(lang).locale)));
  return r;
};

export type Vars = Record<string, string | number>;

/** A message in a language, with its placeholders filled in. */
export function translate(lang: Lang, key: Key, vars: Vars = {}): string {
  let m: Message | undefined = CATALOGS[lang][key];
  if (m == null) {
    lang = "en";
    m = en[key];
  }
  let text = typeof m === "string" ? m : (m[pluralRule(lang).select(Number(vars.n ?? 0))] ?? m.other);
  for (const [k, v] of Object.entries(vars)) text = text.split(`{${k}}`).join(typeof v === "number" ? formatNumber(v, lang) : v);
  return text;
}

/** For code outside components (toasts): the reader's current language. */
export const t = (key: Key, vars?: Vars): string => translate(currentLang(), key, vars);

export const formatNumber = (n: number, lang: Lang = currentLang()): string => n.toLocaleString(languageOf(lang).locale);
export const formatDate = (ms: number, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }, lang: Lang = currentLang()): string =>
  new Date(ms).toLocaleDateString(languageOf(lang).locale, opts);

/** Text with **bold** parts, as React nodes. */
export function rich(text: string): ReactNode {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return createElement(Fragment, null, ...parts.map((p, i) => (i % 2 ? createElement("b", { key: i }, p) : p)));
}

export interface Translator {
  (key: Key, vars?: Vars): string;
  /** With **bold** shown bold. */
  rich: (key: Key, vars?: Vars) => ReactNode;
  lang: Lang;
  num: (n: number) => string;
  date: (ms: number, opts?: Intl.DateTimeFormatOptions) => string;
}

/** The translator for the reader's language; components re-render when it changes. */
export function useT(): Translator {
  const lang = useStore((s) => languageOf(s.profile.settings.language).id);
  return useMemo(() => {
    const f = ((key: Key, vars?: Vars) => translate(lang, key, vars)) as Translator;
    f.rich = (key, vars) => rich(translate(lang, key, vars));
    f.lang = lang;
    f.num = (n) => formatNumber(n, lang);
    f.date = (ms, opts) => formatDate(ms, opts, lang);
    return f;
  }, [lang]);
}

/** Set the page's language and direction (App does this when the setting changes). */
export function applyLanguage(id: string | null | undefined): void {
  const l = languageOf(id);
  document.documentElement.lang = l.id;
  document.documentElement.dir = l.dir;
}

export type { Key };
