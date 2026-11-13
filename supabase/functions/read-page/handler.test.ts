// The read-page function's rules, with the database and Google Vision mocked. Page text is invented for the tests.
//   node --test supabase/functions/read-page/handler.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { fromAnnotation, handle, type Annotation, type Config } from "./handler.ts";

/** Vision symbols for a word, with the break after its last letter. */
const word = (t: string, br: string | null = "SPACE", confidence = 0.98) => ({
  confidence,
  symbols: [...t].map((ch, i) => ({ text: ch, ...(i === t.length - 1 && br ? { property: { detectedBreak: { type: br } } } : {}) })),
});
const para = (y: number, words: ReturnType<typeof word>[], confidence = 0.97) => ({
  confidence,
  boundingBox: { vertices: [{ x: 80, y }, { x: 620, y }, { x: 620, y: y + 40 }, { x: 80, y: y + 40 }] },
  words,
});
const PAGE: Annotation = {
  pages: [{
    width: 700, height: 1000,
    blocks: [
      { paragraphs: [para(120, [word("Het"), word("was"), word("nog"), word("vroeg", "LINE_BREAK"), word("toen"), word("Lotte"), word("fiets", "HYPHEN"), word("te", "SPACE"), word("haalde.", "EOL_SURE_SPACE")])] },
      { paragraphs: [para(300, [word("Ze"), word("reed"), word("snel"), word("naar"), word("het"), word("sta", "HYPHEN")])] },
      { paragraphs: [para(940, [word("14", "LINE_BREAK")])] },
    ],
  }],
};

function world(opts: { used?: number; limit?: number; vision?: number; db?: number; dbBody?: unknown } = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let used = opts.used ?? 0;
  const limit = opts.limit ?? 20;
  const fake = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url.includes("/rest/v1/rpc/claim_page_read")) {
      if (opts.db) return new Response(JSON.stringify(opts.dbBody ?? {}), { status: opts.db });
      const allowed = used < limit;
      if (allowed) used++;
      return Response.json([{ allowed, used, daily_limit: limit, day: "2026-11-12" }]);
    }
    if (url.startsWith("https://vision.googleapis.com/")) {
      if (opts.vision) return new Response("{}", { status: opts.vision });
      return Response.json({ responses: [{ fullTextAnnotation: PAGE }] });
    }
    throw new Error(`unexpected ${url}`);
  }) as typeof fetch;
  const config: Config = { supabaseUrl: "https://example.supabase.co", supabaseKey: "sb_publishable_test", visionKey: "vision-secret", fetch: fake };
  return { calls, config, vision: () => calls.filter((c) => c.url.includes("vision.googleapis")) };
}

const JPEG = "/9j/4AAQSkZJRgABAQAAAQABAAD" + "A".repeat(200);
const ask = (image: unknown = JPEG, headers: Record<string, string> = { authorization: "Bearer reader-token" }, method = "POST") =>
  new Request("https://example.supabase.co/functions/v1/read-page", {
    method,
    headers: { "content-type": "application/json", origin: "https://boekenwurm.pages.dev", ...headers },
    body: method === "POST" ? JSON.stringify({ image, tz: "Europe/Amsterdam" }) : undefined,
  });

test("a reader with a code: the photo goes to Vision once, and the page comes back as paragraphs", async () => {
  const w = world();
  const r = await handle(ask(), w.config);
  assert.equal(r.status, 200);
  const body = (await r.json()) as { ok: boolean; used: number; paragraphs: Array<{ text: string }> };
  assert.equal(body.ok, true);
  assert.equal(body.used, 1);
  assert.deepEqual(body.paragraphs.map((p) => p.text), ["Het was nog vroeg toen Lotte fietste haalde.", "Ze reed snel naar het sta-", "14"]);
  const v = w.vision();
  assert.equal(v.length, 1);
  const sent = JSON.parse(String(v[0].init.body));
  assert.equal(sent.requests[0].image.content, JPEG);
  assert.equal(sent.requests[0].features[0].type, "DOCUMENT_TEXT_DETECTION");
  assert.deepEqual(sent.requests[0].imageContext.languageHints, ["nl"]);
  assert.match(v[0].url, /key=vision-secret$/);
});

test("a reader without a code is refused before Vision is asked", async () => {
  const w = world({ db: 400, dbBody: { code: "42501", message: "Google page reading needs an access code" } });
  const r = await handle(ask(), w.config);
  assert.equal(r.status, 403);
  assert.equal(((await r.json()) as { reason: string }).reason, "no-access");
  assert.equal(w.vision().length, 0);
});

