import { useState } from "react";
import { useLeaderboard } from "./useLeaderboard";
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
  const [board, setBoard] = useState<Board>("30d");

  const entries: Entry[] = board === "30d" ? top30d : topAllTime;
  const totalBurned = entries.reduce((s, e) => s + e.costAllTime, 0);

  // "Your card" — find manu, fall back to the first entry.
  const meIndex = entries.findIndex((e) => e.githubLogin === "manu");
  const me = meIndex >= 0 ? entries[meIndex] : entries[0];
  const meRank = meIndex >= 0 ? meIndex + 1 : 1;

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
              connected={connected}
              hasSnapshot={hasSnapshot}
            />
            {!hasSnapshot ? <CardSkeleton /> : me ? <YourCard entry={me} rank={meRank} /> : <EnlistCard />}
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
