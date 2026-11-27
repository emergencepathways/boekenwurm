/**
 * The daily reading goal (engine goal.ts): the reader sets pages a day in Account → Reading, for example to match
 * Poortwachter's "5 pages at or above my level", and Boekenwurm shows today's progress on Home and says when it's
 * reached. What was read today is kept on this device only ("goalLog" in the key-value store) and never synced; the
 * goal itself is a setting, synced like the others.
 */
import * as E from "@boekenwurm/engine";
import { db } from "./db.ts";
import { getState, setState } from "./store.ts";
import { localDay } from "./usage.ts";
import type { Book } from "./types.ts";

interface Log {
  day: string;
  reads: E.PageRead[];
  /** The day the "goal reached" message was shown, so it's shown once. */
  announced?: string;
}

const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const localDate = (t: number) => localDay(new Date(t), timeZone());

export function goalOf(): E.ReadingGoal {
  return { ...E.NO_GOAL, ...(getState().profile.settings.readingGoal ?? {}) };
}

const dayNow = (goal = goalOf()) => E.goalDay(Date.now(), goal, localDate);

async function load(): Promise<Log> {
  const log = (await db.get<Log>("kv", "goalLog")) ?? { day: "", reads: [] };
  const day = dayNow();
  return log.day === day ? log : { day, reads: [], announced: log.announced };
}

/** Today's progress toward the goal, into the store (Home shows it). Null when no goal is set. */
export async function refreshGoal(): Promise<E.GoalProgress | null> {
  const p = E.goalProgress((await load()).reads, goalOf());
  setState({ goal: p });
  return p;
}

/**
 * After a session is recorded: add its paragraphs (paragraph ids are "p<ord>") and say whether the goal was reached
 * just now. `atLevel`: the text read was at or above the reader's rank then.
 */
export async function noteRead(book: Book, paragraphIds: string[], atLevel: boolean): Promise<{ progress: E.GoalProgress | null; justReached: boolean }> {
  const goal = goalOf();
  const log = await load();
  const text = await db.get<{ paragraphs: Array<{ pageNumber: number | null; countable: number }> }>("texts", book.id);
  for (const id of paragraphIds) {
    const m = /^p(\d+)$/.exec(id);
    const para = m ? text?.paragraphs[Number(m[1])] : undefined;
    if (!m || !para) continue;
    log.reads.push({ key: `${book.id}:${m[1]}`, book: book.id, page: para.pageNumber, countable: para.countable, atLevel });
  }
  const progress = E.goalProgress(log.reads, goal);
  const justReached = !!progress?.reached && log.announced !== log.day;
  if (justReached) log.announced = log.day;
  await db.put("kv", log, "goalLog");
  setState({ goal: progress });
  return { progress, justReached };
}
