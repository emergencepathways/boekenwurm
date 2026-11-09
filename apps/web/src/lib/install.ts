/**
 * Getting Boekenwurm onto the home screen. Android and desktop Chrome offer an install prompt
 * (beforeinstallprompt), kept here until the reader is offered it; iOS Safari has none, so the app shows how to
 * use Share → Add to Home Screen instead.
 */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferred = e as InstallPromptEvent;
  listeners.forEach((l) => l());
});
window.addEventListener("appinstalled", () => {
  deferred = null;
  listeners.forEach((l) => l());
});

export const canPrompt = () => Boolean(deferred);
export const onInstallChange = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));

export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  await deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = null;
  listeners.forEach((l) => l());
  return outcome === "accepted";
}

export const isStandalone = (): boolean =>
  matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** iPhone and iPad, including iPads that report themselves as a Mac. */
export const isIOS = (): boolean =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

const SEEN = "boekenwurm-install-help-seen";
export const installHelpSeen = () => {
  try {
    return localStorage.getItem(SEEN) === "1";
  } catch {
    return true;
  }
};
export const markInstallHelpSeen = () => {
  try {
    localStorage.setItem(SEEN, "1");
  } catch {
    /* ignore */
  }
};
