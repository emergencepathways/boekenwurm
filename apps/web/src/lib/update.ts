/**
 * Keeping the installed app current. The service worker serves the app from its cache, so after a deploy a reader
 * would see the previous version until their next visit. Two checks prevent that:
 *
 * - the plugin's own reload when a new service worker activates (src/main.tsx), which can miss an update that
 *   activates before the app has started;
 * - this check: every build carries an id (__BUILD_ID__) and publishes it as /version.json, fetched past every cache.
 *   When the live id differs from the running one, the app waits until the service worker would serve the new
 *   version, then reloads once. A reload is tried once per new id, so a failed install never loops.
 */

const TRIED = "boekenwurm-reloaded-for";
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/** The app script this page runs, and the one the service worker would serve on a reload now. */
const scriptOf = (html: string) => html.match(/assets\/index-[\w-]+\.js/)?.[0] ?? null;
const running = () => scriptOf([...document.scripts].map((s) => s.src).join(" "));
async function served(): Promise<string | null> {
  try {
    return scriptOf(await fetch(`${import.meta.env.BASE_URL}index.html`).then((r) => r.text()));
  } catch {
    return null;
  }
}

export async function checkForNewVersion(registration?: ServiceWorkerRegistration): Promise<void> {
  if (!navigator.onLine) return;
  let live: string | null = null;
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, { cache: "no-store" });
    if (r.ok) live = ((await r.json()) as { id?: string }).id ?? null;
  } catch {
    return;
  }
  if (!live || live === __BUILD_ID__) return;
  try {
    if (sessionStorage.getItem(TRIED) === live) return;
  } catch {
    /* storage blocked */
  }
  // Reload once the service worker will serve the new version (up to 20 s), so the reload doesn't get the old one.
  const now = running();
  for (let i = 0; i < 20; i++) {
    const next = await served();
    if (next && now && next !== now) break;
    if (i === 0 || i === 5) await registration?.update().catch(() => undefined);
    await sleep(1000);
  }
  try {
    sessionStorage.setItem(TRIED, live);
  } catch {
    /* storage blocked */
  }
  location.reload();
}

/**
 * Me → About → "Check for updates": the same check, started by the reader. Answers "current" when this is the live
 * version; otherwise the app switches to the new one and reloads.
 */
export async function updateNow(): Promise<"current" | "offline"> {
  let live: string | null = null;
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, { cache: "no-store" });
    if (r.ok) live = ((await r.json()) as { id?: string }).id ?? null;
  } catch {
    return "offline";
  }
  if (!live) return "offline";
  if (live === __BUILD_ID__) return "current";
  try {
    sessionStorage.removeItem(TRIED);
  } catch {
    /* storage blocked */
  }
  await checkForNewVersion((await navigator.serviceWorker?.getRegistration().catch(() => undefined)) ?? undefined);
  return "current";
}
