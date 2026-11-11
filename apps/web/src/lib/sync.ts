/**
 * Sync between the device store and Supabase, when the reader is signed in. Push what changed here, then pull
 * what changed elsewhere. Runs a few seconds after a change, when the app comes back to the foreground, and when
 * the network returns. Never blocks reading.
 */
import type { Progress } from "@boekenwurm/engine";
import { supabase } from "./supabase.ts";
import { db, wipeDevice } from "./db.ts";
import {
  adoptBook, adoptProfile, getState, init, loadCover, saveBook, saveCover, setCards, setState, setWordbook,
} from "./store.ts";
import { bookToRow, mergeProgress, rowToBook, serverWins, wordbookFrom, type BookRow, type WordStatRow } from "./merge.ts";
import { fromRow } from "./srs.ts";
import type { BookText, CardState, Paragraph, SessionRow, WordDelta } from "./types.ts";

let running: Promise<void> | null = null;
let again = false;
let timer: ReturnType<typeof setTimeout> | undefined;

const errText = (e: unknown) => (e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e));

function check<T>(r: { data: T; error: { message: string; code?: string } | null }): T {
  if (r.error) throw Object.assign(new Error(r.error.message), { code: r.error.code });
  return r.data;
}

/** Run a sync now (or once more after the one in progress). */
export function syncNow(): Promise<void> {
  if (!supabase || !getState().user) return Promise.resolve();
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      await syncOnce();
    } while (again);
  })().finally(() => (running = null));
  return running;
}

export function scheduleSync(ms = 3000): void {
  clearTimeout(timer);
  timer = setTimeout(() => void syncNow(), ms);
}

async function syncOnce(): Promise<void> {
  const sb = supabase!;
  const user = getState().user!;
  if (!navigator.onLine) return setState({ sync: { ...getState().sync, status: "offline" } });
  setState({ sync: { ...getState().sync, status: "syncing", error: null } });
  const started = Date.now();
  try {
    await pushDeletes(sb);
    await syncProfile(sb, user.id);
    await pushBooks(sb, user.id);
    await pushSessions(sb, user.id);
    await pushWordDeltas(sb);
    await pushCards(sb, user.id);
    const since = (await db.get<number>("kv", "lastPull")) ?? 0;
    await pullBooks(sb, since);
    await pullWords(sb);
    await pullCards(sb, since);
    // A minute of overlap covers clocks that disagree a little.
    await db.put("kv", started - 60_000, "lastPull");
    await db.put("kv", user.id, "owner");
    setState({ sync: { status: "idle", lastAt: Date.now(), error: null } });
  } catch (e) {
    setState({ sync: { status: navigator.onLine ? "error" : "offline", lastAt: getState().sync.lastAt, error: errText(e) } });
  }
}

type SB = NonNullable<typeof supabase>;

async function pushDeletes(sb: SB) {
  const gone = (await db.get<string[]>("kv", "deletedBooks")) ?? [];
  if (!gone.length) return;
  check(await sb.from("books").delete().in("id", gone));
  await db.put("kv", [], "deletedBooks");
}

async function syncProfile(sb: SB, userId: string) {
  const local = getState().profile;
  const row = check(
    await sb.from("profiles").select("display_name, level, settings, progress, updated_at").eq("user_id", userId).maybeSingle(),
  ) as { display_name: string | null; settings: Record<string, unknown>; progress: Progress | Record<string, never>; updated_at: string } | null;
  const serverAt = row ? Date.parse(row.updated_at) : 0;
  const serverProgress = row && Array.isArray((row.progress as Progress).badges) ? (row.progress as Progress) : null;

  // A new account (empty progress) takes this device's progress. Otherwise newer wins, and nothing earned is lost.
  const progress = mergeProgress(local.progress, local.dirty ? local.updatedAt : 0, serverProgress, serverAt);
  const useServer = serverProgress && !local.dirty && serverAt > local.updatedAt;
  const settings = useServer ? { ...local.settings, ...(row!.settings as object) } : local.settings;
  const next = { ...local, progress, settings, displayName: useServer ? row!.display_name : local.displayName, onboarded: local.onboarded || Boolean(serverProgress) };

  if (useServer && JSON.stringify(progress) === JSON.stringify(serverProgress)) {
    await adoptProfile({ ...next, updatedAt: serverAt, dirty: false });
    return;
  }
  const saved = check(
    await sb
      .from("profiles")
      .upsert({ user_id: userId, display_name: next.displayName, level: progress.level, settings: next.settings, progress })
      .select("updated_at")
      .single(),
  ) as { updated_at: string };
  // Only clear the flag if nothing changed on the device while the request was out.
  if (getState().profile.updatedAt === local.updatedAt) await adoptProfile({ ...next, updatedAt: Date.parse(saved.updated_at), dirty: false });
}

