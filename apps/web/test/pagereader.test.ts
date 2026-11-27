import { test } from "node:test";
import assert from "node:assert/strict";
import { pageReaderFor } from "../src/lib/pagereader.ts";

const owner = { admin: true, hasKey: true, google: true };

test("the owner, with her key on this device, gets the page reader she chose", () => {
  assert.equal(pageReaderFor("google", owner), "google");
  assert.equal(pageReaderFor("google+claude", owner), "google+claude");
  assert.equal(pageReaderFor("claude", owner), "claude");
  assert.equal(pageReaderFor(undefined, owner), "google"); // Google unless she chooses otherwise
});

test("Claude is never used without the admin account and a key on this device", () => {
  for (const a of [{ ...owner, admin: false }, { ...owner, hasKey: false }]) {
    assert.equal(pageReaderFor("claude", a), "google");
    assert.equal(pageReaderFor("google+claude", a), "google");
  }
});

test("Google + Claude needs Google; Claude alone doesn't", () => {
  const noGoogle = { ...owner, google: false };
  assert.equal(pageReaderFor("google+claude", noGoogle), "device");
  assert.equal(pageReaderFor("claude", noGoogle), "claude");
  assert.equal(pageReaderFor("claude", { admin: false, hasKey: true, google: false }), "device");
});
