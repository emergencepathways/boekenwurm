import { test } from "node:test";
import assert from "node:assert/strict";
import { explainsWords, lookupOrder } from "../src/lib/lookuporder.ts";

test("without Claude access: Google Translate, then compound parts; Claude never, whatever the setting", () => {
  assert.deepEqual(lookupOrder(undefined, false), ["translate", "compound"]);
  assert.deepEqual(lookupOrder("claude", false), ["translate", "compound"]);
});

test("with Claude access: Claude last by default, first if chosen (Google then only when Claude finds nothing)", () => {
  assert.deepEqual(lookupOrder(undefined, true), ["translate", "compound", "claude"]);
  assert.deepEqual(lookupOrder("google", true), ["translate", "compound", "claude"]);
  assert.deepEqual(lookupOrder("claude", true), ["claude", "translate", "compound"]);
});

test("words in their sentence: only with Claude access, on unless turned off", () => {
  assert.equal(explainsWords(undefined, true), true);
  assert.equal(explainsWords(false, true), false);
  assert.equal(explainsWords(true, false), false);
});
