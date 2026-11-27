// The reader's own cards for the app gate (src/gate/decks.ts). Removed with the gate by scripts/remove-app-gate.sh.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as D from "../../src/gate/decks.ts";

let n = 0;
const id = () => `c${++n}`;

test("pasted cards: tab (Quizlet), dash, semicolon or comma; header and half lines left out", () => {
  const text = [
    "term\tdefinition",
    "de hond\tthe dog",
    "het huis - the house",
    "lopen – to walk",
    "zeggen;to say",
    "Paris, capital of France, on the Seine",
    "only a front",
    "",
    "\tno front",
  ].join("\n");
  assert.deepEqual(D.parseCards(text), [
    { front: "de hond", back: "the dog" },
    { front: "het huis", back: "the house" },
    { front: "lopen", back: "to walk" },
    { front: "zeggen", back: "to say" },
    { front: "Paris", back: "capital of France, on the Seine" },
  ]);
});

test("pasted cards: a hyphen inside a word is not a separator; long sides are cut to 500 characters", () => {
  assert.deepEqual(D.parseCards("e-mail\tan email"), [{ front: "e-mail", back: "an email" }]);
  assert.deepEqual(D.parseCards("e-mail;post"), [{ front: "e-mail", back: "post" }]);
  const [c] = D.parseCards(`a\t${"x".repeat(900)}`);
  assert.equal(c.back.length, 500);
  assert.equal(D.parseCards(Array.from({ length: 2500 }, (_, i) => `w${i}\tm${i}`).join("\n")).length, 2000);
});

test("adding cards leaves out ones already in the deck (ignoring capitals)", () => {
  const first = D.addCards([], "d1", [{ front: "Hond", back: "Dog" }, { front: "kat", back: "cat" }, { front: "hond", back: "dog" }], 1000, id);
  assert.equal(first.length, 2);
  assert.equal(first[0].review.lemma, first[0].id);
  assert.equal(first[0].review.pool, "medium");
  const again = D.addCards(first, "d1", [{ front: "kat", back: "CAT" }, { front: "muis", back: "mouse" }], 2000, id);
  assert.deepEqual(again.map((c) => c.front), ["muis"]);
  // Another deck may hold the same card.
  assert.equal(D.addCards(first, "d2", [{ front: "kat", back: "cat" }], 2000, id).length, 1);
});

test("due cards follow Boekenwurm's review order: Hard, then Medium, then Easy check-backs that are due", () => {
  const DAY = 86_400_000;
  let cards = D.addCards([], "d", [{ front: "a", back: "1" }, { front: "b", back: "2" }, { front: "c", back: "3" }], 0, id);
  cards = [D.answerCard(cards[0], "easy", 0), D.answerCard(cards[1], "hard", 0), cards[2]];
  assert.deepEqual(D.dueCards(cards, DAY).map((c) => c.front), ["b", "c"]);
  // Easy comes back after 3 days.
  assert.deepEqual(D.dueCards(cards, 3 * DAY).map((c) => c.front), ["b", "c", "a"]);
  // Skipped never comes back.
  cards = [D.answerCard(cards[0], "skip", 0), cards[1], cards[2]];
  assert.deepEqual(D.dueCards(cards, 100 * DAY).map((c) => c.front), ["b", "c"]);
});

test("multiple choice: the answer and three other answers from the deck, in a seeded order", () => {
  const deck = D.addCards([], "d", ["one", "two", "three", "four", "five"].map((b, i) => ({ front: `q${i}`, back: b })), 0, id);
  const a = D.choices(deck[0], deck, D.seeded(42))!;
  const b = D.choices(deck[0], deck, D.seeded(42))!;
  assert.deepEqual(a, b);
  assert.equal(a.options.length, 4);
  assert.equal(a.options[a.correct], "one");
  assert.equal(new Set(a.options).size, 4);
  // Fewer than three other answers (duplicates and other decks don't count): a flashcard instead.
  const small = D.addCards([], "s", [{ front: "x", back: "A" }, { front: "y", back: "a" }, { front: "z", back: "B" }, { front: "w", back: "b" }], 0, id);
  assert.equal(D.choices(small[0], [...small, ...deck], D.seeded(1)), null);
});

test("a multiple-choice card's answer: right first time Easy, one miss Medium, more Hard", () => {
  assert.equal(D.choiceAnswer(0), "easy");
  assert.equal(D.choiceAnswer(1), "medium");
  assert.equal(D.choiceAnswer(2), "hard");
  assert.equal(D.choiceAnswer(3), "hard");
});

test("seeded random is in [0, 1) and repeatable", () => {
  const r = D.seeded(D.hashString("card:1"));
  const xs = Array.from({ length: 1000 }, r);
  assert.ok(xs.every((x) => x >= 0 && x < 1));
  assert.deepEqual(Array.from({ length: 5 }, D.seeded(D.hashString("card:1"))), xs.slice(0, 5));
});
