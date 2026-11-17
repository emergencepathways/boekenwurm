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
import { Sheet, toast } from "../ui.tsx";
import { t, useT } from "../lib/i18n.ts";

type Filter = "all" | "work" | "unseen" | "seen" | "learned";
const FILTERS: readonly Filter[] = ["all", "work", "seen", "unseen", "learned"];
const PAGE = 300;

/** A list picked in the tab: one of the common-words sizes, or an imported list. */
type Pick = { kind: "common"; size: number } | { kind: "list"; id: string };

export function Words() {
  const t = useT();
  const common = useStore((s) => s.profile.settings.commonWords === true);
  const lists = useStore((s) => s.wordLists);
  const dictionary = useStore((s) => s.dictionary);
  const wordbook = useStore((s) => s.wordbook);
  const cards = useStore((s) => s.cards);
  const [pick, setPick] = useState<Pick | null>(null);
  // The word grid starts folded, so the tab fits on one screen; tapping a list (or "Show words") opens it.
  const [expanded, setExpanded] = useState(false);
  const choose = (p: Pick) => {
    setPick(p);
    setExpanded(true);
    setTimeout(() => document.getElementById("wordgrid")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  };
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
      <div className="topbar"><h1>{t("tab.words")}</h1></div>

      {empty ? (
        <EmptyLists />
      ) : (
        <>
          {listDue > 0 && (
            <button className="studycard" type="button" onClick={() => open({ name: "study-session" })}>
              <span className="big">{listDue}</span>
              <span className="grow">
                <b>{t("words.listDue")}</b>
                <span className="small muted">{t("words.listDueText", { n: listDue })}</span>
              </span>
            </button>
          )}

          {common && (
            <section className="panel">
              <div className="listhead">
                <h2>{t("words.common")}</h2>
                <button className="btn small ghost" type="button" onClick={() => void setCommon(false)}>{t("common.remove")}</button>
              </div>
              {commonList.length ? (
                <div className="tiers tiles">
                  {sizes.map((n) => (
                    <ListRow key={n} tile title={t("words.top", { n })} words={commonList.slice(0, n)} status={status}
                      selected={current?.kind === "common" && current.size === n} onClick={() => choose({ kind: "common", size: n })} />
                  ))}
                </div>
              ) : (
                <p>{dictionary === undefined ? t("words.loadingDict") : t("words.noDict")}</p>
              )}
            </section>
          )}

          {lists.length > 0 && (
            <section className="panel">
              <h2>{t("words.myLists")}</h2>
              <div className="tiers">
                {lists.map((l) => (
                  <ListRow key={l.id} title={l.name} detail={t("words.listDetail", { source: t(`words.source.${l.source}`), n: l.size })} words={words({ kind: "list", id: l.id })} status={status}
                    selected={current?.kind === "list" && current.id === l.id} onClick={() => choose({ kind: "list", id: l.id })} />
                ))}
              </div>
            </section>
          )}

          <div className="actions">
            <button className="btn" type="button" onClick={() => open({ name: "import-list" })}>{t("words.import")}</button>
            {!common && <button className="btn ghost" type="button" disabled={!dictionary} onClick={() => void setCommon(true)}>{t("words.addCommon")}</button>}
          </div>

          {current && (
            <WordGrid key={JSON.stringify(current)} title={current.kind === "common" ? t("words.mostCommon", { n: current.size }) : (lists.find((l) => l.id === current.id)?.name ?? "")}
              words={words(current)} status={status} expanded={expanded} onToggle={() => setExpanded(!expanded)} onRemove={current.kind === "list" ? () => setRemove(lists.find((l) => l.id === current.id) ?? null) : undefined} />
          )}
        </>
      )}

      <p className="note">{t("words.credit")}</p>

      {remove && (
        <Sheet label={t("words.removeList")} onClose={() => setRemove(null)}>
          <h2>{t("words.removeAsk", { name: remove.name })}</h2>
          <p className="muted">{t("words.removeText")}</p>
          <div className="actions">
            <button className="btn primary" type="button" onClick={() => void removeWordList(remove.id).then(() => (setRemove(null), setPick(null), toast(t("words.removed"))))}>{t("common.remove")}</button>
            <button className="btn ghost" type="button" onClick={() => setRemove(null)}>{t("book.keep")}</button>
          </div>
        </Sheet>
      )}
    </main>
  );
}

