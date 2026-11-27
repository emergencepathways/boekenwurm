/**
 * The app gate (docs/APP_GATE.md): what the reader sees when an iPhone Shortcut sends them here on opening an app they
 * chose to gate. English only, for now, like the other experiments.
 *
 * start (how often today, quick or deep review) → review (reading and cards, until enough active time) → done (open
 * the app again through the Unlock Shortcut).
 */
import { useEffect, useRef, useState } from "react";
import "./gate.css";
import { Toaster } from "../ui.tsx";
import * as R from "./rules.ts";
import { GateCards, itemKey, planRound, type RoundItem } from "./Cards.tsx";
import { GateReading, type ReadResult } from "./Reading.tsx";
import { GateSetup } from "./Setup.tsx";
import { appLink, countsFor, leaveGate, loadGate, nextParagraph, notePassed, openSetup, useGate, useGateRoute, type NextParagraph } from "./state.ts";

/** The gate or its setup, when the address asks for one; otherwise nothing (App.tsx shows the app). */
export function GateRoot(): React.JSX.Element | null {
  const route = useGateRoute();
  useEffect(() => void loadGate(), []);
  if (!route) return null;
  return (
    <div className="app gate" data-gate={route.kind}>
      {route.kind === "setup" ? <GateSetup /> : <GateScreen key={route.app} app={route.app} />}
      <Toaster />
    </div>
  );
}

export { useGateRoute };

type Phase = { kind: "start" } | { kind: "review"; tier: R.Tier } | { kind: "done"; tier: R.Tier };

function GateScreen({ app }: { app: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: "start" });
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [phase.kind]);
  if (phase.kind === "review") return <Review app={app} tier={phase.tier} onPassed={() => setPhase({ kind: "done", tier: phase.tier })} />;
  if (phase.kind === "done") return <Done app={app} tier={phase.tier} />;
  return <Start app={app} onChoose={(tier) => setPhase({ kind: "review", tier })} />;
}

// ---------------------------------------------------------------- start

function Start({ app, onChoose }: { app: string; onChoose: (t: R.Tier) => void }) {
  const quick = useGate((d) => R.clampQuickMinutes(d.settings.quickMinutes));
  // Re-read whenever the gate's data changes (the count for this visit lands just after the page opens).
  const today = { shown: useGate(() => countsFor(app, 1).shown) };
  const week = { shown: useGate(() => countsFor(app, 7).shown) };
  return (
    <main className="screen full gate-start">
      <p className="gate-eyebrow">Boekenwurm · app gate</p>
      <h1 className="gate-title">A pause before {app}</h1>
      <p className="gate-tally">
        <span className="gate-big">{today.shown}</span>
        <span>{today.shown === 1 ? "time" : "times"} you opened {app} today{week.shown > today.shown ? ` · ${week.shown} this week` : ""}</span>
      </p>
      <div className="gate-tiers">
        <button className="gate-tier" type="button" onClick={() => onChoose("quick")}>
          <b>Quick review</b>
          <span>{quick} minutes of reading and cards</span>
          <span className="gate-unlock">{app} free for {R.unlockMinutes("quick")} minutes</span>
        </button>
        <button className="gate-tier deep" type="button" onClick={() => onChoose("deep")}>
          <b>Deep review</b>
          <span>{R.TIERS.deep.reviewMinutes} minutes of reading and cards</span>
          <span className="gate-unlock">{app} free for an hour</span>
        </button>
      </div>
      <button className="btn ghost block" type="button" onClick={leaveGate}>Not now: stay in Boekenwurm</button>
      <p className="note gate-foot">
        Only time with this page open and a tap, key or scroll in the last 2 minutes counts.{" "}
        <button className="linklike" type="button" onClick={openSetup}>Gate settings</button>
      </p>
    </main>
  );
}

// ---------------------------------------------------------------- the review

type Step =
  | { kind: "loading" }
  | { kind: "paragraph"; next: NextParagraph }
  | { kind: "cards"; items: RoundItem[] }
  | { kind: "none" };

