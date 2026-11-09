// Sync rules: last write wins per row, and nothing earned is ever lost.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Progress } from "@boekenwurm/engine";
import { bookToRow, mergeProgress, rowToBook, serverWins, wordbookFrom } from "../src/lib/merge.ts";
import type { Book } from "../src/lib/types.ts";

const tok = (id: string, at: number) => ({ sessionId: id, at, level: "A2" as const, streak: 10 });
const prog = (p: Partial<Progress>): Progress => ({ level: "A2", tokens: [], history: [], offer: null, badges: [{ level: "A2", at: 100, source: "start" }], ...p });

test("a new account takes the device's progress", () => {
  const local = prog({ tokens: [tok("a", 5)], history: [tok("a", 5)] });
  assert.deepEqual(mergeProgress(local, 10, null, 0), local);
});

test("the newer side decides the level, but tokens and badges from both sides are kept", () => {
  const phone = prog({ level: "A2", tokens: [tok("p1", 50)], history: [tok("p1", 50)] });
  const laptop = prog({
    level: "B1", tokens: [], history: [tok("l1", 20), tok("l2", 30), tok("l3", 40)],
    badges: [{ level: "A2", at: 100, source: "start" }, { level: "B1", at: 45, source: "level-up" }],
  });
  const m = mergeProgress(phone, 60, laptop, 70);
  assert.equal(m.level, "B1");
  assert.deepEqual(m.history.map((t) => t.sessionId), ["l1", "l2", "l3", "p1"]);
  assert.deepEqual(m.badges.map((b) => b.level).sort(), ["A2", "B1"]);
});

test("a badge earned in play beats the same badge given by placement", () => {
  const a = prog({ badges: [{ level: "A2", at: 100, source: "placement" }] });
  const b = prog({ badges: [{ level: "A2", at: 200, source: "level-up" }] });
  assert.equal(mergeProgress(a, 1, b, 2).badges[0].source, "level-up");
});

const book = (p: Partial<Book> = {}): Book => ({
  id: "b1", source: "epub", title: "Testboek", author: null, isbn: null, level: "A2", levelSource: "reader", scan: null, status: "ready",
  pageCount: null, pagesRead: [], position: { ord: 4, mode: "original" }, paragraphCount: 40, coverPath: null, hasCover: true,
  createdAt: 1000, updatedAt: 2000, dirty: false, textSynced: true, textRemote: false, nextSeq: 0, ...p,
});

test("unsynced changes on the device beat an older server copy", () => {
  assert.equal(serverWins(book({ dirty: true, updatedAt: 3000 }), 2500), false);
  assert.equal(serverWins(book({ dirty: true, updatedAt: 2000 }), 2500), true);
  assert.equal(serverWins(book({ dirty: false, updatedAt: 3000 }), 2500), true);
  assert.equal(serverWins(null, 1), true);
});

test("a book survives the trip to the server and back", () => {
  const b = book({ position: { ord: 7, mode: "match" }, nextSeq: 3 });
  const row = { ...bookToRow(b, "u1"), updated_at: new Date(5000).toISOString() };
  const back = rowToBook(row, b, true);
  assert.equal(back.position.ord, 7);
  assert.equal(back.position.mode, "match");
  assert.equal(back.paragraphCount, 40);
  assert.equal(back.nextSeq, 3);
  assert.equal(back.hasCover, true);
  assert.equal(back.textRemote, false);
  // On a device that doesn't have the text yet, it is fetched when opened.
  assert.equal(rowToBook(row, null, false).textRemote, true);
});

test("word counts are the server's totals plus what this device hasn't sent", () => {
  const wb = wordbookFrom(
    [{ lemma: "lopen", reveals: 3, encounters: 10, first_seen: null, last_revealed: null, example: null }],
    { lopen: { reveals: 1, encounters: 2, lastRevealed: 99, example: null }, kaas: { reveals: 1, encounters: 1, lastRevealed: 50, example: null } },
  );
  assert.equal(wb.lopen.reveals, 4);
  assert.equal(wb.lopen.encounters, 12);
  assert.equal(wb.kaas.reveals, 1);
});