async function setCommon(on: boolean): Promise<void> {
  await updateProfile((p) => ({ ...p, settings: { ...p.settings, commonWords: on } }));
  toast(on ? t("words.commonAdded") : t("words.commonRemoved"));
  if (on) void checkAchievements();
}

function EmptyLists() {
  const t = useT();
  const dictionary = useStore((s) => s.dictionary);
  return (
    <section className="panel firstbook">
      <h2>{t("words.emptyTitle")}</h2>
      <p>{t("words.emptyLead")}</p>
      <button className="btn primary" type="button" disabled={!dictionary} onClick={() => void setCommon(true)}>{t("words.addCommonFull")}</button>
      <p className="small">{t("words.addCommonNote")}</p>
      <button className="btn" type="button" onClick={() => open({ name: "import-list" })}>{t("words.importOwn")}</button>
      <p className="small">{t("words.importOwnNote")}</p>
    </section>
  );
}

function counts(words: readonly string[], status: (w: string) => E.ListWordStatus) {
  const p = E.listProgress(words, status);
  return { ...p, met: p.seen + p.tapped - p.learned };
}

/** A list's progress: a full-width row for an imported list, or a compact tile for each common-words size. */
function ListRow(props: { title: string; detail?: string; tile?: boolean; words: readonly string[]; status: (w: string) => E.ListWordStatus; selected: boolean; onClick: () => void }) {
  const t = useT();
  const c = counts(props.words, props.status);
  const pct = (n: number) => `${c.total ? (n / c.total) * 100 : 0}%`;
  return (
    <div className="listrow" aria-current={props.selected ? "true" : undefined}>
      <button type="button" className="pick" onClick={props.onClick}>
        <span className="name">
          <b>{props.title}</b>
          <span className="num small">{t("words.learnedOf", { n: c.learned, total: c.total })}{c.learned === c.total && c.total ? " ✓" : ""}</span>
        </span>
        <span className="stack3" role="img" aria-label={t("words.barAria", { learned: c.learned, met: c.met, unseen: c.unseen })}>
          <i className="l" style={{ width: pct(c.learned) }} />
          <i className="m" style={{ width: pct(c.met) }} />
        </span>
        <span className="small muted">
          {props.tile ? t("words.seenCount", { n: c.learned + c.met }) : `${props.detail ? `${props.detail} · ` : ""}${t("words.rowDetail", { seen: c.learned + c.met, unseen: c.unseen })}`}
        </span>
      </button>
    </div>
  );
}

