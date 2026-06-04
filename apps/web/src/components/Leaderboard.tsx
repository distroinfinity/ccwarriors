import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { Entry } from "../types";
import { Avatar } from "./Avatar";
import { ClawdLogo } from "./ClawdLogo";
import { InstallBlock } from "./InstallBlock";
import { BLOCKS, formatUsd, sparkBars, tierLabel } from "../util";
import { TickerValue } from "./TickerValue";
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
  live,
  located,
}: {
  entry: Entry;
  rank: number;
  board: Board;
  delta: number;
  /** Live rows (WS top-100) reorder with spring physics; REST tail rows are static. */
  live: boolean;
  located: boolean;
}) {
  const top = rank <= 3;
  const amount = board === "30d" ? entry.cost30d : entry.costAllTime;
  return (
    <motion.div
      layout={live}
      transition={{ type: "spring", stiffness: 600, damping: 44 }}
      className={"row" + (top ? " top" : "") + (located ? " located" : "")}
      data-login={entry.githubLogin}
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
      <div className="amt mono">
        {/* Slow honest tween — glides toward each confirmed value, flashes green on growth. */}
        <TickerValue target={amount} durationMs={4000} resetKey={board} format={formatUsd} />
        {delta > 0 && <span className="delta">▲{delta}</span>}
      </div>
    </motion.div>
  );
}

const PAGE = 20;

export function Leaderboard({
  board,
  setBoard,
  entries,
  total,
  connected,
  hasSnapshot,
  locate,
}: {
  board: Board;
  setBoard: (b: Board) => void;
  entries: Entry[];
  /** Total warriors on the board (beyond what the live socket holds). */
  total: number;
  connected: boolean;
  /** True once a snapshot has arrived — distinguishes "connecting" from "empty". */
  hasSnapshot: boolean;
  /** Bumped by the "find me" button — scroll the board to this login. */
  locate?: { seq: number; login: string } | null;
}) {
  const [visibleN, setVisibleN] = useState(PAGE);
  // Ranks beyond the live top-100 are paged in via the REST API (static rows).
  const [extra, setExtra] = useState<Entry[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [locatedLogin, setLocatedLogin] = useState<string | null>(null);
  // Track previous rank per id (across renders) to compute ▲ deltas.
  const prevRanks = useRef<Map<string, number>>(new Map());
  const boardRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);

  useEffect(() => {
    setExtra([]);
    setVisibleN(PAGE);
    boardRef.current?.scrollTo({ top: 0 });
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

  // Next page: live WS data renders instantly; past the live top-100 the tail
  // is fetched 20 at a time from the REST API. Called by the scroll sentinel.
  const loadMore = async () => {
    if (loadingRef.current) return;
    if (visibleN < all.length) {
      setVisibleN((n) => n + PAGE);
      return;
    }
    if (all.length >= total) return; // everything is on the board
    loadingRef.current = true;
    setLoadingMore(true);
    try {
      const r = await fetch(
        `${API_HTTP}/leaderboard?board=${board}&limit=${PAGE}&offset=${all.length}`,
      );
      const d = (await r.json()) as { entries?: Entry[] };
      if (Array.isArray(d.entries) && d.entries.length > 0) {
        setExtra((prev) => [...prev, ...d.entries!]);
        setVisibleN((n) => n + PAGE);
      }
    } catch {
      /* sentinel re-fires on further scroll */
    } finally {
      loadingRef.current = false;
      setLoadingMore(false);
    }
  };
  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;

  // Prefetch when the sentinel drifts within ~400px of the viewport bottom —
  // the next page is usually ready before the user reaches the last row.
  useEffect(() => {
    const root = boardRef.current;
    const el = sentinelRef.current;
    if (!root || !el) return;
    const io = new IntersectionObserver(
      (ents) => {
        if (ents.some((e) => e.isIntersecting)) void loadMoreRef.current();
      },
      { root, rootMargin: "0px 0px 400px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [board, hasSnapshot]);

  // "Find me": expand the visible window to cover the rank, then smooth-scroll
  // the row to center and pulse it.
  useEffect(() => {
    if (!locate?.login) return;
    const idx = all.findIndex((e) => e.githubLogin === locate.login);
    if (idx === -1) return; // not in the live window — nothing to scroll to
    setVisibleN((n) => Math.max(n, idx + 4));
    // Two frames: let the newly-revealed rows commit before measuring.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const el = boardRef.current?.querySelector(`[data-login="${CSS.escape(locate.login)}"]`);
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
        setLocatedLogin(locate.login);
        setTimeout(() => setLocatedLogin(null), 1900);
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locate?.seq]);

  const visible = ranked.slice(0, visibleN);
  const atEnd = visible.length >= total;
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

      <div className="board" ref={boardRef}>
        {isConnecting ? (
          <BoardSkeleton />
        ) : isEmpty ? (
          <EmptyBoard />
        ) : (
          <>
            <AnimatePresence initial={false}>
              {visible.map(({ entry, rank, delta }) => (
                <Row
                  key={entry.id}
                  entry={entry}
                  rank={rank}
                  board={board}
                  delta={delta}
                  live={rank <= entries.length}
                  located={locatedLogin === entry.githubLogin}
                />
              ))}
            </AnimatePresence>
            {/* Infinite-scroll sentinel + footer states live inside the scroll area. */}
            <div ref={sentinelRef} aria-hidden="true" />
            {loadingMore && <div className="rowload" />}
            {atEnd && total > PAGE && (
              <div className="board-end">⚔ end of the board · {total} warriors</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
