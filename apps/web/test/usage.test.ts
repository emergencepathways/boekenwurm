// The daily Google Translate allowance, kept on the device when the reader isn't signed in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { claimOnDevice, DAILY_TRANSLATIONS, localDay } from "../src/lib/usage.ts";

test("200 words a day: the 200th lookup is allowed, the 201st is not", () => {
  assert.equal(DAILY_TRANSLATIONS, 200);
  let state = null as ReturnType<typeof claimOnDevice>["state"] | null;
  for (let i = 1; i <= 200; i++) {
    const r = claimOnDevice(state, "2026-11-11");
    assert.equal(r.claim.allowed, true, `lookup ${i}`);
    state = r.state;
  }
  assert.equal(state!.words, 200);
  const over = claimOnDevice(state, "2026-11-11");
  assert.deepEqual(over.claim, { allowed: false, used: 200, limit: 200 });
  assert.equal(over.state.words, 200, "a refused lookup adds nothing");
});

test("the count starts again on a new day", () => {
  const r = claimOnDevice({ day: "2026-11-11", words: 200 }, "2026-11-12");
  assert.deepEqual(r.claim, { allowed: true, used: 1, limit: 200 });
});

test("the day turns at the reader's midnight", () => {
  const t = new Date("2026-11-11T23:30:00Z"); // 00:30 on the 12th in Den Haag
  assert.equal(localDay(t, "Europe/Amsterdam"), "2026-11-12");
  assert.equal(localDay(t, "America/New_York"), "2026-11-11");
});
