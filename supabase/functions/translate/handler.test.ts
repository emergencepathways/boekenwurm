// The translate function's rules, with the database and Google mocked. Runs under Node:
//   node --test supabase/functions/translate/handler.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { handle, cors, WORD, type Config } from "./handler.ts";

interface Call { url: string; init: RequestInit }

/** A database that allows `limit` words a day, and a Google that answers "<word> (en)". */
function world(opts: { used?: number; limit?: number; google?: number; db?: number; dbBody?: unknown } = {}) {
  const calls: Call[] = [];
  let used = opts.used ?? 0;
  const limit = opts.limit ?? 200;
  const fake = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url.includes("/rest/v1/rpc/claim_translation")) {
      if (opts.db) return new Response(JSON.stringify(opts.dbBody ?? {}), { status: opts.db });
      const allowed = used < limit;
      if (allowed) used++;
      return Response.json([{ allowed, used, daily_limit: limit, day: "2026-11-11" }]);
    }
    if (url.startsWith("https://translation.googleapis.com/")) {
      if (opts.google) return new Response("{}", { status: opts.google });
      const q = JSON.parse(String(init.body)).q;
      return Response.json({ data: { translations: [{ translatedText: `${q} &#39;(en)&#39;` }] } });
    }
    throw new Error(`unexpected ${url}`);
  }) as typeof fetch;
  const config: Config = { supabaseUrl: "https://example.supabase.co", supabaseKey: "sb_publishable_test", googleKey: "google-secret", fetch: fake };
  return { calls, config, google: () => calls.filter((c) => c.url.includes("googleapis")), used: () => used };
}

const ask = (word: unknown, headers: Record<string, string> = { authorization: "Bearer reader-token" }, method = "POST") =>
  new Request("https://example.supabase.co/functions/v1/translate", {
    method,
    headers: { "content-type": "application/json", origin: "https://boekenwurm.pages.dev", ...headers },
    body: method === "POST" ? JSON.stringify({ word, tz: "Europe/Amsterdam" }) : undefined,
  });

test("a signed-in reader's word is translated, and only the word is sent to Google", async () => {
  const w = world();
  const r = await handle(ask("fietsenstalling"), w.config);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, text: "fietsenstalling '(en)'", used: 1, limit: 200 });
  const g = w.google();
  assert.equal(g.length, 1);
  assert.deepEqual(JSON.parse(String(g[0].init.body)), { q: "fietsenstalling", source: "nl", target: "en", format: "text" });
  assert.match(g[0].url, /key=google-secret$/);
});

test("the lookup is claimed as the reader, with their token and time zone", async () => {
  const w = world();
  await handle(ask("huis"), w.config);
  const claim = w.calls[0];
  assert.match(claim.url, /\/rest\/v1\/rpc\/claim_translation$/);
  const h = claim.init.headers as Record<string, string>;
  assert.equal(h.authorization, "Bearer reader-token");
  assert.equal(h.apikey, "sb_publishable_test");
  assert.deepEqual(JSON.parse(String(claim.init.body)), { p_tz: "Europe/Amsterdam" });
});

test("word 200 is translated; word 201 is refused and Google is not asked", async () => {
  const w = world({ used: 199 });
  assert.equal((await handle(ask("huis"), w.config)).status, 200);
  const r = await handle(ask("boom"), w.config);
  assert.equal(r.status, 429);
  assert.deepEqual(await r.json(), { ok: false, reason: "limit", used: 200, limit: 200 });
  assert.equal(w.google().length, 1);
});

test("without a reader's token nothing is claimed or translated", async () => {
  const w = world();
  for (const headers of [{}, { authorization: "sb_publishable_test" }, { authorization: "Bearer " }]) {
    const r = await handle(ask("huis", headers), w.config);
    assert.equal(r.status, 401);
    assert.equal(((await r.json()) as { reason: string }).reason, "signin");
  }
  assert.equal(w.calls.length, 0);
});

