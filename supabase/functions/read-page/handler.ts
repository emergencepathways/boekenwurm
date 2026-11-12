/**
 * The read-page function: one photographed book page → its text, with Google Cloud Vision (document text detection),
 * for readers who redeemed an access code, at most 20 pages per reader per day.
 *
 * A test of a future paid feature: everyone else reads pages on their own device for free. Each request
 *   1. must come from a signed-in reader (their Supabase access token);
 *   2. claims one page from their daily allowance with claim_page_read (migration 0004), called as the reader, which
 *      also refuses readers without access;
 *   3. sends the photo to Vision and returns its paragraphs with their position on the page, so the app can tell the
 *      page number (at the head or foot) from a chapter number, and words Vision was unsure of.
 *
 * The photo goes only to Google, is not stored by this function, and the key never reaches the app.
 */
import { bearer, claim, cors, replier, timeZone, type ClaimConfig } from "../_shared/common.ts";

export interface Config extends ClaimConfig {
  visionKey: string;
}

/** A paragraph as Vision found it: its text, its box on the page (pixels, y downwards), and how sure Vision was. */
export interface VisionParagraph {
  text: string;
  box: { x0: number; y0: number; x1: number; y1: number };
  /** 0–1. */
  confidence: number;
  /** Words Vision was unsure of (confidence under 0.7). */
  unsure: string[];
}

export interface VisionPage {
  width: number;
  height: number;
  paragraphs: VisionParagraph[];
}

export type Answer =
  | ({ ok: true; used: number; limit: number } & VisionPage)
  | { ok: false; reason: "signin" | "no-access" | "limit" | "unavailable" | "bad-image" | "method"; used?: number; limit?: number };

/** A JPEG or PNG as base64, at most about 7 MB of image (the app sends about 0.5 MB). */
const MAX_BASE64 = 10_000_000;
const isImage = (b64: string) => b64.length <= MAX_BASE64 && /^(\/9j\/|iVBORw0KGgo)[A-Za-z0-9+/]+={0,2}$/.test(b64);

export { cors };

export async function handle(req: Request, config: Config): Promise<Response> {
  const { headers, reply } = replier(req);
  const no = (status: number, body: Answer) => reply(status, body);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return no(405, { ok: false, reason: "method" });

  const auth = bearer(req);
  if (!auth) return no(401, { ok: false, reason: "signin" });

  const body = (await req.json().catch(() => null)) as { image?: unknown; tz?: unknown } | null;
  const image = typeof body?.image === "string" ? body.image.replace(/^data:image\/\w+;base64,/, "").replace(/\s/g, "") : "";
  if (!isImage(image)) return no(400, { ok: false, reason: "bad-image" });
  if (!config.supabaseUrl || !config.visionKey) return no(503, { ok: false, reason: "unavailable" });

  // 2. One page from today's allowance, claimed as the reader; readers without a code are refused here.
  const c = await claim(req, auth, "claim_page_read", timeZone(body?.tz), config);
  if (!c.ok) return no(c.reason === "signin" ? 401 : c.reason === "no-access" ? 403 : 503, { ok: false, reason: c.reason });
  const counts = { used: c.used, limit: c.limit };
  if (!c.allowed) return no(429, { ok: false, reason: "limit", ...counts });

  // 3. The photo to Vision.
  const http = config.fetch ?? fetch;
  try {
    const g = await http(`https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(config.visionKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requests: [{ image: { content: image }, features: [{ type: "DOCUMENT_TEXT_DETECTION" }], imageContext: { languageHints: ["nl"] } }],
      }),
    });
    const out = (await g.json().catch(() => null)) as { responses?: Array<{ fullTextAnnotation?: Annotation; error?: unknown }> } | null;
    const res = out?.responses?.[0];
    if (!g.ok || !res || res.error) return no(502, { ok: false, reason: "unavailable", ...counts });
    return reply(200, { ok: true, ...counts, ...fromAnnotation(res.fullTextAnnotation) } satisfies Answer);
  } catch {
    return no(502, { ok: false, reason: "unavailable", ...counts });
  }
}

// ---------------------------------------------------------------- Vision's answer → paragraphs

interface Vertex { x?: number; y?: number }
interface Symbol { text?: string; property?: { detectedBreak?: { type?: string } } }
interface Word { symbols?: Symbol[]; confidence?: number }
interface Paragraph { boundingBox?: { vertices?: Vertex[] }; words?: Word[]; confidence?: number }
export interface Annotation { pages?: Array<{ width?: number; height?: number; blocks?: Array<{ paragraphs?: Paragraph[] }> }> }

/**
 * Vision's page → paragraphs in reading order. Words are joined by the breaks Vision detected: a space or line break
 * becomes a space, and a word hyphenated at the end of a line ("HYPHEN", the hyphen not in the text) is joined into
 * one word. A paragraph ending in such a hyphen keeps a "-", so the app can join it with the next page.
 */
export function fromAnnotation(a: Annotation | undefined): VisionPage {
  const page = a?.pages?.[0];
  const paragraphs: VisionParagraph[] = [];
  for (const block of page?.blocks ?? []) {
    for (const p of block.paragraphs ?? []) {
      let text = "";
      const unsure: string[] = [];
      const words = p.words ?? [];
      words.forEach((w, wi) => {
        const symbols = w.symbols ?? [];
        const word = symbols.map((s) => s.text ?? "").join("");
        if ((w.confidence ?? 1) < 0.7 && /\p{L}/u.test(word)) unsure.push(word.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, ""));
        symbols.forEach((s, si) => {
          text += s.text ?? "";
          const br = s.property?.detectedBreak?.type;
          const lastOfParagraph = wi === words.length - 1 && si === symbols.length - 1;
          if (br === "HYPHEN") text += lastOfParagraph ? "-" : "";
          else if (br === "SPACE" || br === "SURE_SPACE" || br === "EOL_SURE_SPACE" || br === "LINE_BREAK") text += " ";
        });
      });
      text = text.replace(/\s+/g, " ").replace(/\s+([.,;:!?])/g, "$1").trim();
      if (!text) continue;
      const xs = (p.boundingBox?.vertices ?? []).map((v) => v.x ?? 0);
      const ys = (p.boundingBox?.vertices ?? []).map((v) => v.y ?? 0);
      paragraphs.push({
        text,
        box: { x0: xs.length ? Math.min(...xs) : 0, y0: ys.length ? Math.min(...ys) : 0, x1: xs.length ? Math.max(...xs) : 0, y1: ys.length ? Math.max(...ys) : 0 },
        confidence: Math.round((p.confidence ?? 1) * 100) / 100,
        unsure: [...new Set(unsure.filter((w) => w.length > 1))],
      });
    }
  }
  return { width: page?.width ?? 0, height: page?.height ?? 0, paragraphs };
}
