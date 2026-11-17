/**
 * Checking a diary entry with LanguageTool (open source, LanguageTool GmbH, Germany). The reader's own device sends
 * the entry when they tap "Check my writing", so the free public API's limits (20 checks a minute, 20 KB a check) are
 * per reader, and the text never passes through Boekenwurm's servers. Nothing is sent while typing.
 *
 * To move to a paid plan or a self-hosted server later, change LANGUAGETOOL_URL (see docs/ARCHITECTURE.md).
 */
export const LANGUAGETOOL_URL = import.meta.env?.VITE_LANGUAGETOOL_URL || "https://api.languagetool.org/v2/check";

export interface Mistake {
  offset: number;
  length: number;
  /** LanguageTool's explanation (in English: the reader is learning Dutch). */
  message: string;
  /** Up to three fixes, best first. */
  fixes: string[];
  /** spelling, grammar, style or punctuation. */
  kind: "spelling" | "grammar" | "style" | "punctuation";
  /** What was written. */
  text: string;
}

export type CheckResult = { ok: true; mistakes: Mistake[] } | { ok: false; reason: "offline" | "busy" | "unavailable" };

interface LtMatch {
  message: string;
  shortMessage?: string;
  offset: number;
  length: number;
  replacements?: Array<{ value: string }>;
  rule?: { issueType?: string; category?: { id?: string } };
}

const kindOf = (m: LtMatch): Mistake["kind"] => {
  const t = m.rule?.issueType ?? "";
  if (t === "misspelling") return "spelling";
  if (t === "typographical" || m.rule?.category?.id === "PUNCTUATION") return "punctuation";
  if (t === "style" || t === "locale-violation" || t === "register") return "style";
  return "grammar";
};

/** LanguageTool's answer to our mistakes, in the order they appear. */
export function parseMatches(text: string, data: unknown): Mistake[] {
  const matches = ((data as { matches?: LtMatch[] })?.matches ?? []).filter((m) => Number.isInteger(m.offset) && Number.isInteger(m.length) && m.length > 0);
  return matches
    .map((m) => ({
      offset: m.offset,
      length: m.length,
      message: m.message,
      fixes: (m.replacements ?? []).map((r) => r.value).filter((v) => typeof v === "string").slice(0, 3),
      kind: kindOf(m),
      text: text.slice(m.offset, m.offset + m.length),
    }))
    .sort((a, b) => a.offset - b.offset);
}

/** Ask LanguageTool about a Dutch text. `fetchFn` is passed in for the tests. */
export async function checkDutch(text: string, fetchFn: typeof fetch = fetch): Promise<CheckResult> {
  try {
    const res = await fetchFn(LANGUAGETOOL_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({ text, language: "nl", motherTongue: "en" }),
    });
    if (res.status === 429) return { ok: false, reason: "busy" };
    if (!res.ok) return { ok: false, reason: "unavailable" };
    return { ok: true, mistakes: parseMatches(text, await res.json()) };
  } catch {
    return { ok: false, reason: typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "unavailable" };
  }
}

/** The text with one mistake fixed, and the other mistakes moved to where they now are. */
export function applyFix(text: string, mistakes: readonly Mistake[], index: number, fix: string): { text: string; mistakes: Mistake[] } {
  const m = mistakes[index];
  const next = text.slice(0, m.offset) + fix + text.slice(m.offset + m.length);
  const shift = fix.length - m.length;
  const rest = mistakes
    .filter((_, i) => i !== index)
    .filter((x) => x.offset + x.length <= m.offset || x.offset >= m.offset + m.length) // overlapping ones are gone
    .map((x) => (x.offset >= m.offset + m.length ? { ...x, offset: x.offset + shift } : x));
  return { text: next, mistakes: rest };
}
