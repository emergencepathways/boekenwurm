/**
 * Me → Connection check: is Supabase reachable, and is the schema (supabase/migrations/0001_init.sql) loaded?
 * Read-only: it asks for row counts, never writes a row.
 */
import { supabase, supabaseHost } from "./supabase.ts";
import { getState } from "./store.ts";

export const TABLES = [
  "profiles", "books", "book_pages", "paragraphs", "paragraph_versions",
  "reading_sessions", "word_stats", "cards", "word_lists", "word_list_entries",
] as const;
export const BUCKETS = ["covers", "pages", "books"] as const;

export interface CheckLine {
  name: string;
  ok: boolean | null; // null: couldn't be checked (signed out)
  detail: string;
}

export interface CheckReport {
  host: string | null;
  lines: CheckLine[];
  schemaLoaded: boolean | null;
}

const missing = (code?: string, msg = "") => code === "PGRST205" || code === "42P01" || /could not find the table|does not exist/i.test(msg);

export async function connectionCheck(): Promise<CheckReport> {
  const lines: CheckLine[] = [];
  if (!supabase) return { host: null, lines: [{ name: "Supabase settings", ok: false, detail: "This build has no Supabase URL or key." }], schemaLoaded: null };
  const url = import.meta.env.VITE_SUPABASE_URL!;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY!;

  try {
    const r = await fetch(`${url.replace(/\/$/, "")}/auth/v1/health`, { headers: { apikey: key } });
    lines.push({ name: "Sign-in service", ok: r.ok, detail: r.ok ? "Reachable" : `Answered ${r.status}` });
  } catch {
    lines.push({ name: "Sign-in service", ok: false, detail: "Not reachable from this device. Check the connection." });
    return { host: supabaseHost, lines, schemaLoaded: null };
  }

  let tablesOk = 0;
  for (const t of TABLES) {
    const { error, count } = await supabase.from(t).select("*", { count: "exact", head: true });
    if (!error) {
      tablesOk++;
      lines.push({ name: `Table ${t}`, ok: true, detail: getState().user ? `${count ?? 0} of your rows` : "Found" });
    } else if (missing(error.code, error.message)) lines.push({ name: `Table ${t}`, ok: false, detail: "Missing: run the schema in the SQL Editor" });
    else lines.push({ name: `Table ${t}`, ok: false, detail: error.message });
  }

  // The counter function: an empty word breaks its check constraint, so it answers without adding a row.
  const fn = await supabase.rpc("add_word_stats", { p_lemma: "", p_reveals: 0, p_encounters: 0, p_last_revealed: null, p_example: null });
  const fnMissing = fn.error?.code === "PGRST202" || /could not find the function/i.test(fn.error?.message ?? "");
  lines.push({ name: "Function add_word_stats", ok: !fnMissing, detail: fnMissing ? "Missing: run the schema in the SQL Editor" : "Found" });

  const user = getState().user;
  for (const b of BUCKETS) {
    if (!user) {
      lines.push({ name: `Storage ${b}`, ok: null, detail: "Sign in to check" });
      continue;
    }
    const { error } = await supabase.storage.from(b).list(user.id, { limit: 1 });
    lines.push({ name: `Storage ${b}`, ok: !error, detail: error ? (/not found/i.test(error.message) ? "Missing: run the schema in the SQL Editor" : error.message) : "Private, your folder only" });
  }

  const schemaLoaded = tablesOk === TABLES.length && !fnMissing ? true : tablesOk === 0 ? false : null;
  return { host: supabaseHost, lines, schemaLoaded };
}
