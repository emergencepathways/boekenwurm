/**
 * The device store (IndexedDB). It is the source of truth on the device: reading never waits for the network,
 * and Supabase is synced in the background when the reader is signed in.
 *
 * Stores: kv (profile, word book, cards, outbox…), books, texts (paragraphs per book), blobs (covers, page
 * photos), cache (Claude replies: matched paragraphs, explanations, grades).
 */
const NAME = "boekenwurm-app";
const VERSION = 1;
export type StoreName = "kv" | "books" | "texts" | "blobs" | "cache";

let dbp: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  return (dbp ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of ["kv", "blobs", "cache"]) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
        if (!db.objectStoreNames.contains("books")) db.createObjectStore("books", { keyPath: "id" });
        if (!db.objectStoreNames.contains("texts")) db.createObjectStore("texts", { keyPath: "bookId" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null); // private mode in some browsers: the app still works for this visit
    }
  }));
}

function run<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T | undefined> {
  return open().then(
    (db) =>
      new Promise<T | undefined>((resolve) => {
        if (!db) return resolve(undefined);
        try {
          const r = fn(db.transaction(store, mode).objectStore(store));
          r.onsuccess = () => resolve(r.result as T);
          r.onerror = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      }),
  );
}

export const db = {
  get: <T>(store: StoreName, key: IDBValidKey) => run<T>(store, "readonly", (s) => s.get(key)),
  all: <T>(store: StoreName) => run<T[]>(store, "readonly", (s) => s.getAll()).then((v) => v ?? []),
  put: (store: StoreName, value: unknown, key?: IDBValidKey) =>
    run(store, "readwrite", (s) => (key === undefined ? s.put(value) : s.put(value, key))).then(() => undefined),
  del: (store: StoreName, key: IDBValidKey) => run(store, "readwrite", (s) => s.delete(key)).then(() => undefined),
  clear: (store: StoreName) => run(store, "readwrite", (s) => s.clear()).then(() => undefined),
  /** Delete every key that starts with `prefix` (string keys only), e.g. all of a book's page photos. */
  delPrefix: (store: StoreName, prefix: string) =>
    run(store, "readwrite", (s) => s.delete(IDBKeyRange.bound(prefix, prefix + "\uffff"))).then(() => undefined),
  available: () => open().then(Boolean),
};

/** Erase everything on this device (Me → Delete data on this device). */
export async function wipeDevice(): Promise<void> {
  for (const s of ["kv", "books", "texts", "blobs", "cache"] as StoreName[]) await db.clear(s);
}
