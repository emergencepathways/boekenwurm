/**
 * The translations: every key a translation has is an English key, each language covers the whole English catalog
 * (missing keys would fall back to English), plurals give every form the language needs, and a translation never
 * drops or invents a {placeholder}.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { en } from "../src/i18n/en.ts";
import { uk } from "../src/i18n/uk.ts";
import { ar } from "../src/i18n/ar.ts";

type Msg = string | Record<string, string>;
const CATALOGS: Record<string, { locale: string; messages: Record<string, Msg> }> = {
  uk: { locale: "uk-UA", messages: uk as Record<string, Msg> },
  ar: { locale: "ar", messages: ar as Record<string, Msg> },
};
const source = en as unknown as Record<string, Msg>;
const forms = (m: Msg) => (typeof m === "string" ? [m] : Object.values(m));
const holes = (s: string) => new Set([...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]));
const holesOf = (m: Msg) => new Set(forms(m).flatMap((s) => [...holes(s)]));

for (const [lang, { locale, messages }] of Object.entries(CATALOGS)) {
  test(`${lang}: only English keys, and every English key translated`, () => {
    const extra = Object.keys(messages).filter((k) => !(k in source));
    const missing = Object.keys(source).filter((k) => !(k in messages));
    assert.deepEqual(extra, []);
    assert.deepEqual(missing, []);
  });

  test(`${lang}: plurals give every form the language uses`, () => {
    const needed = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
    // uk: one, few, many, other (4 forms); ar: zero, one, two, few, many, other (6 forms).
    assert.equal(needed.length, lang === "ar" ? 6 : 4);
    for (const [key, m] of Object.entries(messages)) {
      if (typeof m === "string") continue;
      for (const c of needed) assert.ok(m[c], `${lang} ${key}: no "${c}" form`);
      assert.ok(holes(m.other).has("n") || key.endsWith(".showAll") || key.endsWith(".stuckGo") || key.endsWith(".study"), `${lang} ${key}: "other" must show {n}`);
    }
  });

  test(`${lang}: placeholders match English`, () => {
    for (const [key, m] of Object.entries(messages)) {
      const want = holesOf(source[key]);
      const got = holesOf(m);
      // A form may leave {n} out ("one word", "two words"), never add a hole English doesn't fill.
      for (const h of got) assert.ok(want.has(h), `${lang} ${key}: unknown {${h}}`);
      for (const h of want) if (h !== "n") assert.ok(got.has(h), `${lang} ${key}: lost {${h}}`);
      for (const s of forms(m)) assert.ok(s.trim(), `${lang} ${key}: empty`);
    }
  });

  test(`${lang}: **bold** marks are balanced`, () => {
    for (const [key, m] of Object.entries(messages)) for (const s of forms(m)) assert.equal((s.match(/\*\*/g) ?? []).length % 2, 0, `${lang} ${key}`);
  });
}

test("English plurals have one and other", () => {
  for (const [key, m] of Object.entries(source)) if (typeof m !== "string") assert.ok(m.one && m.other, key);
});