function Review({ app, tier, onPassed }: { app: string; tier: R.Tier; onPassed: () => void }) {
  const settings = useGate((d) => d.settings);
  const target = R.reviewMs(tier, settings.quickMinutes);
  const clock = useRef(R.startClock(Date.now()));
  const [, rerender] = useState(0);
  const [step, setStep] = useState<Step>({ kind: "loading" });
  const last = useRef<R.Activity | null>(null);
  const shown = useRef(new Set<string>());
  const streak = useRef(0);
  const [seed] = useState(() => Date.now());
  const noneRef = useRef(false);
  noneRef.current = step.kind === "none";

  // Active time: ticks every second; any tap, key or scroll keeps it counting.
  useEffect(() => {
    const touch = () => (clock.current = R.touch(clock.current, Date.now()));
    const tick = () => {
      // With nothing to review the screen is a plain pause: being on screen is enough.
      if (noneRef.current) touch();
      clock.current = R.tick(clock.current, Date.now(), document.visibilityState === "visible");
      rerender((n) => n + 1);
    };
    const id = setInterval(tick, 1000);
    const events = ["pointerdown", "keydown", "touchstart", "wheel"] as const;
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    window.addEventListener("scroll", touch, { passive: true, capture: true });
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      events.forEach((e) => window.removeEventListener(e, touch));
      window.removeEventListener("scroll", touch, { capture: true });
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);

  const choose = async () => {
    setStep({ kind: "loading" });
    const next = settings.sources.reading ? await nextParagraph() : null;
    const items = planRound(settings.sources, shown.current);
    const act = R.nextActivity(last.current, { paragraph: Boolean(next), cards: items.length > 0 });
    last.current = act;
    window.scrollTo(0, 0);
    setStep(act === "paragraph" ? { kind: "paragraph", next: next! } : act === "cards" ? { kind: "cards", items } : { kind: "none" });
  };
  useEffect(() => void choose(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const paragraphRead = (r: ReadResult) => {
    // Boekenwurm's rules: a failed paragraph's time doesn't count, and the fouten loosen again.
    if (settings.reading === "boekenwurm" && !r.passed) clock.current = R.deduct(clock.current, r.spentMs);
    streak.current = r.passed ? streak.current + 1 : 0;
    void choose();
  };
  const cardsDone = (items: RoundItem[]) => {
    items.forEach((i) => shown.current.add(itemKey(i)));
    void choose();
  };

  const now = Date.now();
  const done = clock.current.activeMs >= target;
  const idle = !done && step.kind !== "none" && R.isIdle(clock.current, now, document.visibilityState === "visible");
  const pct = Math.min(100, Math.round((clock.current.activeMs / target) * 100));

  return (
    <main className="screen full gate-review">
      <div className="gate-timer" role="timer" aria-live="off">
        <span><b>{tier === "quick" ? "Quick review" : "Deep review"}</b> · {R.mmss(Math.min(clock.current.activeMs, target))} of {R.mmss(target)}</span>
        {idle && <span className="chip warn">Paused: tap to continue</span>}
      </div>
      <div className="xpbar" role="progressbar" aria-label="Review time" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><i style={{ width: `${pct}%` }} /></div>

      {done && (
        <div className="gate-ready" role="status">
          <span>Done: {app} is yours for {R.unlockMinutes(tier) === 60 ? "an hour" : `${R.unlockMinutes(tier)} minutes`}.</span>
          <button className="btn primary" type="button" onClick={onPassed}>Unlock</button>
        </div>
      )}

      {step.kind === "loading" && <div className="gate-sheet"><span className="spinner" /></div>}
      {step.kind === "paragraph" && <GateReading key={`${step.next.book.id}:${step.next.ord}`} next={step.next} rules={settings.reading} streak={streak.current} onDone={paragraphRead} />}
      {step.kind === "cards" && <GateCards key={step.items.map(itemKey).join(",")} items={step.items} seed={seed} onDone={() => cardsDone(step.items)} />}
      {step.kind === "none" && (
        <section className="panel gate-none">
          <h2>Nothing to read or review here</h2>
          <p>
            No book with a next paragraph and no cards due{settings.sources.reading ? "" : " (reading is turned off in the gate settings)"}. Stay with
            this screen until the timer ends, or add something for next time.
          </p>
          <p className="small muted">
            Books and words come from your account: sign in here in Safari once, so the gate sees the same books as the
            app on your home screen.
          </p>
          <button className="btn small" type="button" onClick={openSetup}>Gate settings and my cards</button>
        </section>
      )}
    </main>
  );
}

// ---------------------------------------------------------------- done

function Done({ app, tier }: { app: string; tier: R.Tier }) {
  const minutes = R.unlockMinutes(tier);
  const link = appLink(app);
  const setup = useGate((d) => d.settings.shortcut);
  const noted = useRef(false);
  useEffect(() => {
    if (noted.current) return;
    noted.current = true;
    void notePassed(app);
  }, [app]);
  return (
    <main className="screen full gate-done">
      <p className="gate-eyebrow">Goed gedaan!</p>
      <h1 className="gate-title">{app} is free for {minutes === 60 ? "an hour" : `${minutes} minutes`}</h1>
      <p className="muted">
        The Shortcut saves the time on your phone{link ? ` and opens ${app}` : ""}. Opening {app} again before then
        won’t bring you back here.
      </p>
      <a className="btn primary block" href={R.unlockUrl(minutes, link, setup)} onClick={() => setTimeout(leaveGate, 1500)}>Unlock {app}</a>
      <p className="note">Safari may ask to open Shortcuts: allow it.</p>
      <button className="btn ghost block" type="button" onClick={leaveGate}>Back to Boekenwurm</button>
    </main>
  );
}
