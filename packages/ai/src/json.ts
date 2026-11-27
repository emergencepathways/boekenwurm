/**
 * JSON from a model's reply. Every reply is untrusted: parsed defensively, then checked by the caller.
 */

/** Extract the first JSON object or array from a model reply (tolerates ```json fences and surrounding prose). */
export function parseJson<T = unknown>(reply: string): T {
  const fenced = reply.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : reply;
  const start = body.search(/[[{]/);
  if (start < 0) throw new Error("The reply contained no JSON.");
  const open = body[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  for (let i = start; i < body.length; i++) {
    const c = body[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return JSON.parse(body.slice(start, i + 1)) as T;
  }
  throw new Error("The reply's JSON was cut off.");
}
