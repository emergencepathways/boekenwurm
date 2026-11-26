import { useEffect } from "react";
import { useStore, dueToday } from "./lib/store.ts";
import { applyFont, applyTextSize } from "./lib/fonts.ts";
import { usePhotoPages } from "./lib/features.ts";
import { Hexbound } from "./screens/Hexbound.tsx";
import { applyLanguage, useT, type Key } from "./lib/i18n.ts";
import { setTab, useNav, type Tab } from "./nav.ts";
import { Icon, Toaster, Unlocker } from "./ui.tsx";
import { Home } from "./screens/Home.tsx";
import { Study, StudySession } from "./screens/Study.tsx";
import { Me } from "./screens/Me.tsx";
import { Words } from "./screens/Words.tsx";
import { ImportList } from "./screens/ImportList.tsx";
import { Reader } from "./screens/Reader.tsx";
import { AddBook } from "./screens/AddBook.tsx";
import { PhotoBook } from "./screens/PhotoBook.tsx";
import { InstallHelp } from "./screens/InstallHelp.tsx";
import { Welcome } from "./screens/Welcome.tsx";
import { parseLinkRequest, saveLinkRequest } from "./lib/connections.ts";

const TABS: Array<[Tab, Key, () => React.JSX.Element]> = [
  ["home", "tab.home", Icon.home],
  ["study", "tab.study", Icon.study],
  ["words", "tab.words", Icon.words],
  ["me", "tab.account", Icon.me],
];

export function App() {
  const ready = useStore((s) => s.ready);
  const onboarded = useStore((s) => s.profile.onboarded);
  useStore((s) => s.cards); // today's count changes with every answer
  const due = useStore((s) => (s.ready ? dueToday() : 0));
  const noList = useStore((s) => s.ready && !s.wordLists.length && !s.profile.settings.commonWords);
  const { tab, screen } = useNav();
  const t = useT();
  const language = useStore((s) => s.profile.settings.language);
  const photoPages = usePhotoPages();
  const game = useStore((s) => s.game);
  useEffect(() => applyLanguage(language), [language]);

  useEffect(() => {
    // Opened from the weekly diary reminder (public/push-handler.js): straight to Study → Diary.
    const q = new URLSearchParams(location.search);
    if (q.get("open") === "diary") {
      history.replaceState(null, "", location.pathname);
      setTab("study", "diary");
    }
    // Sent here by Poortwachter to be allowed (lib/connections.ts). PRELAUNCH-REMOVE (docs/PRELAUNCH.md).
    const link = parseLinkRequest(location.search);
    if (q.get("connect")) history.replaceState(null, "", location.pathname);
    if (link) {
      saveLinkRequest(link);
      setTab("me", "connected-apps");
    }
  }, []);
  const font = useStore((s) => s.profile.settings.font);
  useEffect(() => applyFont(font), [font]);
  const textSize = useStore((s) => s.profile.settings.textSize);
  useEffect(() => applyTextSize(textSize), [textSize]);

  if (!ready) return <div className="app" aria-busy="true" />;
  // The secret Mörk Borg mode: while a character lives, the app is only the game (lib/hexbound.ts).
  if (game) return <Hexbound />;
  if (!onboarded) return <Welcome />;

  return (
    <div className="app">
      {screen?.name === "reader" ? (
        <Reader key={screen.bookId} bookId={screen.bookId} />
      ) : screen?.name === "add" ? (
        <AddBook />
      ) : screen?.name === "photo" && photoPages ? (
        <PhotoBook bookId={screen.bookId} />
      ) : screen?.name === "import-list" ? (
        <ImportList />
      ) : screen?.name === "study-session" ? (
        <StudySession lemmas={screen.lemmas} afterLookupMode={screen.afterLookupMode} bookId={screen.bookId} />
      ) : (
        <>
          {tab === "home" && <Home />}
          {tab === "study" && <Study />}
          {tab === "words" && <Words />}
          {tab === "me" && <Me />}
          <nav className="tabbar" aria-label={t("tab.nav")}>
            {TABS.map(([id, label, Ico]) => (
              <button key={id} type="button" aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}>
                <Ico />
                {t(label)}
                {id === "study" && due > 0 && <span className="dot">{due > 99 ? "99+" : due}</span>}
                {id === "words" && noList && <span className="dot" aria-label={t("tab.noList")}>!</span>}
              </button>
            ))}
          </nav>
          <InstallHelp />
        </>
      )}
      <Toaster />
      <Unlocker />
    </div>
  );
}
