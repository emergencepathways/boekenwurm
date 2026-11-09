import { useEffect, useState } from "react";
import { canPrompt, installHelpSeen, isIOS, isStandalone, markInstallHelpSeen, onInstallChange, promptInstall } from "../lib/install.ts";
import { Icon, Sheet } from "../ui.tsx";

/** iOS has no install prompt, so a one-time sheet shows Share → Add to Home Screen. */
export function InstallHelp() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (isIOS() && !isStandalone() && !installHelpSeen()) {
      const t = setTimeout(() => setShow(true), 1500);
      return () => clearTimeout(t);
    }
  }, []);
  if (!show) return null;
  const done = () => {
    markInstallHelpSeen();
    setShow(false);
  };
  return (
    <Sheet onClose={done} label="Add Boekenwurm to your Home Screen">
      <IosSteps />
      <button className="btn primary block" type="button" onClick={done}>
        Got it
      </button>
    </Sheet>
  );
}

export function IosSteps() {
  return (
    <>
      <h2 className="big" style={{ fontSize: "1.4rem" }}>Put Boekenwurm on your Home Screen</h2>
      <p className="muted" style={{ margin: 0 }}>It opens full-screen like an app and keeps working offline.</p>
      <ol className="how">
        <li>
          Tap <span className="share-ios"><Icon.share /></span> <b>Share</b> in Safari's toolbar.
        </li>
        <li>
          Scroll down and tap <b>Add to Home Screen</b>.
        </li>
        <li>
          Tap <b>Add</b>. Open Boekenwurm from its new icon.
        </li>
      </ol>
      <p className="note">
        The Home Screen app keeps its own sign-in. When you sign in there, type the 6-digit code from the email instead of tapping the link.
      </p>
    </>
  );
}

/** The install button under Me: Android/desktop prompt, or the iOS steps. */
export function InstallRow() {
  const [, force] = useState(0);
  const [ios, setIos] = useState(false);
  useEffect(() => onInstallChange(() => force((n) => n + 1)), []);
  if (isStandalone()) return <p className="small">Installed on this device.</p>;
  if (canPrompt())
    return (
      <button className="btn" type="button" onClick={() => void promptInstall()}>
        Install Boekenwurm
      </button>
    );
  if (isIOS())
    return (
      <>
        <button className="btn" type="button" onClick={() => setIos(true)}>
          Add to Home Screen
        </button>
        {ios && (
          <Sheet onClose={() => setIos(false)} label="Add to Home Screen">
            <IosSteps />
            <button className="btn primary block" type="button" onClick={() => setIos(false)}>Got it</button>
          </Sheet>
        )}
      </>
    );
  return <p className="small">Use your browser's menu to install Boekenwurm or add it to your home screen.</p>;
}
