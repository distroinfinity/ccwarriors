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
import type { Entry } from "./types";

type Board = "30d" | "allTime";

export default function App() {
  const { count, top30d, topAllTime, connected, hasSnapshot } = useLeaderboard();
  const { me: session, resolved: meResolved } = useMe();
  const [board, setBoard] = useState<Board>("30d");

  const entries: Entry[] = board === "30d" ? top30d : topAllTime;
  // 30-day sum — "all-time" is unreliable (local logs are pruned after ~30 days).
  const totalBurned = entries.reduce((s, e) => s + e.cost30d, 0);

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
        <Header count={count} totalBurned={totalBurned} loading={!hasSnapshot} />
        <main className="main">
          <Hero />
          <div className="layout">
            <Leaderboard
              board={board}
              setBoard={setBoard}
              entries={entries}
              total={count}
              connected={connected}
              hasSnapshot={hasSnapshot}
            />
            {!hasSnapshot || !meResolved ? (
              <CardSkeleton />
            ) : me ? (
              <YourCard entry={me} rank={meRank} />
            ) : (
              <EnlistCard />
            )}
          </div>
        </main>
        <footer>
          Built with <PixelHeart /> by{" "}
          <a href="https://x.com/distroinfinity" target="_blank" rel="noopener">
            Manu
          </a>{" "}
          ·{" "}
          <a href="https://github.com/distroinfinity/ccwarriors" target="_blank" rel="noopener">
            GitHub
          </a>
        </footer>
      </div>
    </>
  );
}
