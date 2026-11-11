// The daily Google Translate allowance. The count itself is kept by the database (supabase/tests/rls_test.sql) and
// claimed by the translate function (supabase/functions/translate/handler.test.ts); here, the app's side.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DAILY_TRANSLATIONS, localDay } from "../src/lib/usage.ts";

test("200 words a day, the same number the database allows", async () => {
  assert.equal(DAILY_TRANSLATIONS, 200);
  const { readFileSync } = await import("node:fs");
  const sql = readFileSync(new URL("../../../supabase/migrations/0003_translations.sql", import.meta.url), "utf8");
  assert.match(sql, /lim\s+(constant\s+)?integer\s*(:=|default)\s*200/i);
});

test("the day turns at the reader's midnight", () => {
  const t = new Date("2026-11-11T23:30:00Z"); // 00:30 on the 12th in Den Haag
  assert.equal(localDay(t, "Europe/Amsterdam"), "2026-11-12");
  assert.equal(localDay(t, "America/New_York"), "2026-11-11");
});
