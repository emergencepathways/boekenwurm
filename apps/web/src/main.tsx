import { StrictMode } from "react";
import { registerSW } from "virtual:pwa-register";
import { checkForNewVersion } from "./lib/update.ts";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { init } from "./lib/store.ts";
import { startAuth } from "./lib/sync.ts";
import "./styles.css";

void init().then(() => startAuth());

// A new version is installed in the background and, once ready, the app reloads into it (autoUpdate); without this the
// cached old version would be shown until the next visit. The app also checks for a new version when it comes back
// to the foreground, so a phone that keeps it open for days still updates.
registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    if (!registration) return;
    void checkForNewVersion(registration);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void checkForNewVersion(registration);
    });
  },
});
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
