import { useState } from "react";
import { BADGES, startProgress, type CefrLevel } from "@boekenwurm/engine";
import { updateProfile } from "../lib/store.ts";
import { LANGUAGES, useT } from "../lib/i18n.ts";
import { LevelPicker } from "../ui.tsx";

/** First run: the reader's starting level, which also gives them that level's badge (DESIGN.md, badges). */
export function Welcome() {
  const [level, setLevel] = useState<CefrLevel>("A2");
  const t = useT();
  const start = () => updateProfile((p) => ({ ...p, progress: startProgress(level, Date.now()), onboarded: true }));
  return (
    <main className="screen full" style={{ paddingTop: "calc(var(--safe-top) + 40px)" }}>
      <img src={`${import.meta.env.BASE_URL}icons/icon-192.png`} alt="" width="84" height="84" style={{ borderRadius: 20 }} />
      {/* The language first: many readers are newcomers to the Netherlands, learning Dutch through another language. */}
      <div className="langpick" role="group" aria-label={t("welcome.language")}>
        {LANGUAGES.map((l) => (
          <button key={l.id} type="button" lang={l.id} dir={l.dir} aria-pressed={t.lang === l.id}
            onClick={() => void updateProfile((p) => ({ ...p, settings: { ...p.settings, language: l.id } }))}>
            {l.native}
          </button>
        ))}
      </div>
      <h1 className="big">{t("welcome.title")}</h1>
      <p className="muted" style={{ margin: 0 }}>{t("welcome.lead")}</p>
      <section className="panel">
        <h2>{t("welcome.where")}</h2>
        <p>{t("welcome.choose")}</p>
        <LevelPicker value={level} onChange={setLevel} label={t("welcome.level")} />
        <p className="small">{t.rich("welcome.startAs", { title: BADGES[level].title, meaning: t(`badge.meaning.${level}`) })}</p>
        <button className="btn primary block" type="button" onClick={start}>
          {t("welcome.start")}
        </button>
      </section>
      <p className="note">{t("welcome.account")}</p>
    </main>
  );
}
