/**
 * The app gate, all of it (docs/APP_GATE.md). The rest of the app reaches it only through these exports, at lines
 * marked APPGATE-REMOVE, so `scripts/remove-app-gate.sh` can take it out in one step.
 */
import { useStore } from "../lib/store.ts";
import { ADMIN } from "../lib/features.ts";
import { openSetup } from "./state.ts";

export { GateRoot, useGateRoute } from "./Gate.tsx";

/** Account → Experimental → App gate: the way in to its setup. The owner's account only, like the other experiments. */
export function AppGateEntry(): React.JSX.Element | null {
  const owner = useStore((s) => s.features.includes(ADMIN));
  if (!owner) return null;
  return (
    <section className="panel" id="app-gate" lang="en">
      <h2>App gate</h2>
      <p>
        Opening TikTok, Instagram or another app you choose sends you here first, for a few minutes of reading and cards.
        Set it up in Safari on your iPhone, with two Shortcuts. Everything about which apps you gate stays on the device.
      </p>
      <button className="btn small" type="button" onClick={openSetup}>Set up the app gate</button>
    </section>
  );
}
