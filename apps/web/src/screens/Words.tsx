/**
 * The Words tab: the reader's word lists and how far along each one is. The common Dutch words (500, 1,000, 2,000
 * and 5,000) come from the open dictionary in one tap; the reader's own lists are imported (lib/importlist.ts).
 * Each word shows where it stands (docs/DESIGN.md "Word lists"): not seen yet (faded), seen in reading but never
 * tapped (dotted), tapped (coloured by recent taps and review rating, like the colour-coded text), and learned (✓).
 */
import { useEffect, useMemo, useState } from "react";
import * as E from "@boekenwurm/engine";
import { addToReview, dueCards, getState, onWordList, removeWordList, unskipCard, updateProfile, useStore, type WordListInfo } from "../lib/store.ts";
import { commonWords, meaningOf, wordLists } from "../lib/words.ts";
import { checkAchievements } from "../lib/play.ts";
import { open } from "../nav.ts";
import { plural, Sheet, toast } from "../ui.tsx";

type Filter = "all" | "work" | "unseen" | "seen" | "learned";
const FILTERS: Array<[Filter, string]> = [["all", "All"], ["work", "Needs work"], ["seen", "Seen, never tapped"], ["unseen", "Not seen yet"], ["learned", "Learned"]];
const PAGE = 300;
const SOURCE: Record<WordListInfo["source"], string> = { textbook: "Textbook", paste: "Pasted", text: "Text file", csv: "CSV", excel: "Excel", anki: "Anki deck" };
const fmt = (n: number) => n.toLocaleString("en-US");

/** A list picked in the tab: one of the common-words sizes, or an imported list. */
type Pick = { kind: "common"; size: number } | { kind: "list"; id: string };

export function Words() {
  const common = useStore((s) => s.profile.settings.commonWords === true);
  const lists = useStore((s) => s.wordLists);
  const dictionary = useStore((s) => s.dictionary);
  const wordbook = useStore((s) => s.wordbook);
  const cards = useStore((s) => s.cards);
  const [pick, setPick] = useState<Pick | null>(null);
  const [remove, setRemove] = useState<WordListInfo | null>(null);

  useEffect(() => void checkAchievements(), []); // a word may have turned learned since (Easy for 2 weeks)

  // Every word's standing, once per change to the word book or the cards.
  const status = useMemo(() => {
    const at = Date.now();
    const memo = new Map<string, E.ListWordStatus>();
    return (w: string) => {
      let s = memo.get(w);
      if (!s) memo.set(w, (s = E.listWordStatus(wordbook[w], cards[w], at)));
      return s;
    };
  }, [wordbook, cards]);

  const commonList = dictionary ? commonWords() : [];
  // 500, 1,000, 2,000 and 5,000; a smaller dictionary (a test build) shows all its words as one list.
  const sizes = E.COMMON_LIST_SIZES.filter((n) => n <= commonList.length);
  if (!sizes.length && commonList.length) sizes.push(commonList.length);
  const current: Pick | null = pick ?? (common && sizes.length ? { kind: "common", size: sizes[0] } : lists[0] ? { kind: "list", id: lists[0].id } : null);
  const words = (p: Pick): readonly string[] =>
    p.kind === "common" ? commonList.slice(0, p.size) : Object.keys(wordLists().find((l) => (l.id ?? "textbook") === p.id)?.entries ?? {});
  const listDue = dueCards().filter((c) => (c.pool === "hard" || c.pool === "medium") && onWordList(c.lemma)).length;
  const empty = !lists.length && !common;

  return (
    <main className="screen words">
      <div className="topbar"><h1>Words</h1></div>

      {empty ? (
        <EmptyLists />
      ) : (
        <>
          {listDue > 0 && (
            <button className="studycard" type="button" onClick={() => open({ name: "study-session" })}>
              <span className="big">{listDue}</span>
              <span className="grow">
                <b>Review your list words</b>
                <span className="small muted">{plural(listDue, "word")} from your lists rated Hard or Medium. They come first in every review.</span>
              </span>
            </button>
          )}

          {common && (
            <section className="panel">
              <div className="listhead">
                <h2>Common Dutch words</h2>
                <button className="btn small ghost" type="button" onClick={() => void setCommon(false)}>Remove</button>
              </div>
              {commonList.length ? (
                <div className="tiers">
                  {sizes.map((n) => (
                    <ListRow key={n} title={`The ${fmt(n)} most common`} words={commonList.slice(0, n)} status={status}
                      selected={current?.kind === "common" && current.size === n} onClick={() => setPick({ kind: "common", size: n })} />
                  ))}
                </div>
              ) : (
                <p>{dictionary === undefined ? "Loading the dictionary…" : "The dictionary isn't available in this build, so the common words can't be shown."}</p>
              )}
            </section>
          )}

          {lists.length > 0 && (
            <section className="panel">
              <h2>My lists</h2>
              <div className="tiers">
                {lists.map((l) => (
                  <ListRow key={l.id} title={l.name} detail={`${SOURCE[l.source]} · ${fmt(l.size)} words`} words={words({ kind: "list", id: l.id })} status={status}
                    selected={current?.kind === "list" && current.id === l.id} onClick={() => setPick({ kind: "list", id: l.id })} />
                ))}
              </div>
            </section>
          )}

          <div className="actions">
            <button className="btn" type="button" onClick={() => open({ name: "import-list" })}>Import a list…</button>
            {!common && <button className="btn ghost" type="button" disabled={!dictionary} onClick={() => void setCommon(true)}>Add the 5,000 most common words</button>}
          </div>

          {current && (
            <WordGrid key={JSON.stringify(current)} title={current.kind === "common" ? `The ${fmt(current.size)} most common words` : (lists.find((l) => l.id === current.id)?.name ?? "")}
              words={words(current)} status={status} onRemove={current.kind === "list" ? () => setRemove(lists.find((l) => l.id === current.id) ?? null) : undefined} />
          )}
        </>
      )}

      <p className="note">
        Common words: ranked by how often they appear in real Dutch text (wordfreq, by Robyn Speer and contributors), with meanings from
        Wiktionary; both CC BY-SA 4.0. Lists you import stay on this device and are never shared.
      </p>

      {remove && (
        <Sheet label="Remove list" onClose={() => setRemove(null)}>
          <h2>Remove “{remove.name}”?</h2>
          <p className="muted">The list goes from this device. Your flashcards and reading history stay; import the file again to bring the list back.</p>
          <div className="actions">
            <button className="btn primary" type="button" onClick={() => void removeWordList(remove.id).then(() => (setRemove(null), setPick(null), toast("List removed.")))}>Remove</button>
            <button className="btn ghost" type="button" onClick={() => setRemove(null)}>Keep it</button>
          </div>
        </Sheet>
      )}
    </main>
  );
}

