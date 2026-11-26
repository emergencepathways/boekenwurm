/**
 * Connected apps (migration 0013, docs/CONNECTED_APPS.md). A reader pairs an app such as Poortwachter with a short
 * code made here; the app trades it once for its own token, which opens only a daily summary of numbers and the
 * app's calendar feed. Readers see their connections and can disconnect any of them.
 */
import { supabase } from "./supabase.ts";
import { getState } from "./store.ts";

export interface Connection {
  id: string;
  app: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

/** The database doesn't have connected apps yet (migration 0013 not run). */
export class NotReady extends Error {}

function ready(message: string): never {
  if (/app_connections|create_pairing_code|could not find|does not exist/i.test(message)) throw new NotReady(message);
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
  const { data, error } = await supabase
    .from("app_connections")
    .select("id, app, name, created_at, last_used_at")
    .order("created_at", { ascending: false });
  if (error) ready(error.message);
  return (data ?? []) as Connection[];
}

export async function disconnect(id: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from("app_connections").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** How long a pairing code is valid (create_pairing_code in migration 0013). */
export const PAIRING_MINUTES = 10;
