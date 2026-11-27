/**
 * The app gate's cards (docs/APP_GATE.md): a round of up to five, between two paragraphs.
 *
 * - Boekenwurm's own flashcards (the reader's words): flip, then Hard, Medium, Easy or Skip, exactly as in Study →
 *   Review; the answers count towards the day's reviews and sync like any review. No XP at the gate.
 * - The reader's own cards (any subject, kept on this device): multiple choice when their deck has at least three other
 *   answers (and the setting is on), otherwise a flashcard. Multiple choice: keep choosing until right; right first
 *   time is Easy, one miss Medium, more Hard (decks.ts).
 */
import { useMemo, useState } from "react";
import type * as E from "@boekenwurm/engine";
import { getState, planReviewSet, reviewCard, useStore } from "../lib/store.ts";
import { meaningOf } from "../lib/words.ts";
import * as D from "./decks.ts";
import { CARDS_PER_ROUND } from "./rules.ts";
import { answerMyCard, getGate } from "./state.ts";

export type RoundItem = { kind: "word"; lemma: string } | { kind: "mine"; id: string };

const itemKey = (i: RoundItem) => (i.kind === "word" ? `w:${i.lemma}` : `m:${i.id}`);

/**
 * The next round: Boekenwurm's due words and the reader's own due cards, taking turns, leaving out what this gate
 * visit has already shown. Empty when nothing is due.
 */
export function planRound(sources: { reviews: boolean; myCards: boolean }, shown: ReadonlySet<string>, now = Date.now()): RoundItem[] {
  const words: RoundItem[] = sources.reviews ? planReviewSet().lemmas.map((lemma) => ({ kind: "word" as const, lemma })).filter((i) => !shown.has(itemKey(i))) : [];
  const mine: RoundItem[] = sources.myCards ? D.dueCards(getGate().cards, now).map((c) => ({ kind: "mine" as const, id: c.id })).filter((i) => !shown.has(itemKey(i))) : [];
  const out: RoundItem[] = [];
  while (out.length < CARDS_PER_ROUND && (words.length || mine.length)) {
    const take = (out.length % 2 === 0 ? words : mine).shift() ?? (words.shift() ?? mine.shift());
    if (take) out.push(take);
  }
  return out;
}

export { itemKey };

export function GateCards({ items, seed, onDone }: { items: RoundItem[]; seed: number; onDone: () => void }) {
  const [i, setI] = useState(0);
  const item = items[i];
  const next = () => (i + 1 >= items.length ? onDone() : setI(i + 1));
  if (!item) return null;
  return (
    <section className="gate-cards" aria-label="Cards">
      <p className="small muted gate-count">Card {i + 1} of {items.length}</p>
      {item.kind === "word" ? <WordCard key={itemKey(item)} lemma={item.lemma} onAnswered={next} /> : <MyCard key={itemKey(item)} id={item.id} seed={seed} onAnswered={next} />}
    </section>
  );
}

const GRADES: Array<{ a: E.Answer; label: string; cls: string }> = [
  { a: "hard", label: "Hard", cls: "danger" },
  { a: "medium", label: "Medium", cls: "" },
  { a: "easy", label: "Easy", cls: "primary" },
];

function WordCard({ lemma, onAnswered }: { lemma: string; onAnswered: () => void }) {
  const [flipped, setFlipped] = useState(false);
  const meanings = useStore((s) => s.meanings);
  const example = useStore((s) => s.examples[lemma]);
  const isNew = !getState().cards[lemma];
  const answer = (a: E.Answer) => void reviewCard(lemma, a, { inSet: true }).then(onAnswered);
  const m = meaningOf(lemma, meanings);
  return (
    <>
      <div className="flash">
        {isNew && <span className="chip" style={{ justifySelf: "center" }}>New word</span>}
        <div className="front" lang="nl">{lemma}</div>
        {example && <div className="ctxline" lang="nl">{example}</div>}
        {flipped && (
          <div className="answer">
            {!m ? <span className="muted">No meaning saved for this word yet.</span> : (
              <>
                {m.article && <span className="muted">{m.article} </span>}
                {m.en && <div>{m.en}</div>}
                {m.nl && <div lang="nl" style={{ fontStyle: "italic", color: "var(--muted)" }}>{m.nl}</div>}
              </>
            )}
          </div>
        )}
      </div>
      {flipped ? (
        <>
          <div className="grades three">
            {GRADES.map(({ a, label, cls }) => <button key={a} className={`btn ${cls}`} type="button" onClick={() => answer(a)}>{label}</button>)}
          </div>
          <button className="btn small ghost" type="button" style={{ justifySelf: "center" }} onClick={() => answer("skip")}>Skip this word</button>
        </>
      ) : (
        <button className="btn primary block" type="button" onClick={() => setFlipped(true)}>Show the meaning</button>
      )}
    </>
  );
}

function MyCard({ id, seed, onAnswered }: { id: string; seed: number; onAnswered: () => void }) {
  const card = getGate().cards.find((c) => c.id === id);
  const deckName = getGate().decks.find((d) => d.id === card?.deck)?.name;
  const mc = useMemo(
    () => (card && getGate().settings.multipleChoice ? D.choices(card, getGate().cards, D.seeded(D.hashString(`${card.id}:${seed}`))) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [card?.id, seed], // fixed for the card's turn: a save elsewhere mustn't reshuffle the options
  );
  const [flipped, setFlipped] = useState(false);
  const [wrong, setWrong] = useState<number[]>([]);
  const [right, setRight] = useState(false);
  if (!card) return <button className="btn primary block" type="button" onClick={onAnswered}>Next</button>;
  const answer = (a: E.Answer) => void answerMyCard(card.id, a).then(onAnswered);

  return (
    <>
      <div className="flash">
        {deckName && <span className="chip" style={{ justifySelf: "center" }}>{deckName}</span>}
        <div className="front gate-front">{card.front}</div>
        {!mc && flipped && <div className="answer">{card.back}</div>}
      </div>
      {mc ? (
        <>
          <div className="gate-choices" role="group" aria-label="Choose the answer">
            {mc.options.map((o, k) => (
              <button key={k} type="button" disabled={right || wrong.includes(k)}
                className={`btn block ${right && k === mc.correct ? "primary" : wrong.includes(k) ? "danger" : ""}`}
                onClick={() => (k === mc.correct ? setRight(true) : setWrong((w) => [...w, k]))}>{o}</button>
            ))}
          </div>
          {right && <button className="btn primary block" type="button" onClick={() => answer(D.choiceAnswer(wrong.length))}>Next</button>}
        </>
      ) : flipped ? (
        <>
          <div className="grades three">
            {GRADES.map(({ a, label, cls }) => <button key={a} className={`btn ${cls}`} type="button" onClick={() => answer(a)}>{label}</button>)}
          </div>
          <button className="btn small ghost" type="button" style={{ justifySelf: "center" }} onClick={() => answer("skip")}>Skip this card</button>
        </>
      ) : (
        <button className="btn primary block" type="button" onClick={() => setFlipped(true)}>Show the answer</button>
      )}
    </>
  );
}
