import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createLemmatizer, type IrregularData } from "../src/lemma.ts";

const root = new URL("../../../data/nl/", import.meta.url);
const data: IrregularData = JSON.parse(readFileSync(new URL("irregular-verbs.json", root), "utf8"));
const cases = JSON.parse(readFileSync(new URL("lemma-cases.json", root), "utf8"));

const withLexicon = createLemmatizer(data, cases.lexicon);
for (const [form, expected, why] of cases.cases) {
  test(`${form} -> ${expected} (${why})`, () => assert.equal(withLexicon.lemma(form), expected));
}

const bare = createLemmatizer(data);
for (const [form, expected, why] of cases.no_lexicon) {
  test(`no word list: ${form} -> ${expected} (${why})`, () => assert.equal(bare.lemma(form), expected));
}

test("capitals don't matter", () => assert.equal(withLexicon.lemma("Liep"), "lopen"));
