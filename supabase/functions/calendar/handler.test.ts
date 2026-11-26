// The calendar feed, with the database mocked. Runs under Node:
//   node --test supabase/functions/calendar/handler.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { handle } from "./handler.ts";

const SECRET = "a".repeat(60);
const ICS = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n";

function config(answer: string | null, status = 200) {
  const calls: Array<{ url: string; body: string }> = [];
  return {
    calls,
    cfg: {
      supabaseUrl: "https://x.supabase.co",
      anonKey: "anon",
      fetch: (async (url: string, init: RequestInit = {}) => {
        calls.push({ url, body: String(init.body) });
        return new Response(JSON.stringify(answer), { status });
      }) as typeof fetch,
    },
  };
}

test("a known secret gets its calendar as text/calendar", async () => {
  const { cfg, calls } = config(ICS);
  const r = await handle(new Request(`https://f/calendar?f=${SECRET}`), cfg);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type") ?? "", /^text\/calendar/);
  assert.equal(await r.text(), ICS);
  assert.equal(calls[0].url, "https://x.supabase.co/rest/v1/rpc/app_calendar_ics");
  assert.deepEqual(JSON.parse(calls[0].body), { p_secret: SECRET });
});

test("unknown or malformed secrets get a 404, without asking the database for malformed ones", async () => {
  const unknown = config(null);
  assert.equal((await handle(new Request(`https://f/calendar?f=${SECRET}`), unknown.cfg)).status, 404);
  const bad = config(ICS);
  assert.equal((await handle(new Request("https://f/calendar?f=../../x"), bad.cfg)).status, 404);
  assert.equal((await handle(new Request("https://f/calendar"), bad.cfg)).status, 404);
  assert.equal(bad.calls.length, 0);
});

test("only GET and HEAD; a database error is a 502", async () => {
  assert.equal((await handle(new Request(`https://f/calendar?f=${SECRET}`, { method: "POST" }), config(ICS).cfg)).status, 405);
  assert.equal((await handle(new Request(`https://f/calendar?f=${SECRET}`), config(null, 500).cfg)).status, 502);
});
