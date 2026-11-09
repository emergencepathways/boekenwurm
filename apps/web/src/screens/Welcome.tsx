import { useState } from "react";
import { BADGES, startProgress, type CefrLevel } from "@boekenwurm/engine";
import { updateProfile } from "../lib/store.ts";
import { LevelPicker } from "../ui.tsx";

/** First run: the reader's starting level, which also gives them that level's badge (DESIGN.md, badges). */
export function Welcome() {
  const [level, setLevel] = useState<CefrLevel>("A2");
  const start = () => updateProfile((p) => ({ ...p, progress: startProgress(level, Date.now()), onboarded: true }));
  return (
    <main className="screen full" style={{ paddingTop: "calc(var(--safe-top) + 40px)" }}>
      <img src={`${import.meta.env.BASE_URL}icons/icon-192.png`} alt="" width="84" height="84" style={{ borderRadius: 20 }} />
      <h1 className="big">Read Dutch books you own, at your level.</h1>
      <p className="muted" style={{ margin: 0 }}>
        Tap the words you don't know. Too many taps and the page turn ends your run; keep a streak going and you move up a level.
      </p>
      <section className="panel">
        <h2>Where are you now?</h2>
        <p>Choose your Dutch level. You can change it any time under Me.</p>
        <LevelPicker value={level} onChange={setLevel} label="Your level" />
        <p className="small">
          You start as <b lang="nl">{BADGES[level].title}</b> ({BADGES[level].meaning.toLowerCase()}).
        </p>
        <button className="btn primary block" type="button" onClick={start}>
          Start reading
        </button>
      </section>
      <p className="note">
        Everything works on this device without an account. Sign in under Me to keep your books and progress on all your devices.
      </p>
    </main>
  );
}
