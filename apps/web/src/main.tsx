import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { init } from "./lib/store.ts";
import { startAuth } from "./lib/sync.ts";
import "./styles.css";

void init().then(() => startAuth());
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