async function pushBooks(sb: SB, userId: string) {
  for (const book of getState().books.filter((b) => b.dirty || !b.textSynced)) {
    let b = book;
    if (b.hasCover && !b.coverPath) {
      const blob = await loadCover(b.id);
      if (blob) {
        const path = `${userId}/${b.id}.jpg`;
        check(await sb.storage.from("covers").upload(path, blob, { upsert: true, contentType: blob.type || "image/jpeg" }));
        b = { ...b, coverPath: path };
      }
    }
    if (b.source === "photo" && !b.coverPath) continue; // the schema needs a cover for photographed books
    if (b.dirty || b.coverPath !== book.coverPath) check(await sb.from("books").upsert(bookToRow(b, userId)));
    if (!b.textSynced && !b.textRemote) await pushText(sb, userId, b.id);
    const current = getState().books.find((x) => x.id === b.id);
    // Leave it marked if the reader changed it while this was uploading.
    if (current && current.updatedAt === book.updatedAt) await saveBook({ ...current, coverPath: b.coverPath, dirty: false, textSynced: true }, { sync: false, touch: false });
  }
}

async function pushText(sb: SB, userId: string, bookId: string) {
  const text = await db.get<BookText>("texts", bookId);
  if (!text) return;
  check(await sb.from("paragraphs").delete().eq("book_id", bookId));
  const rows = text.paragraphs.map((p, ord) => ({
    user_id: userId, book_id: bookId, ord, page_number: p.pageNumber, text: p.text.slice(0, 20000), tokens: p.tokens, countable: p.countable,
  }));
  for (let i = 0; i < rows.length; i += 250) check(await sb.from("paragraphs").insert(rows.slice(i, i + 250)));
}

async function pushSessions(sb: SB, userId: string) {
  const outbox = (await db.get<SessionRow[]>("kv", "sessionOutbox")) ?? [];
  if (!outbox.length) return;
  const known = new Set(getState().books.map((b) => b.id));
  const rows = outbox.map((r) => ({ ...r, user_id: userId, book_id: r.book_id && known.has(r.book_id) ? r.book_id : null }));
  check(await sb.from("reading_sessions").upsert(rows, { onConflict: "id", ignoreDuplicates: true }));
  const now = (await db.get<SessionRow[]>("kv", "sessionOutbox")) ?? [];
  await db.put("kv", now.slice(outbox.length), "sessionOutbox");
}

async function pushWordDeltas(sb: SB) {
  const deltas = (await db.get<Record<string, WordDelta>>("kv", "wordDeltas")) ?? {};
  const entries = Object.entries(deltas);
  if (!entries.length) return;
  const sent: string[] = [];
  for (let i = 0; i < entries.length; i += 8) {
    await Promise.all(
      entries.slice(i, i + 8).map(async ([lemma, d]) => {
        check(
          await sb.rpc("add_word_stats", {
            p_lemma: lemma.slice(0, 80), p_reveals: d.reveals, p_encounters: d.encounters,
            p_last_revealed: d.lastRevealed ? new Date(d.lastRevealed).toISOString() : null, p_example: d.example,
          }),
        );
        sent.push(lemma);
      }),
    );
  }
  // Deltas added during the upload stay for the next round.
  const latest = (await db.get<Record<string, WordDelta>>("kv", "wordDeltas")) ?? {};
  for (const lemma of sent) {
    const was = deltas[lemma], now = latest[lemma];
    if (now && was && now.reveals === was.reveals && now.encounters === was.encounters) delete latest[lemma];
    else if (now && was) latest[lemma] = { ...now, reveals: now.reveals - was.reveals, encounters: now.encounters - was.encounters };
  }
  await db.put("kv", latest, "wordDeltas");
}

async function pushCards(sb: SB, userId: string) {
  const dirty = Object.values(getState().cards).filter((c) => c.dirty);
  if (!dirty.length) return;
  const rows = dirty.map((c) => ({
    user_id: userId, lemma: c.lemma, due: new Date(c.due).toISOString(), stability: c.stability, difficulty: c.difficulty,
    reps: c.reps, lapses: c.lapses, state: c.state, last_review: c.lastReview ? new Date(c.lastReview).toISOString() : null,
  }));
  for (let i = 0; i < rows.length; i += 500) check(await sb.from("cards").upsert(rows.slice(i, i + 500), { onConflict: "user_id,lemma" }));
  const cards = { ...getState().cards };
  for (const c of dirty) if (cards[c.lemma]?.updatedAt === c.updatedAt) cards[c.lemma] = { ...cards[c.lemma], dirty: false };
  await setCards(cards);
}