function WordGrid({ title, words, status, expanded, onToggle, onRemove }: {
  title: string; words: readonly string[]; status: (w: string) => E.ListWordStatus; expanded: boolean; onToggle: () => void; onRemove?: () => void;
}) {
  const t = useT();
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
  const list = expanded ? words.filter(keep) : [];
  const c = counts(words, status);
  const work = expanded ? 0 : words.filter((w) => { const s = status(w); return !s.learned && (s.colour === "red" || s.colour === "yellow"); }).length;
  if (!expanded)
    return (
      <section className="panel" id="wordgrid">
        <div className="listhead">
          <h2>{title}</h2>
          {onRemove && <button className="btn small ghost" type="button" onClick={onRemove}>{t("words.removeList")}</button>}
        </div>
        <p className="small">{t("words.summary", { learned: c.learned, work, seen: c.met - work, unseen: c.unseen })}</p>
        <button className="btn block" type="button" aria-expanded="false" aria-controls="wordgrid" onClick={onToggle}>{t("words.showAll", { n: words.length })}</button>
      </section>
    );
  return (
    <section className="panel" id="wordgrid">
      <div className="listhead">
        <h2>{title}</h2>
        {onRemove && <button className="btn small ghost" type="button" onClick={onRemove}>{t("words.removeList")}</button>}
      </div>
      <button className="btn small ghost" type="button" aria-expanded="true" aria-controls="wordgrid" onClick={onToggle}>{t("words.hide")}</button>
      <div className="chips" role="group" aria-label={t("words.show")}>
        {FILTERS.map((f) => (
          <button key={f} type="button" className="chip" aria-pressed={filter === f} onClick={() => (setFilter(f), setShown(PAGE))}>{t(`words.filter.${f}`)}</button>
        ))}
      </div>
      <div className="legend small" aria-hidden="true">
        <span className="wchip s-unseen">{t("words.legend.unseen")}</span>
        <span className="wchip s-seen">{t("words.legend.seen")}</span>
        <span className="wchip s-tapped c-green">{t("words.legend.easy")}</span>
        <span className="wchip s-tapped c-yellow">{t("words.legend.medium")}</span>
        <span className="wchip s-tapped c-red">{t("words.legend.hard")}</span>
        <span className="wchip learned">{t("words.legend.learned")}</span>
      </div>
      {list.length ? (
        <div className="wgrid" lang="nl" dir="ltr">
          {list.slice(0, shown).map((w) => {
            const s = status(w);
            const cls = ["wchip", `s-${s.state}`, s.colour ? `c-${s.colour}` : "", s.learned ? "learned" : "", s.skipped ? "skipped" : ""].filter(Boolean).join(" ");
            return <button key={w} type="button" className={cls} onClick={() => setWord(w)}>{w}</button>;
          })}
        </div>
      ) : (
        <p>{t("words.noneHere")}</p>
      )}
      {list.length > shown && <button className="btn small ghost" type="button" onClick={() => setShown(shown + PAGE)}>{t("words.showMore", { n: list.length - shown })}</button>}
      {word && <WordDetails lemma={word} status={status(word)} onClose={() => setWord(null)} />}
    </section>
  );
}

function WordDetails({ lemma, status, onClose }: { lemma: string; status: E.ListWordStatus; onClose: () => void }) {
  const t = useT();
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
        <li>
          {w?.encounters ? t("words.seenIn", { n: w.encounters }) : t("words.notSeen")}
          {w?.reveals ? `${t("words.tapped", { n: w.reveals })}${recent ? t("words.recent", { n: recent }) : ""}` : w?.encounters ? t("words.neverTapped") : ""}
        </li>
        <li>{t("words.untapped", { n: untapped, max: E.LEARNED_UNTAPPED_READS })}{w && (w.untapped ?? 0) > untapped ? "+" : ""}</li>
        {card && (
          <li>
            {t("words.card", { pool: t(`words.pool.${card.pool}`) })}
            {card.pool === "easy" && card.easySince ? t("words.easySince", { date: t.date(card.easySince, { day: "numeric", month: "short" }), days: t("common.days", { n: easyDays }), max: E.LEARNED_EASY_DAYS }) : ""}
          </li>
        )}
      </ul>
      <p className="small">
        {status.learned
          ? t(tapped ? "words.isLearnedTapped" : "words.isLearned")
          : t(tapped ? "words.howLearnedTapped" : "words.howLearned", { n: E.LEARNED_UNTAPPED_READS, days: E.LEARNED_EASY_DAYS })}
      </p>
      <div className="actions">
        {!card && <button className="btn" type="button" onClick={() => void addToReview(lemma).then(() => (toast(t("words.addedReview")), onClose()))}>{t("words.addReview")}</button>}
        {card?.pool === "skipped" && <button className="btn" type="button" onClick={() => void unskipCard(lemma).then(() => (toast(t("words.broughtBack")), onClose()))}>{t("words.bringBack")}</button>}
        <button className="btn ghost" type="button" onClick={onClose}>{t("common.close")}</button>
      </div>
    </Sheet>
  );
}