async function setCommon(on: boolean): Promise<void> {
  await updateProfile((p) => ({ ...p, settings: { ...p.settings, commonWords: on } }));
  toast(on ? "Added the 5,000 most common Dutch words." : "Removed the common words list.");
  if (on) void checkAchievements();
}

function EmptyLists() {
  const dictionary = useStore((s) => s.dictionary);
  return (
    <section className="panel firstbook">
      <h2>Add a word list</h2>
      <p>
        Pick the words you want to learn, and Boekenwurm follows them as you read: which ones you've seen, which you tap, and which
        you've learned. Words from your lists that you rate Hard or Medium come first in every review.
      </p>
      <button className="btn primary" type="button" disabled={!dictionary} onClick={() => void setCommon(true)}>Add the 5,000 most common Dutch words</button>
      <p className="small">One tap. You'll see your progress through the 500, 1,000, 2,000 and 5,000 most common words, with a badge for each.</p>
      <button className="btn" type="button" onClick={() => open({ name: "import-list" })}>Import your own list…</button>
      <p className="small">From your course or teacher: paste it, or use a text, CSV or Excel file, or an Anki deck.</p>
    </section>
  );
}

function counts(words: readonly string[], status: (w: string) => E.ListWordStatus) {
  const p = E.listProgress(words, status);
  return { ...p, met: p.seen + p.tapped - p.learned };
}

function ListRow(props: { title: string; detail?: string; words: readonly string[]; status: (w: string) => E.ListWordStatus; selected: boolean; onClick: () => void }) {
  const c = counts(props.words, props.status);
  const pct = (n: number) => `${c.total ? (n / c.total) * 100 : 0}%`;
  return (
    <div className="listrow" aria-current={props.selected ? "true" : undefined}>
      <button type="button" className="pick" onClick={props.onClick}>
        <span className="name">
          <b>{props.title}</b>
          <span className="num small">{fmt(c.learned)} / {fmt(c.total)} learned{c.learned === c.total && c.total ? " ✓" : ""}</span>
        </span>
        <span className="stack3" role="img" aria-label={`${c.learned} learned, ${c.met} seen and still learning, ${c.unseen} not seen yet`}>
          <i className="l" style={{ width: pct(c.learned) }} />
          <i className="m" style={{ width: pct(c.met) }} />
        </span>
        <span className="small muted">{props.detail ? `${props.detail} · ` : ""}{fmt(c.learned + c.met)} seen in reading · {fmt(c.unseen)} not seen yet</span>
      </button>
    </div>
  );
}