async function pullBooks(sb: SB, since: number) {
  const all = check(await sb.from("books").select("id")) as Array<{ id: string }>;
  const onServer = new Set(all.map((r) => r.id));
  // Removed on another device: forget it here too (only books this device has already synced).
  for (const b of getState().books)
    if (!b.dirty && b.textSynced && !onServer.has(b.id)) {
      await Promise.all([db.del("books", b.id), db.del("texts", b.id), db.del("blobs", `cover:${b.id}`)]);
      setState({ books: getState().books.filter((x) => x.id !== b.id) });
    }
  const rows = check(await sb.from("books").select("*").gt("updated_at", new Date(since).toISOString())) as BookRow[];
  for (const r of rows) {
    const local = getState().books.find((b) => b.id === r.id) ?? null;
    if (!serverWins(local, Date.parse(r.updated_at!))) continue;
    const hasText = Boolean(await db.get("texts", r.id));
    let book = rowToBook(r, local, hasText);
    if (book.coverPath && !book.hasCover) {
      const { data } = await sb.storage.from("covers").download(book.coverPath);
      if (data) {
        await saveCover(book.id, data);
        book = { ...book, hasCover: true };
      }
    }
    await adoptBook(book);
  }
}

/** Paragraphs of a book that came from another device, fetched when it's first opened. */
export async function fetchRemoteText(bookId: string): Promise<BookText | null> {
  if (!supabase) return null;
  const paragraphs: Paragraph[] = [];
  for (let from = 0; ; from += 1000) {
    const rows = check(
      await supabase.from("paragraphs").select("ord, page_number, text, tokens, countable").eq("book_id", bookId).order("ord").range(from, from + 999),
    ) as Array<{ page_number: number | null; text: string; tokens: Paragraph["tokens"]; countable: number }>;
    paragraphs.push(...rows.map((r) => ({ text: r.text, tokens: r.tokens, countable: r.countable, pageNumber: r.page_number })));
    if (rows.length < 1000) break;
  }
  if (!paragraphs.length) return null;
  const text = { bookId, paragraphs };
  await db.put("texts", text);
  const b = getState().books.find((x) => x.id === bookId);
  if (b) await adoptBook({ ...b, textRemote: false, paragraphCount: paragraphs.length });
  return text;
}

async function pullWords(sb: SB) {
  const rows: WordStatRow[] = [];
  for (let from = 0; ; from += 1000) {
    const page = check(await sb.from("word_stats").select("lemma, reveals, encounters, first_seen, last_revealed, example").range(from, from + 999)) as WordStatRow[];
    rows.push(...page);
    if (page.length < 1000) break;
  }
  const pending = (await db.get<Record<string, WordDelta>>("kv", "wordDeltas")) ?? {};
  await setWordbook(wordbookFrom(rows, pending));
  const examples = { ...getState().examples };
  let added = false;
  for (const r of rows) if (r.example && !examples[r.lemma]) (examples[r.lemma] = r.example), (added = true);
  if (added) {
    setState({ examples });
    await db.put("kv", examples, "examples");
  }
}

async function pullCards(sb: SB, since: number) {
  const rows = check(await sb.from("cards").select("*").gt("updated_at", new Date(since).toISOString())) as Array<Parameters<typeof fromRow>[0]>;
  if (!rows.length) return;
  const cards: Record<string, CardState> = { ...getState().cards };
  for (const r of rows) {
    const remote = fromRow(r);
    const local = cards[r.lemma];
    if (!local || !local.dirty || remote.updatedAt > local.updatedAt) cards[r.lemma] = remote;
  }
  await setCards(cards);
}

// ---------------------------------------------------------------- sign-in

/**
 * Watch the sign-in state. When a different account signs in on this device, the previous account's books are
 * removed from the device first, so nobody's reading ends up in someone else's account.
 */
export function startAuth(): void {
  if (!supabase) return;
  setState({ sync: { status: "idle", lastAt: null, error: null } });
  supabase.auth.onAuthStateChange((event, session) => {
    const u = session?.user ?? null;
    const before = getState().user;
    setState({ user: u ? { id: u.id, email: u.email ?? null } : null });
    if (!u) return;
    if (event === "SIGNED_IN" || event === "INITIAL_SESSION") {
      void (async () => {
        const owner = await db.get<string>("kv", "owner");
        if (owner && owner !== u.id) {
          await wipeDevice();
          await init();
          setState({ user: { id: u.id, email: u.email ?? null } });
        }
        if (!before || before.id !== u.id) await syncNow();
      })();
    }
  });
  window.addEventListener("boekenwurm:changed", () => scheduleSync());
  window.addEventListener("online", () => scheduleSync(500));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") scheduleSync(500);
  });
}

export async function sendSignInEmail(email: string, redirectTo: string): Promise<void> {
  if (!supabase) throw new Error("Sign-in isn't set up in this build.");
  check(await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo, shouldCreateUser: true } }));
}

/** The 6-digit code from the same email: the way in for an app added to the home screen on iOS. */
export async function verifyCode(email: string, code: string): Promise<void> {
  if (!supabase) throw new Error("Sign-in isn't set up in this build.");
  check(await supabase.auth.verifyOtp({ email, token: code.trim(), type: "email" }));
}

export async function signOut(removeBooks: boolean): Promise<void> {
  if (supabase) await supabase.auth.signOut();
  if (removeBooks) {
    await wipeDevice();
    await init();
  }
  setState({ user: null });
}