test("a token the database refuses, or one with no user, means signing in; Google is not asked", async () => {
  for (const [db, dbBody] of [[401, { message: "JWT expired" }], [400, { code: "28000", message: "Sign in to look words up" }]] as const) {
    const w = world({ db, dbBody });
    const r = await handle(ask("huis"), w.config);
    assert.equal(r.status, 401);
    assert.equal(((await r.json()) as { reason: string }).reason, "signin");
    assert.equal(w.google().length, 0);
  }
});

test("only one word: sentences, numbers, empty and over-long input are refused before anything is claimed", async () => {
  const w = world();
  for (const bad of ["twee woorden", "de kat zit op de mat.", "", "   ", "123", "a".repeat(41), 42, null, "<b>huis</b>"]) {
    const r = await handle(ask(bad), w.config);
    assert.equal(r.status, 400, String(bad));
  }
  assert.equal(w.calls.length, 0);
  for (const good of ["zo'n", "e-mail", "café", "Fietsenstalling", "zo’n"]) assert.ok(WORD.test(good), good);
});

test("Google down or the database down: no meaning, the app treats it as unavailable", async () => {
  let w = world({ google: 403 });
  let r = await handle(ask("huis"), w.config);
  assert.equal(r.status, 502);
  assert.equal(((await r.json()) as { reason: string }).reason, "unavailable");
  w = world({ db: 500 });
  r = await handle(ask("huis"), w.config);
  assert.equal(r.status, 503);
  assert.equal(w.google().length, 0);
});

test("no Google key set: unavailable, nothing claimed", async () => {
  const w = world();
  const r = await handle(ask("huis"), { ...w.config, googleKey: "" });
  assert.equal(r.status, 503);
  assert.equal(w.calls.length, 0);
});

test("browsers: the app's own sites may call it; others get no CORS permission; only POST", async () => {
  assert.equal(cors("https://boekenwurm.pages.dev")["access-control-allow-origin"], "https://boekenwurm.pages.dev");
  assert.equal(cors("https://abc123.boekenwurm.pages.dev")["access-control-allow-origin"], "https://abc123.boekenwurm.pages.dev");
  assert.equal(cors("http://localhost:5173")["access-control-allow-origin"], "http://localhost:5173");
  assert.equal(cors("https://evil.example")["access-control-allow-origin"], undefined);
  assert.equal(cors("https://boekenwurm.pages.dev.evil.example")["access-control-allow-origin"], undefined);
  const w = world();
  assert.equal((await handle(ask(null, {}, "OPTIONS"), w.config)).status, 204);
  assert.equal((await handle(ask(null, {}, "GET"), w.config)).status, 405);
});

test("Google refuses a word: the lookup is given back, with Google's reason", async () => {
  const reader = "11111111-2222-4333-8444-555555555555";
  const token = `x.${Buffer.from(JSON.stringify({ sub: reader })).toString("base64url")}.y`;
  const refunds: string[] = [];
  const fake = (async (url: string, init: RequestInit) => {
    if (url.endsWith("/rpc/claim_translation")) return Response.json([{ allowed: true, used: 7, daily_limit: 200, day: "2026-11-13" }]);
    if (url.endsWith("/rpc/refund_translation")) return (refunds.push(String(init.body)), new Response(null, { status: 204 }));
    return Response.json({ error: { message: "Daily Limit Exceeded" } }, { status: 403 });
  }) as typeof fetch;
  const r = await handle(ask("huis", { authorization: `Bearer ${token}` }), { supabaseUrl: "https://example.supabase.co", supabaseKey: "pk", serviceKey: "sk", googleKey: "g", fetch: fake });
  const body = (await r.json()) as { detail: string; used: number };
  assert.equal(body.detail, "Daily Limit Exceeded");
  assert.equal(body.used, 6);
  assert.deepEqual(refunds.map((b) => JSON.parse(b)), [{ p_user: reader, p_day: "2026-11-13" }]);
});
