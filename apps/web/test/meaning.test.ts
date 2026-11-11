// When a tap counts: a meaning must really be found. Words here are ordinary Dutch, written for the test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isUsefulTranslation, splitCompound } from "../src/lib/meaning.ts";

test("a translation counts only when it says something new", () => {
  assert.equal(isUsefulTranslation("fietsenstalling", "bicycle shed"), true);
  assert.equal(isUsefulTranslation("gezellig", "cozy"), true);
  assert.equal(isUsefulTranslation("Jansen", "Jansen"), false, "a name handed back");
  assert.equal(isUsefulTranslation("blorp", "blorp"), false, "an unknown word handed back");
  assert.equal(isUsefulTranslation("Hallo", "hallo!"), false, "the same word, other case and punctuation");
  assert.equal(isUsefulTranslation("kaas", ""), false);
  assert.equal(isUsefulTranslation("kaas", "123"), false);
  assert.equal(isUsefulTranslation("kaas", null), false);
});

const DICT: Record<string, string> = {
  fiets: "fiets", fietsen: "fiets", stalling: "stalling", boek: "boek", boeken: "boek", kast: "kast",
  stad: "stad", bus: "bus", huis: "huis", deur: "deur", sleutel: "sleutel", ver: "ver",
};
const known = (w: string) => DICT[w] ?? null;

test("a compound splits into two dictionary words, with linking letters", () => {
  assert.deepEqual(splitCompound("fietsenstalling", known), { left: "fiets", right: "stalling" });
  assert.deepEqual(splitCompound("boekenkast", known), { left: "boek", right: "kast" });
  assert.deepEqual(splitCompound("stadsbus", known), null, "the head (bus) is under 4 letters");
  assert.equal(splitCompound("huisdeursleutel", known), null, "three parts are left to the translator");
  assert.deepEqual(splitCompound("Huisdeur", known), { left: "huis", right: "deur" });
});

test("no split from short or unknown parts", () => {
  assert.equal(splitCompound("verkeerd", known), null, "ver + keerd: keerd is not a word");
  assert.equal(splitCompound("kast", known), null, "too short to be a compound");
  assert.equal(splitCompound("fiets-tocht", known), null);
});
