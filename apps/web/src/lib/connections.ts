/**
 * Connected apps (migrations 0013-0015, docs/CONNECTED_APPS.md). PRELAUNCH-REMOVE: for the owner's own use only
 * (the admin feature, checked by the database too); removed before any public release (docs/PRELAUNCH.md).
 *
 * Connecting is a browser handoff with PKCE, as desktop apps sign in (RFC 8252, RFC 7636): Account → Experimental →
 * "Connect Poortwachter" opens Poortwachter on this computer (http://127.0.0.1:7623), which sends the browser back
 * here with a one-time challenge; the reader reads what will be shared and allows it; link_app() makes a 2-minute
 * code bound to that challenge, and the browser takes it back to Poortwachter, which trades code + its secret for its
 * token. Nothing to type. The app sees only today's numbers (pages, active reading minutes, cards reviewed, diary
 * yes/no). Active reading time is measured only while an app is connected. Unused for 90 days, a connection expires.
 */
import { supabase } from "./supabase.ts";
import { getState, setState } from "./store.ts";

export interface Connection {
  id: string;
  app: string;
  name: string;
  created_at: string;
  approved_at: string | null;
  last_used_at: string | null;
  expires_at: string;
}

/** The database doesn't have connected apps yet (migrations 0013 and 0014 not run). */
export class NotReady extends Error {}

function ready(message: string): never {
  if (/my_app_connections|link_app|could not find|does not exist/i.test(message)) throw new NotReady(message);
  throw new Error(message);
}

/** Poortwachter's address on the reader's computer: fixed, so no request can send a code anywhere else. */
export const POORTWACHTER = "http://127.0.0.1:7623";

/** Where "Connect Poortwachter" goes: Poortwachter starts the handoff and sends the browser back here. */
export const startUrl = (origin: string): string => `${POORTWACHTER}/boekenwurm/connect?site=${encodeURIComponent(origin)}`;

/** What Poortwachter asks for when it sends the browser here (?connect=poortwachter&challenge=…&state=…&name=…). */
export interface LinkRequest {
  challenge: string;
  state: string;
  name: string;
  at: number;
}

const REQUEST_KEY = "boekenwurm.appLinkRequest";
const REQUEST_MINUTES = 10;

/** A request from the address bar, checked; null when there is none or it isn't well formed. */
export function parseLinkRequest(search: string, now = Date.now()): LinkRequest | null {
  const q = new URLSearchParams(search);
  if (q.get("connect") !== "poortwachter") return null;
  const challenge = q.get("challenge") ?? "";
  const state = q.get("state") ?? "";
  const name = (q.get("name") ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 80) || "Poortwachter";
  if (!/^[A-Za-z0-9_-]{43}$/.test(challenge) || !/^[A-Za-z0-9_-]{16,64}$/.test(state)) return null;
  return { challenge, state, name, at: now };
}

/** Kept for this tab only, so it survives signing in, and only for 10 minutes. */
export function saveLinkRequest(r: LinkRequest): void {
  try {
    sessionStorage.setItem(REQUEST_KEY, JSON.stringify(r));
  } catch { /* private mode: the request lives as long as the page */ }
  pendingRequest = r;
}
let pendingRequest: LinkRequest | null = null;

export function linkRequest(now = Date.now()): LinkRequest | null {
  let r = pendingRequest;
  try {
    const raw = sessionStorage.getItem(REQUEST_KEY);
    if (raw) r = JSON.parse(raw) as LinkRequest;
  } catch { /* ignore */ }
  return r && now - r.at < REQUEST_MINUTES * 60_000 ? r : null;
}

export function clearLinkRequest(): void {
  pendingRequest = null;
  try {
    sessionStorage.removeItem(REQUEST_KEY);
  } catch { /* ignore */ }
}

/** The reader clicked Allow: make the one-time code and return where the browser takes it (Poortwachter). */
export async function allowLink(r: LinkRequest): Promise<string> {
  if (!supabase || !getState().user) throw new Error("Sign in first.");
  const { data, error } = await supabase.rpc("link_app", { p_challenge: r.challenge, p_name: r.name, p_app: "poortwachter" });
  if (error) ready(error.message);
  clearLinkRequest();
  return `${POORTWACHTER}/boekenwurm/linked?${new URLSearchParams({ code: String(data), state: r.state })}`;
}

export async function listConnections(): Promise<Connection[]> {
  if (!supabase || !getState().user) return [];
  const { data, error } = await supabase.rpc("my_app_connections");
  if (error) ready(error.message);
  const list = (data ?? []) as Connection[];
  setState({ appsConnected: list.some((c) => c.approved_at) });
  return list;
}

/** Disconnect an app, or turn down a request. */
export async function disconnect(id: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from("app_connections").delete().eq("id", id);
  if (error) throw new Error(error.message);
  await listConnections().catch(() => {});
}

/** Is any app connected? Active reading time is measured only then (and the database drops it otherwise). */
export async function refreshAppsConnected(): Promise<void> {
  try {
    await listConnections();
  } catch {
    setState({ appsConnected: false });
  }
}

/** Erase from my account: every connection, request and pairing code. Quiet before the migrations exist. */
export async function forgetConnections(): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.rpc("forget_app_connections");
  if (error && !/forget_app_connections|could not find|does not exist/i.test(error.message)) throw new Error(error.message);
  setState({ appsConnected: false });
}

/** For "Export everything": the connections and the reading activity measured for them. */
export async function exportConnections(): Promise<{ connections: Connection[]; readingActivity: unknown[] }> {
  if (!supabase || !getState().user) return { connections: [], readingActivity: [] };
  const connections = await listConnections().catch(() => [] as Connection[]);
  const { data } = await supabase
    .from("reading_sessions")
    .select("id, book_id, started_at, ended_at, active_seconds, text_level, reader_rank")
    .or("active_seconds.gt.0,text_level.not.is.null,reader_rank.not.is.null")
    .order("started_at", { ascending: false });
  return { connections, readingActivity: data ?? [] };
}