test("page 20 is read; page 21 is refused and Vision is not asked", async () => {
  const w = world({ used: 19 });
  assert.equal((await handle(ask(), w.config)).status, 200);
  const r = await handle(ask(), w.config);
  assert.equal(r.status, 429);
  assert.deepEqual(await r.json(), { ok: false, reason: "limit", used: 20, limit: 20 });
  assert.equal(w.vision().length, 1);
});

test("signed out, or not an image: refused before anything is claimed", async () => {
  const w = world();
  assert.equal((await handle(ask(JPEG, {}), w.config)).status, 401);
  for (const bad of ["", "not base64 at all", "R0lGODlhAQABAAAAACw=", 42, "/9j/" + "A".repeat(10_000_001)]) assert.equal((await handle(ask(bad), w.config)).status, 400);
  assert.equal(w.calls.length, 0);
  assert.equal((await handle(ask(`data:image/jpeg;base64,${JPEG}`), w.config)).status, 200, "a data URL is accepted");
});

test("Vision down: unavailable (the app reads the page on the device instead)", async () => {
  const w = world({ vision: 403 });
  const r = await handle(ask(), w.config);
  assert.equal(r.status, 502);
  assert.equal(((await r.json()) as { reason: string }).reason, "unavailable");
});

test("no key set: unavailable, nothing claimed", async () => {
  const w = world();
  assert.equal((await handle(ask(), { ...w.config, visionKey: "" })).status, 503);
  assert.equal(w.calls.length, 0);
});

test("Vision's breaks: spaces and line breaks become spaces, a line-end hyphen joins the word, low confidence is listed", () => {
  const out = fromAnnotation({
    pages: [{
      width: 10, height: 10,
      blocks: [{ paragraphs: [para(1, [word("Hij"), word("riep", "SPACE"), word(":"), word("Ge", "HYPHEN"), word("weldig", "SPACE"), word("vuurtoren", "SPACE", 0.4), word("!", null)])] }],
    }],
  });
  assert.equal(out.paragraphs[0].text, "Hij riep: Geweldig vuurtoren!");
  assert.deepEqual(out.paragraphs[0].unsure, ["vuurtoren"]);
  assert.deepEqual(out.paragraphs[0].box, { x0: 80, y0: 1, x1: 620, y1: 41 });
  assert.deepEqual(fromAnnotation(undefined), { width: 0, height: 0, paragraphs: [] });
});

test("Google refuses: the reader is told Google's reason, and the page is given back by the server", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const reader = "11111111-2222-4333-8444-555555555555";
  const token = `x.${Buffer.from(JSON.stringify({ sub: reader })).toString("base64url")}.y`;
  const fake = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith("/rpc/claim_page_read")) return Response.json([{ allowed: true, used: 3, daily_limit: 20, day: "2026-11-13" }]);
    if (url.endsWith("/rpc/refund_page_read")) return new Response(null, { status: 204 });
    return Response.json({ error: { code: 403, status: "PERMISSION_DENIED", message: "Cloud Vision API has not been used in project 123 before or it is disabled." } }, { status: 403 });
  }) as typeof fetch;
  const config: Config = { supabaseUrl: "https://example.supabase.co", supabaseKey: "pk", serviceKey: "service-secret", visionKey: "vision-secret", fetch: fake };
  const r = await handle(ask(JPEG, { authorization: `Bearer ${token}` }), config);
  assert.equal(r.status, 502);
  const body = (await r.json()) as { reason: string; detail: string; used: number };
  assert.equal(body.reason, "unavailable");
  assert.match(body.detail, /Cloud Vision API has not been used in project 123/);
  assert.equal(body.used, 2, "the page was given back: 3 -> 2");
  const refund = calls.find((c) => c.url.endsWith("/rpc/refund_page_read"))!;
  assert.deepEqual(JSON.parse(String(refund.init.body)), { p_user: reader, p_day: "2026-11-13" });
  assert.equal((refund.init.headers as Record<string, string>).authorization, "Bearer service-secret", "as the server, not the reader");
  assert.ok(!JSON.stringify(body).includes("vision-secret"), "the key is never in the answer");
});

test("without a service key nothing is given back, and the count says so", async () => {
  const w = world({ vision: 500 });
  const body = (await (await handle(ask(), w.config)).json()) as { used: number };
  assert.equal(body.used, 1);
  assert.equal(w.calls.filter((c) => c.url.includes("refund")).length, 0);
});
