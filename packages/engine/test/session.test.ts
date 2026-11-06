import { test } from "node:test";
import assert from "node:assert/strict";
import { rulesFor } from "../src/checkpoint.ts";
import { beginParagraph, reveal, startSession, status, turnPage, undoReveal, type Session } from "../src/session.ts";
import { applySession, notSticking, studyList } from "../src/words.ts";
import { definitionLanguage } from "../src/definitions.ts";

const words = (n: number, prefix = "w") => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

function play(s: Session, id: string, lemmas: string[], revealLemmas: string[], at = 1000) {
  s = beginParagraph(s, id, lemmas);
  for (const l of revealLemmas) s = reveal(s, { lemma: l, surface: l, at });
  return turnPage(s);
}

test("a streak builds, tightens, then a failure ends the session with its length", () => {
  let s = startSession(rulesFor("standard"));
  const lemmas = words(40); // 25% -> 10 allowed
  let out = play(s, "p1", lemmas, words(10));
  assert.equal(out.kind, "continue");
  out = play(out.session, "p2", lemmas, words(2));
  assert.equal(out.kind, "continue");

  s = beginParagraph(out.session, "p3", lemmas);
  assert.deepEqual(status(s), { allowed: 8, percent: 22, used: 0, streak: 2 }); // floor(40 * 22%) = 8
  out = play(out.session, "p3", lemmas, words(8));
  assert.equal(out.kind, "continue");

  out = play(out.session, "p4", lemmas, words(8)); // 19% of 40 = 7 allowed -> fail
  assert.equal(out.kind, "ended");
  if (out.kind !== "ended") return;
  assert.equal(out.streakLength, 3);
  assert.equal(out.session.ended, true);
  assert.throws(() => beginParagraph(out.session, "p5", lemmas));
});

test("a new session starts back at the base percentage", () => {
  const rules = rulesFor("standard");
  let s = startSession(rules);
  for (const id of ["a", "b", "c", "d"]) s = (play(s, id, words(40), []) as { session: Session }).session;
  assert.equal(beginParagraph(s, "e", words(40)).current!.allowance.percent, 16);
  assert.equal(beginParagraph(startSession(rules), "x", words(40)).current!.allowance.percent, 25);
});

test("tapping the same word twice in a paragraph counts once", () => {
  let s = beginParagraph(startSession(rulesFor("strict")), "p", words(10)); // 3 strikes
  for (let i = 0; i < 5; i++) s = reveal(s, { lemma: "lopen", surface: i % 2 ? "liep" : "loopt", at: i });
  assert.equal(status(s).used, 1);
});

test("a mis-tap can be undone within 5 seconds, not after", () => {
  let s = beginParagraph(startSession(rulesFor("standard")), "p", words(10));
  s = reveal(s, { lemma: "fiets", surface: "fiets", at: 10_000 });
  assert.equal(status(undoReveal(s, "fiets", 14_000)).used, 0);
  assert.equal(status(undoReveal(s, "fiets", 16_000)).used, 1);
});

test("the end-of-session study list puts the words revealed most over time first", () => {
  const rules = rulesFor("strict");
  let book = {};
  // earlier session: "eigenlijk" revealed twice in two paragraphs
  let s = startSession(rules);
  s = (play(s, "a", ["eigenlijk", "huis", "fiets"], ["eigenlijk"]) as { session: Session }).session;
  s = (play(s, "b", ["eigenlijk", "huis"], ["eigenlijk"]) as { session: Session }).session;
  book = applySession(book, s, 1);

  // today: fail with 4 reveals in a short paragraph (3 strikes)
  const out = play(startSession(rules), "c", ["eigenlijk", "gezellig", "boodschappen", "zelfs", "huis"], [
    "gezellig", "eigenlijk", "boodschappen", "zelfs",
  ]);
  assert.equal(out.kind, "ended");
  book = applySession(book, out.session, 2);
  const list = studyList(out.session, book);
  assert.equal(list[0].lemma, "eigenlijk");
  assert.equal(list[0].lifetimeReveals, 3);
  assert.equal(list.length, 4);
});

test("not-sticking: often met and usually revealed", () => {
  const book = {
    zelfs: { lemma: "zelfs", reveals: 9, encounters: 10, firstSeen: 0, lastRevealed: 0 },
    huis: { lemma: "huis", reveals: 3, encounters: 40, firstSeen: 0, lastRevealed: 0 },
    nieuw: { lemma: "nieuw", reveals: 2, encounters: 2, firstSeen: 0, lastRevealed: 0 },
  };
  assert.deepEqual(notSticking(book).map((w) => w.lemma), ["zelfs"]);
});

test("definitions: Dutch at B1+, Dutch on a streak, otherwise the reader's choice", () => {
  assert.equal(definitionLanguage({ level: "A2", onStreak: false }), "en");
  assert.equal(definitionLanguage({ level: "A2", onStreak: true }), "nl");
  assert.equal(definitionLanguage({ level: "B1", preference: "en", onStreak: false }), "nl");
  assert.equal(definitionLanguage({ level: "A1", preference: "nl", onStreak: false }), "nl");
});
