/** Study → Diary: turn the weekly diary reminder on or off for this device (lib/push.ts). */
import { useEffect, useState } from "react";
import { pushState, turnOff, turnOn, type PushState } from "../lib/push.ts";
import { useStore } from "../lib/store.ts";
import { setTab } from "../nav.ts";
import { toast } from "../ui.tsx";
import { useT, type Key } from "../lib/i18n.ts";

const SAY: Record<Exclude<PushState, "on" | "off" | "off-in-build">, Key> = {
  unsupported: "reminder.unsupported",
  "install-first": "reminder.installFirst",
  "no-account": "reminder.noAccount",
  denied: "reminder.denied",
};

export function Reminders() {
  const t = useT();
  const user = useStore((s) => s.user);
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => void pushState().then(setState), [user]);
  if (!state || state === "off-in-build") return null;
  return (
    <section className="panel">
      <h2>{t("reminder.title")}</h2>
      {state === "on" || state === "off" ? (
        <>
          <p>{state === "on" ? t("reminder.on") : t("reminder.off")}</p>
          <button className={`btn${state === "on" ? " ghost" : ""}`} type="button" disabled={busy} onClick={async () => {
            setBusy(true);
            try {
              const next = state === "on" ? await turnOff() : await turnOn();
              setState(next);
              toast(next === "on" ? t("reminder.toastOn") : next === "denied" ? t("reminder.toastDenied") : t("reminder.toastOff"));
            } catch (e) {
              toast(t("reminder.failed", { error: (e as Error).message }), 6000);
            }
            setBusy(false);
          }}>{state === "on" ? t("reminder.turnOff") : t("reminder.turnOn")}</button>
          <p className="small muted">{t("reminder.stored")}</p>
        </>
      ) : (
        <>
          <p className="small">{t(SAY[state])}</p>
          {state === "no-account" && <button className="btn small" type="button" onClick={() => setTab("me", "account")}>{t("reminder.signIn")}</button>}
        </>
      )}
    </section>
  );
}
