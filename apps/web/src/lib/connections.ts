/**
 * Connected apps (migrations 0013 + 0014, docs/CONNECTED_APPS.md). PRELAUNCH-REMOVE: for the owner's own use only;
 * removed before any public release (docs/PRELAUNCH.md).
 *
 * A reader agrees to what an app such as Poortwachter will see, gets a 10-minute code, types it into the app, and
 * then approves the app's request here. An approved app sees only today's numbers (pages, active reading minutes,
 * cards reviewed, diary yes/no). Active reading time is measured only while an app is connected. Unused for 90
 * days, a connection expires.
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
  if (/my_app_connections|create_pairing_code|approve_app_connection|could not find|does not exist/i.test(message)) throw new NotReady(message);
  throw new Error(message);
}

export async function createPairingCode(app = "poortwachter"): Promise<string> {
  if (!supabase || !getState().user) throw new Error("Sign in first.");
  const { data, error } = await supabase.rpc("create_pairing_code", { p_app: app });
  if (error) ready(error.message);
  return String(data);
}

export async function listConnections(): Promise<Connection[]> {
  if (!supabase || !getState().user) return [];
  const { data, error } = await supabase.rpc("my_app_connections");
  if (error) ready(error.message);
  const list = (data ?? []) as Connection[];
  setState({ appsConnected: list.some((c) => c.approved_at) });
  return list;
}

export async function approve(id: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.rpc("approve_app_connection", { p_id: id });
  if (error) throw new Error(/expired/i.test(error.message) ? error.message : "That didn't work. Try again.");
  setState({ appsConnected: true });
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

/** How long a pairing code, and an unapproved request, are valid. */
export const PAIRING_MINUTES = 10;
