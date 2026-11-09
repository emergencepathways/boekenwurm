import { useEffect } from "react";
import { useStore, dueCards } from "./lib/store.ts";
import { setTab, useNav, type Tab } from "./nav.ts";
import { Icon, Toaster } from "./ui.tsx";
import { Home } from "./screens/Home.tsx";
import { Study, StudySession } from "./screens/Study.tsx";
import { Me } from "./screens/Me.tsx";
import { Reader } from "./screens/Reader.tsx";
import { AddBook } from "./screens/AddBook.tsx";
import { PhotoBook } from "./screens/PhotoBook.tsx";
import { InstallHelp } from "./screens/InstallHelp.tsx";
import { Welcome } from "./screens/Welcome.tsx";

const TABS: Array<[Tab, string, () => React.JSX.Element]> = [
  ["home", "Home", Icon.home],
  ["study", "Study", Icon.study],
  ["me", "Me", Icon.me],
];

export function App() {
  const ready = useStore((s) => s.ready);
  const onboarded = useStore((s) => s.profile.onboarded);
  const due = useStore((s) => (s.ready ? dueCards().length : 0));
  const { tab, screen } = useNav();

  useEffect(() => {
    document.documentElement.lang = "en";
  }, []);

  if (!ready) return <div className="app" aria-busy="true" />;
  if (!onboarded) return <Welcome />;

  return (
    <div className="app">
      {screen?.name === "reader" ? (
        <Reader key={screen.bookId} bookId={screen.bookId} />
      ) : screen?.name === "add" ? (
        <AddBook />
      ) : screen?.name === "photo" ? (
        <PhotoBook bookId={screen.bookId} />
      ) : screen?.name === "study-session" ? (
        <StudySession lemmas={screen.lemmas} />
      ) : (
        <>
          {tab === "home" && <Home />}
          {tab === "study" && <Study />}
          {tab === "me" && <Me />}
          <nav className="tabbar" aria-label="Main">
            {TABS.map(([id, label, Ico]) => (
              <button key={id} type="button" aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}>
                <Ico />
                {label}
                {id === "study" && due > 0 && <span className="dot">{due > 99 ? "99+" : due}</span>}
              </button>
            ))}
          </nav>
          <InstallHelp />
        </>
      )}
      <Toaster />
    </div>
  );
}
