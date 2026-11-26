/**
 * A connected app's calendar feed (migration 0013, docs/CONNECTED_APPS.md).
 *
 * GET ?f=<secret>: the iCalendar a connected app (Poortwachter) published with put_app_calendar, so a calendar app
 * such as Google Calendar can subscribe to it. The secret is the only key: it is stored as a hash and the reader can
 * replace it from the app. Unknown secrets get the same 404 as a missing one.
 *
 * Calls the app_calendar_ics() database function with the publishable key: this function needs no service key.
 * Plain TypeScript, tested under Node (handler.test.ts); index.ts is the Deno entry.
 */

export interface Config {
  supabaseUrl: string;
  anonKey: string;
  fetch?: typeof fetch;
}

const SECRET = /^[0-9a-f]{40,128}$/;

export async function handle(req: Request, config: Config): Promise<Response> {
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
  const secret = new URL(req.url).searchParams.get("f") ?? "";
  if (!SECRET.test(secret)) return notFound();
  const f = config.fetch ?? fetch;
  const r = await f(`${config.supabaseUrl}/rest/v1/rpc/app_calendar_ics`, {
    method: "POST",
    headers: { apikey: config.anonKey, authorization: `Bearer ${config.anonKey}`, "content-type": "application/json" },
    body: JSON.stringify({ p_secret: secret }),
  });
  if (!r.ok) return new Response("The calendar is unavailable right now.", { status: 502 });
  const ics = (await r.json()) as string | null;
  if (!ics) return notFound();
  return new Response(req.method === "HEAD" ? null : ics, {
    status: 200,
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'inline; filename="poortwachter.ics"',
      "cache-control": "private, max-age=900",
    },
  });
}

const notFound = () => new Response("No such calendar.", { status: 404 });
