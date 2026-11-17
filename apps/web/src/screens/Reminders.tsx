/** Study → Diary: turn the weekly diary reminder on or off for this device (lib/push.ts). */
import { useEffect, useState } from "react";
import { pushState, turnOff, turnOn, type PushState } from "../lib/push.ts";
import { useStore } from "../lib/store.ts";
import { setTab } from "../nav.ts";
import { toast } from "../ui.tsx";

const SAY: Record<Exclude<PushState, "on" | "off">, string> = {
  "off-in-build": "",
  unsupported: "This browser can't show notifications. The weekly card on Home reminds you instead.",
  "install-first": "On iPhone, add Boekenwurm to your Home Screen first (Share → Add to Home Screen), then open it from there to turn reminders on.",
  "no-account": "Sign in to get a weekly reminder on this phone.",
  denied: "Notifications are blocked for Boekenwurm. Allow them in your phone's settings to get the weekly reminder.",
};

export function Reminders() {
  const user = useStore((s) => s.user);
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => void pushState().then(setState), [user]);
  if (!state || state === "off-in-build") return null;
  return (
    <section className="panel">
      <h2>Weekly reminder</h2>
      {state === "on" || state === "off" ? (
        <>
          <p>{state === "on" ? "On: once a week, if your diary is waiting, this phone gets a reminder." : "Get a reminder on this phone once a week, when a diary prompt is waiting."}</p>
          <button className={`btn${state === "on" ? " ghost" : ""}`} type="button" disabled={busy} onClick={async () => {
            setBusy(true);
            try {
              const next = state === "on" ? await turnOff() : await turnOn();
              setState(next);
              toast(next === "on" ? "Weekly reminder on." : next === "denied" ? "Notifications weren't allowed." : "Weekly reminder off.");
            } catch (e) {
              toast(`Couldn't change the reminder: ${(e as Error).message}`, 6000);
            }
            setBusy(false);
          }}>{state === "on" ? "Turn off" : "Remind me weekly"}</button>
          <p className="small muted">Stored with your account: this phone's notification address and time zone, nothing you write.</p>
        </>
      ) : (
        <>
          <p className="small">{SAY[state]}</p>
          {state === "no-account" && <button className="btn small" type="button" onClick={() => setTab("me", "account")}>Sign in</button>}
        </>
      )}
    </section>
  );
}
