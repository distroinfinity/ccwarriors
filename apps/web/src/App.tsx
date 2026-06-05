import { useMemo, useState } from "react";
import { useLeaderboard } from "./useLeaderboard";
import { useMe } from "./useMe";
import { Marquee } from "./components/Marquee";
import { Header } from "./components/Header";
import { Hero } from "./components/Hero";
import { Leaderboard } from "./components/Leaderboard";
import { YourCard, EnlistCard } from "./components/YourCard";
import { CardSkeleton } from "./components/Skeleton";
import { SceneDefs } from "./components/CardScene";
import { PixelHeart } from "./components/PixelHeart";
import { HowItWorks } from "./components/HowItWorks";
import { Legal } from "./components/Legal";
import { Sponsor } from "./components/Sponsor/Sponsor";
import type { Entry } from "./types";

// Extra routes, no router: /how and /legal render in the same shell.
// /legal is built but hidden until the Razorpay international activation
// needs it (issue #8) — flip HIDE_LEGAL to false to bring it back.
const HIDE_LEGAL = true;
const path = window.location.pathname.replace(/\/+$/, "");
const isHow = path === "/how";
const isLegal = !HIDE_LEGAL && path === "/legal";
if (isHow) document.title = "How it works · CCWarriors";
if (isLegal) document.title = "Legal · CCWarriors";

type Board = "30d" | "allTime";

export default function App() {
  const { count, top30d, topAllTime, byTool, tools, totals, connected, hasSnapshot } =
    useLeaderboard();
  const { me: session, resolved: meResolved } = useMe();
  const [board, setBoard] = useState<Board>("30d");
  // Single-select tool filter (null = All). Lives here so the header/marquee
  // stay pinned to the all-tools view no matter what the board shows.
  const [tool, setTool] = useState<string | null>(null);
  // "Find me" — seq bump tells the Leaderboard to scroll to this login.
  const [locate, setLocate] = useState<{ seq: number; login: string } | null>(null);

  // Header/Marquee always reflect ALL tools — the filter is a board-only view.
  const entries: Entry[] = board === "30d" ? top30d : topAllTime;
  // Headline total comes from the server (it sums every warrior, not just the
  // top-100 we hold). Old servers don't send totals → fall back to the old
  // client-side reduce over the live window.
  const totalBurned = totals?.burned30d ?? entries.reduce((s, e) => s + e.cost30d, 0);

  // "Your card" — identity claimed via the CLI's personalized link (?u=login),
  // remembered in localStorage. Unknown visitors get the enlist CTA instead.
  const claimed = useMemo(() => {
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get("logout")) {
        localStorage.removeItem("ccw_login");
        url.searchParams.delete("logout");
        window.history.replaceState({}, "", url.toString());
        return null;
      }
      const u = url.searchParams.get("u");
      if (u) {
        localStorage.setItem("ccw_login", u);
        url.searchParams.delete("u");
        window.history.replaceState({}, "", url.toString());
        return u;
      }
      return localStorage.getItem("ccw_login");
    } catch {
      return null;
    }
  }, []);
  const identity = session?.login ?? claimed;
  const meIndex = identity ? entries.findIndex((e) => e.githubLogin === identity) : -1;
  const me = meIndex >= 0 ? entries[meIndex] : undefined;
  const meRank = meIndex + 1;

  return (
    <>
      <SceneDefs />
      <Marquee entries={entries} count={count} loading={!hasSnapshot} />
      <div className="wrap">
        <Header count={totals?.count ?? count} totalBurned={totalBurned} loading={!hasSnapshot} />
        <main className="main">
          {isHow ? (
            <HowItWorks />
          ) : isLegal ? (
            <Legal />
          ) : (
            <>
              <Hero />
              <div className="layout">
                <Leaderboard
                  board={board}
                  setBoard={setBoard}
                  entries={entries}
                  byTool={byTool}
                  tools={tools}
                  tool={tool}
                  setTool={setTool}
                  total={count}
                  connected={connected}
                  hasSnapshot={hasSnapshot}
                  locate={locate}
                />
                {!hasSnapshot || !meResolved ? (
                  <CardSkeleton />
                ) : me ? (
                  <YourCard
                    entry={me}
                    rank={meRank}
                    outdatedClient={session?.outdatedClient}
                    underReview={session?.underReview}
                    onLocate={() =>
                      setLocate((s) => ({ seq: (s?.seq ?? 0) + 1, login: me.githubLogin }))
                    }
                  />
                ) : (
                  <EnlistCard />
                )}
              </div>
            </>
          )}
        </main>
        {!isHow && !isLegal && <Sponsor />}
        <footer>
          <div className="fleft">
            <div className="fbrand">CCWARRIORS</div>
            <div className="fcredit">
              Built with <PixelHeart /> by{" "}
              <a href="https://x.com/distroinfinity" target="_blank" rel="noopener">
                Manu
              </a>
            </div>
          </div>
          <nav className="flinks" aria-label="Footer">
            <a href="/how">How it works</a>
            <a href="https://github.com/distroinfinity/ccwarriors" target="_blank" rel="noopener">
              GitHub
            </a>
            <a href="https://x.com/distroinfinity" target="_blank" rel="noopener">
              X
            </a>
            <a href="mailto:manurajput2911@gmail.com?subject=CCWarriors%20issue">Facing any issues?</a>
            {!HIDE_LEGAL && <a href="/legal">Legal</a>}
          </nav>
        </footer>
      </div>
    </>
  );
}