function WordGrid({ title, words, status, onRemove }: { title: string; words: readonly string[]; status: (w: string) => E.ListWordStatus; onRemove?: () => void }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [shown, setShown] = useState(PAGE);
  const [word, setWord] = useState<string | null>(null);
  const keep = (w: string) => {
    const s = status(w);
    if (filter === "all") return true;
    if (filter === "work") return !s.learned && (s.colour === "red" || s.colour === "yellow");
    if (filter === "learned") return s.learned;
    return s.state === filter && !s.learned;
  };
  const list = words.filter(keep);
  return (
    <section className="panel">
      <div className="listhead">
        <h2>{title}</h2>
        {onRemove && <button className="btn small ghost" type="button" onClick={onRemove}>Remove list</button>}
      </div>
      <div className="chips" role="group" aria-label="Show">
        {FILTERS.map(([f, label]) => (
          <button key={f} type="button" className="chip" aria-pressed={filter === f} onClick={() => (setFilter(f), setShown(PAGE))}>{label}</button>
        ))}
      </div>
      <div className="legend small" aria-hidden="true">
        <span className="wchip s-unseen">not seen</span>
        <span className="wchip s-seen">seen</span>
        <span className="wchip s-tapped c-green">easy</span>
        <span className="wchip s-tapped c-yellow">medium</span>
        <span className="wchip s-tapped c-red">hard</span>
        <span className="wchip learned">learned</span>
      </div>
      {list.length ? (
        <div className="wgrid" lang="nl">
          {list.slice(0, shown).map((w) => {
            const s = status(w);
            const cls = ["wchip", `s-${s.state}`, s.colour ? `c-${s.colour}` : "", s.learned ? "learned" : "", s.skipped ? "skipped" : ""].filter(Boolean).join(" ");
            return <button key={w} type="button" className={cls} onClick={() => setWord(w)}>{w}</button>;
          })}
        </div>
      ) : (
        <p>No words here yet.</p>
      )}
      {list.length > shown && <button className="btn small ghost" type="button" onClick={() => setShown(shown + PAGE)}>Show more ({fmt(list.length - shown)} left)</button>}
      {word && <WordDetails lemma={word} status={status(word)} onClose={() => setWord(null)} />}
    </section>
  );
}

const POOL_NAME: Record<E.Pool, string> = { hard: "Hard", medium: "Medium", easy: "Easy", skipped: "Skipped" };
const day = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

function WordDetails({ lemma, status, onClose }: { lemma: string; status: E.ListWordStatus; onClose: () => void }) {
  const s = getState();
  const w = s.wordbook[lemma];
  const card = s.cards[lemma];
  const m = meaningOf(lemma, s.meanings);
  const recent = E.keepRecent(w?.recent ?? [], Date.now()).length;
  const untapped = Math.min(w?.untapped ?? 0, E.LEARNED_UNTAPPED_READS);
  const easyDays = card?.pool === "easy" && card.easySince != null ? Math.floor((Date.now() - card.easySince) / 86400000) : 0;
  const tapped = status.state === "tapped";
  return (
    <Sheet label={lemma} onClose={onClose}>
      <h2 lang="nl">{m?.article ? `${m.article} ` : ""}{lemma}{status.learned ? " ✓" : ""}</h2>
      {m?.en && <p>{m.en}</p>}
      <ul className="facts small">
        <li>{w?.encounters ? `Seen in ${plural(w.encounters, "paragraph")}` : "Not seen in your reading yet"}{w?.reveals ? ` · tapped ${plural(w.reveals, "time")}${recent ? ` (${recent} in the last 2 weeks)` : ""}` : w?.encounters ? " · never tapped" : ""}</li>
        <li>Read without tapping: {untapped} of {E.LEARNED_UNTAPPED_READS}{w && (w.untapped ?? 0) > untapped ? "+" : ""}</li>
        {card && <li>Flashcard: {POOL_NAME[card.pool]}{card.pool === "easy" && card.easySince ? ` since ${day(card.easySince)} (${plural(easyDays, "day")} of ${E.LEARNED_EASY_DAYS})` : ""}</li>}
      </ul>
      <p className="small">
        {status.learned
          ? "Learned: read often without a tap" + (tapped ? ", and Easy in review for 2 weeks." : ".")
          : `Learned once you've read it in ${E.LEARNED_UNTAPPED_READS} paragraphs without tapping (unlimited lookup mode doesn't count)${tapped ? ` and its flashcard has stayed Easy for ${E.LEARNED_EASY_DAYS} days` : ""}.`}
      </p>
      <div className="actions">
        {!card && <button className="btn" type="button" onClick={() => void addToReview(lemma).then(() => (toast("Added to your reviews."), onClose()))}>Add to my reviews</button>}
        {card?.pool === "skipped" && <button className="btn" type="button" onClick={() => void unskipCard(lemma).then(() => (toast("Back in your reviews."), onClose()))}>Bring back</button>}
        <button className="btn ghost" type="button" onClick={onClose}>Close</button>
      </div>
    </Sheet>
  );
}
