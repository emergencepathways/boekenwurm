import { StrictMode } from "react";
import { registerSW } from "virtual:pwa-register";
import { checkForNewVersion } from "./lib/update.ts";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { init } from "./lib/store.ts";
import { startAuth } from "./lib/sync.ts";
// Fonts are bundled and served from this site (lib/fonts.ts); the browser fetches only the ones in use.
import "@fontsource-variable/literata/opsz.css";
import "@fontsource-variable/literata/opsz-italic.css";
import "@fontsource-variable/atkinson-hyperlegible-next/index.css";
import "@fontsource-variable/source-serif-4/opsz.css";
import "@fontsource-variable/source-serif-4/opsz-italic.css";
import "@fontsource-variable/source-sans-3/index.css";
import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/newsreader/opsz-italic.css";
import "@fontsource-variable/lexend/index.css";
import "@fontsource-variable/jetbrains-mono/index.css";
// Cyrillic and Arabic letters for the Ukrainian and Arabic translations (only the alphabets on screen are downloaded).
import "@fontsource-variable/noto-sans/index.css";
import "@fontsource-variable/noto-sans-arabic/index.css";
// The secret Mörk Borg mode (screens/Hexbound.tsx): a blackletter for titles and an old, readable book face.
import "@fontsource/pirata-one/index.css";
import "@fontsource/im-fell-dw-pica/index.css";
import "@fontsource/im-fell-dw-pica/400-italic.css";
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
