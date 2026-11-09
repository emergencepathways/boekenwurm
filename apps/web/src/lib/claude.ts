/**
 * Calls to Claude with the reader's own API key, straight from their device to api.anthropic.com.
 * Boekenwurm has no key of its own and no server that calls a model (ARCHITECTURE.md, "Who pays for AI").
 * The key is kept on this device only and is never synced to Supabase.
 */
import type { Prompt, VisionPrompt } from "@boekenwurm/ai";

const KEY_STORE = "boekenwurm-claude-key";

export const MODELS: Array<[id: string, name: string, note: string]> = [
  ["claude-sonnet-5-5", "Claude Sonnet 5.5", "Accurate Dutch at a moderate cost (default)"],
  ["claude-opus-5-5", "Claude Opus 5.5", "The most careful Dutch; slower and costlier"],
  ["claude-haiku-5-5", "Claude Haiku 5.5", "Fastest and cheapest"],
];

export function claudeKey(): string {
  try {
    return localStorage.getItem(KEY_STORE) ?? "";
  } catch {
    return "";
  }
}

export function setClaudeKey(key: string): void {
  try {
    if (key) localStorage.setItem(KEY_STORE, key);
    else localStorage.removeItem(KEY_STORE);
  } catch {
    /* storage blocked: the key lasts for this visit only */
  }
  window.dispatchEvent(new Event("boekenwurm:key"));
}

export const hasKey = (): boolean => Boolean(claudeKey());

/** An error with a message the reader can act on. */
export class AiError extends Error {}

type Content = string | VisionPrompt["content"];

async function call(system: string, content: Content, maxTokens: number, model: string, signal?: AbortSignal): Promise<string> {
  const key = claudeKey();
  if (!key) throw new AiError("Add your Claude API key under Me → Claude to use this.");
  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        // Anthropic allows calls from a browser with the reader's own key when this header is set.
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content }] }),
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new AiError("Couldn't reach Claude. Check your connection and try again.");
  }
  if (!res.ok) {
    let detail = "";
    try {
      detail = ((await res.json()) as { error?: { message?: string } })?.error?.message ?? "";
    } catch {
      /* no body */
    }
    if (res.status === 401 || res.status === 403) throw new AiError("Claude refused your API key. Check it under Me → Claude.");
    if (res.status === 404) throw new AiError(`Claude doesn't know the model "${model}". Pick another under Me → Claude.`);
    if (res.status === 429) throw new AiError("Too many requests, or your monthly spending limit was reached. Try again in a minute.");
    if (res.status === 413) throw new AiError("That photo is too large to send. Try again; it will be made smaller.");
    if (res.status >= 500) throw new AiError("Claude is busy. Try again in a moment.");
    throw new AiError(`Claude returned an error (${res.status}). ${detail}`.trim());
  }
  const body = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  return (body.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
}

export const claude = (p: Prompt, model: string, signal?: AbortSignal) => call(p.system, p.user, p.maxTokens, model, signal);
export const claudeVision = (p: VisionPrompt, model: string, signal?: AbortSignal) => call(p.system, p.content, p.maxTokens, model, signal);

/** A tiny request to check that the key and model work. */
export async function testKey(model: string): Promise<void> {
  await call("Reply with the single word: ok", "ok?", 5, model);
}
