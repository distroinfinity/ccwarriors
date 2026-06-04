import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { Entry } from "../types";
import { Avatar } from "./Avatar";
import { ClawdLogo } from "./ClawdLogo";
import { InstallBlock } from "./InstallBlock";
import { BLOCKS, formatUsd, sparkBars, tierLabel } from "../util";
import { useTickerTween } from "../useTween";
import { BoardSkeleton } from "./Skeleton";
import { API_HTTP } from "../api";

type Board = "30d" | "allTime";

function EmptyBoard() {
  return (
    <div className="empty">
      <ClawdLogo className="empty-clawd" />
      <h3>No warriors enlisted yet.</h3>
      <p>Be the first:</p>
      <InstallBlock />
    </div>
  );
}

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
  // Slow honest tween — glides toward each confirmed value, flashes green on growth.
  const { value, flashing } = useTickerTween(amount, { durationMs: 4000, resetKey: board });
  return (
    <motion.div
      layout
      transition={{ type: "spring", stiffness: 600, damping: 44 }}
      className={"row" + (top ? " top" : "") + (flashing ? " up" : "")}
    >
      <div className="rank mono">{rank}</div>
      <Avatar src={entry.avatarUrl} name={entry.githubLogin} index={rank - 1} />
      <a
        className="who"
        href={`https://github.com/${entry.githubLogin}`}
        target="_blank"
        rel="noopener"
        title={`${entry.githubLogin} on GitHub`}
      >
        <div className="h">{entry.githubLogin}</div>
        <div className="x">@{entry.xHandle ?? entry.githubLogin}</div>
      </a>
      <div className="tierc">{tierLabel(entry.tier)}</div>
      <Sparkline id={entry.id} />
      <div className={"amt mono" + (flashing ? " up" : "")}>
        {formatUsd(value)}
        {delta > 0 && <span className="delta">▲{delta}</span>}
      </div>
    </motion.div>
  );
}

const FIRST_PAGE = 15;
const PAGE = 25;

export function Leaderboard({
  board,
  setBoard,
  entries,
  total,
  connected,
  hasSnapshot,
}: {
  board: Board;
  setBoard: (b: Board) => void;
  entries: Entry[];
  /** Total warriors on the board (beyond what the live socket holds). */
  total: number;
  connected: boolean;
  /** True once a snapshot has arrived — distinguishes "connecting" from "empty". */
  hasSnapshot: boolean;
}) {
  const [visibleN, setVisibleN] = useState(FIRST_PAGE);
  // Ranks beyond the live top-100 are paged in via the REST API (static rows).
  const [extra, setExtra] = useState<Entry[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  // Track previous rank per id (across renders) to compute ▲ deltas.
  const prevRanks = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    setExtra([]);
    setVisibleN(FIRST_PAGE);
  }, [board]);

  // Live entries first, fetched tail after (deduped — order can drift slightly).
  const all = useMemo(() => {
    const seen = new Set(entries.map((e) => e.id));
    return [...entries, ...extra.filter((e) => !seen.has(e.id))];
  }, [entries, extra]);

  const ranked = all.map((e, i) => {
    const prev = prevRanks.current.get(e.id);
    const delta = prev !== undefined && prev > i ? prev - i : 0;
    return { entry: e, rank: i + 1, delta };
  });
  // Update the ref after computing deltas for this render.
  prevRanks.current = new Map(all.map((e, i) => [e.id, i]));

  const showMore = async () => {
    const next = visibleN + PAGE;
    if (next > all.length && all.length < total && !loadingMore) {
      setLoadingMore(true);
      try {
        const r = await fetch(
          `${API_HTTP}/leaderboard?board=${board}&limit=${Math.max(PAGE, 50)}&offset=${all.length}`,
        );
        const d = (await r.json()) as { entries?: Entry[] };
        if (Array.isArray(d.entries)) setExtra((prev) => [...prev, ...d.entries!]);
      } catch {
        /* next click retries */
      } finally {
        setLoadingMore(false);
      }
    }
    setVisibleN(next);
  };

  const visible = ranked.slice(0, visibleN);
  // Genuinely empty only once a snapshot confirms zero entries; otherwise connecting.
  const isEmpty = entries.length === 0 && hasSnapshot;
  const isConnecting = entries.length === 0 && !hasSnapshot;

  return (
    <div>
      <div className="seclabel">Leaderboard</div>
      <div className="controls">
        <div className="seg">
          <button className={board === "30d" ? "on" : ""} onClick={() => setBoard("30d")}>
            30 Days
          </button>
          {/* All Time hidden for now: Claude Code prunes local logs after ~30 days,
              so ccusage "all-time" ≈ last 30 days. Re-enable once we compute true
              history server-side from accumulated snapshots. */}
        </div>
        <div className="live">
          <span className="dot" />
          {connected ? "live" : "reconnecting…"}
        </div>
      </div>

      <div className="board">
        {isConnecting ? (
          <BoardSkeleton />
        ) : isEmpty ? (
          <EmptyBoard />
        ) : (
          <AnimatePresence initial={false}>
            {visible.map(({ entry, rank, delta }) => (
              <Row key={entry.id} entry={entry} rank={rank} board={board} delta={delta} />
            ))}
          </AnimatePresence>
        )}
      </div>

      {total > FIRST_PAGE &&
        (visibleN < total ? (
          <button className="more" onClick={() => void showMore()} disabled={loadingMore}>
            {loadingMore ? "Loading…" : `Show more (${total - Math.min(visibleN, total)} more)`}
          </button>
        ) : (
          <button className="more" onClick={() => setVisibleN(FIRST_PAGE)}>
            Show less
          </button>
        ))}
    </div>
  );
}
