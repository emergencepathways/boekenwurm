// The weekly diary reminder, with the database and the push service mocked. Runs under Node:
//   node --test supabase/functions/diary-reminder/handler.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { due, handle, localDay, type Subscription } from "./handler.ts";
import { weeklyDue } from "../../../packages/engine/src/diary.ts";

const NOW = new Date("2026-11-22T15:00:00Z"); // Sunday
const sub = (user: string, n = 1): Subscription => ({ endpoint: `https://push.example/${user}/${n}`, user_id: user, p256dh: "k", auth: "a", time_zone: "Europe/Amsterdam" });

function world(o: { subs: Subscription[]; play: Record<string, { diaryDone?: number[]; diaryDays?: string[] }>; status?: (s: Subscription) => number }) {
  const calls: Array<{ url: string; method: string }> = [];
  const sent: string[] = [];
  const fetchFn = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? "GET" });
    if (url.includes("/push_subscriptions?select")) return Response.json(o.subs);
    if (url.includes("/profiles?select")) return Response.json(Object.entries(o.play).map(([user_id, play]) => ({ user_id, progress: { play } })));
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  const config = {
    supabaseUrl: "https://x.supabase.co", serviceKey: "service", publicKey: "BPublicKey", cronSecret: "", now: NOW, fetch: fetchFn,
    send: async (s: Subscription) => (sent.push(s.endpoint), o.status?.(s) ?? 201),
  };
  return { calls, sent, config };
}
const call = (secret = "") => new Request("https://f/diary-reminder", { method: "POST", headers: { "x-cron-secret": secret } });

test("GET gives the app the public key; nothing is sent before the keys exist", async () => {
  const w = world({ subs: [sub("a")], play: {} });
  const get = await handle(new Request("https://f", { method: "GET", headers: { origin: "https://boekenwurm.pages.dev" } }), w.config);
  assert.deepEqual(await get.json(), { publicKey: "BPublicKey" });
  assert.equal(get.headers.get("access-control-allow-origin"), "https://boekenwurm.pages.dev");
  assert.equal((await handle(call(), { ...w.config, publicKey: "" })).status, 503);
  assert.equal((await handle(new Request("https://f", { method: "PUT" }), w.config)).status, 405);
  assert.equal(w.sent.length, 0);
});

test("a cron secret, when set, is required", async () => {
  const w = world({ subs: [sub("a")], play: { a: {} } });
  assert.equal((await handle(call("wrong"), { ...w.config, cronSecret: "s3cret" })).status, 403);
  assert.equal((await handle(call("s3cret"), { ...w.config, cronSecret: "s3cret" })).status, 200);
});

test("at most one reminder per device in 6 days, so calling it again sends nothing more", async () => {
  const w = world({ subs: [{ ...sub("a", 1), last_sent: "2026-11-18T10:00:00Z" }, { ...sub("a", 2), last_sent: "2026-11-15T15:00:00Z" }], play: { a: {} } });
  const r = await (await handle(call(), w.config)).json();
  assert.deepEqual([r.sent, w.sent], [1, ["https://push.example/a/2"]], "4 days ago: skipped; 7 days ago: sent");
});

test("a reminder goes to readers whose diary is waiting this week, on each of their devices", async () => {
  const w = world({
    subs: [sub("due", 1), sub("due", 2), sub("wrote"), sub("finished")],
    play: { due: { diaryDone: [1], diaryDays: ["2026-11-14"] }, wrote: { diaryDone: [1, 2], diaryDays: ["2026-11-17"] }, finished: { diaryDone: Array.from({ length: 20 }, (_, i) => i + 1) } },
  });
  const r = await (await handle(call(), w.config)).json();
  assert.deepEqual(r, { sent: 2, skipped: 2, removed: 0 });
  assert.deepEqual(w.sent, ["https://push.example/due/1", "https://push.example/due/2"]);
});

test("addresses the push service says are gone are removed", async () => {
  const w = world({ subs: [sub("a", 1), sub("a", 2)], play: { a: {} }, status: (s) => (s.endpoint.endsWith("/1") ? 410 : 201) });
  const r = await (await handle(call(), w.config)).json();
  assert.deepEqual(r, { sent: 1, skipped: 0, removed: 1 });
  assert.ok(w.calls.some((c) => c.method === "DELETE" && c.url.includes(encodeURIComponent("https://push.example/a/1"))));
});

test("the week is the reader's own (their time zone), and the rule matches the app's", () => {
  assert.equal(localDay(new Date("2026-11-22T23:30:00Z"), "Europe/Amsterdam"), "2026-11-23", "already Monday in Amsterdam");
  assert.equal(localDay(NOW, "not/a-zone"), "2026-11-22");
  const cases = [
    [{ diaryDone: [1], diaryDays: ["2026-11-16"] }, "2026-11-22"],
    [{ diaryDone: [1], diaryDays: ["2026-11-16"] }, "2026-11-23"],
    [{}, "2026-11-17"],
    [{ diaryDone: Array.from({ length: 20 }, (_, i) => i + 1), diaryDays: [] }, "2026-11-17"],
  ] as const;
  for (const [p, day] of cases) assert.equal(due(p, day), weeklyDue({ done: p.diaryDone ?? [], days: p.diaryDays ?? [] }, day), JSON.stringify([p, day]));
});
