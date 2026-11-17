/**
 * Diary entries live on this device only (IndexedDB), never on Boekenwurm's servers: a diary can hold the most
 * personal things a reader writes. Clearing the app's data or signing out with "remove from this device" erases them.
 * Only what an entry earned (prompt number, day) is in the synced play record (packages/engine/src/diary.ts).
 */
import { db } from "./db.ts";

export interface DiaryEntry {
  id: string;
  /** When it was saved (ms). */
  at: number;
  promptId: number | null;
  text: string;
}

const KEY = "diaryEntries";

export async function loadEntries(): Promise<DiaryEntry[]> {
  return ((await db.get<DiaryEntry[]>("kv", KEY)) ?? []).sort((a, b) => b.at - a.at);
}

export async function addEntry(e: Omit<DiaryEntry, "id" | "at">): Promise<DiaryEntry> {
  const entry: DiaryEntry = { ...e, id: crypto.randomUUID(), at: Date.now() };
  await db.put("kv", [entry, ...(await loadEntries())], KEY);
  return entry;
}

export async function deleteEntry(id: string): Promise<void> {
  await db.put("kv", (await loadEntries()).filter((e) => e.id !== id), KEY);
}
