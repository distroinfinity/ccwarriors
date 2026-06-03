import { useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { Entry } from "../types";
import { Avatar } from "./Avatar";
import { BLOCKS, formatUsd, sparkBars, tierLabel } from "../util";

type Board = "30d" | "allTime";

function Sparkline({ id }: { id: string }) {
  const bars = sparkBars(id);
  return (
    <div className="spark">
      {bars.map((b, i) =>
        i === bars.length - 1 ? <b key={i}>{BLOCKS[b - 1]}</b> : <span key={i}>{BLOCKS[b - 1]}</span>,
      )}
    </div>
  );
}

function Row({
  entry,
  rank,
  board,
  delta,
}: {
  entry: Entry;
  rank: number;
  board: Board;
  delta: number;
}) {
  const top = rank <= 3;
  const amount = board === "30d" ? entry.cost30d : entry.costAllTime;
  return (
    <motion.div
      layout
      transition={{ type: "spring", stiffness: 600, damping: 44 }}
      className={"row" + (top ? " top" : "")}
    >
      <div className="rank mono">{rank}</div>
      <Avatar src={entry.avatarUrl} name={entry.githubLogin} index={rank - 1} />
      <div className="who">
        <div className="h">{entry.githubLogin}</div>
        <div className="x">{entry.xHandle ? "@" + entry.xHandle : "—"}</div>
      </div>
      <div className="tierc">{tierLabel(entry.tier)}</div>
      <Sparkline id={entry.id} />
      <div className="amt mono">
        {formatUsd(amount)}
        {delta > 0 && <span className="delta">▲{delta}</span>}
      </div>
    </motion.div>
  );
}

export function Leaderboard({
  board,
  setBoard,
  entries,
  connected,
}: {
  board: Board;
  setBoard: (b: Board) => void;
  entries: Entry[];
  connected: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  // Track previous rank per id (across renders) to compute ▲ deltas.
  const prevRanks = useRef<Map<string, number>>(new Map());

  const ranked = entries.map((e, i) => {
    const prev = prevRanks.current.get(e.id);
    const delta = prev !== undefined && prev > i ? prev - i : 0;
    return { entry: e, rank: i + 1, delta };
  });
  // Update the ref after computing deltas for this render.
  prevRanks.current = new Map(entries.map((e, i) => [e.id, i]));

  const visible = showAll ? ranked : ranked.slice(0, 15);

  return (
    <div>
      <div className="seclabel">Leaderboard</div>
      <div className="controls">
        <div className="seg">
          <button className={board === "30d" ? "on" : ""} onClick={() => setBoard("30d")}>
            30 Days
          </button>
          <button className={board === "allTime" ? "on" : ""} onClick={() => setBoard("allTime")}>
            All Time
          </button>
        </div>
        <div className="live">
          <span className="dot" />
          {connected ? "live · updates every ~2.5s" : "reconnecting…"}
        </div>
      </div>

      <div className="board">
        <AnimatePresence initial={false}>
          {visible.map(({ entry, rank, delta }) => (
            <Row key={entry.id} entry={entry} rank={rank} board={board} delta={delta} />
          ))}
        </AnimatePresence>
      </div>

      {ranked.length > 15 && (
        <button className="more" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Show less" : `Show more (${ranked.length - 15})`}
        </button>
      )}
    </div>
  );
}
