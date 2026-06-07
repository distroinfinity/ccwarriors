import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { Entry, ToolInfo } from "../types";
import { Avatar } from "./Avatar";
import { ClawdLogo } from "./ClawdLogo";
import { InstallBlock } from "./InstallBlock";
import { FilterChips } from "./FilterChips";
import { BLOCKS, formatUsd, sparkBars, tierLabel } from "../util";
import { TickerValue } from "./TickerValue";
import { BoardSkeleton } from "./Skeleton";
import { PixelGlyph } from "./PixelGlyph";
import { API_HTTP } from "../api";
import { WEB_ORGS, type WebOrg } from "../orgs";

type Board = "30d" | "allTime";

/** Verified-org pill(s) after a warrior's name — org accent. On a dedicated
    org board that org's own pill is noise (everyone there has it), so it's
    suppressed; pills for *other* orgs still show. */
function OrgBadges({ entry, hide }: { entry: Entry; hide?: string }) {
  const orgs = (entry.orgs ?? []).filter((s) => WEB_ORGS[s] && s !== hide);
  if (orgs.length === 0) return null;
  return (
    <>
      {orgs.map((s) => (
        <span
          key={s}
          className="orgbadge mono"
          style={{ color: WEB_ORGS[s]!.accent }}
          title={`${WEB_ORGS[s]!.name} verified`}
        >
          {s.toUpperCase()}
        </span>
      ))}
    </>
  );
}

/** Display cost for an entry under the active filter — a lookup, never math.
    Entries from an old server lack `breakdown`: their spend is all claude. */
function toolCost(e: Entry, tool: string | null): number {
  if (!tool) return e.cost30d;
  const v = e.breakdown?.[tool];
  if (v != null) return v;
  return tool === "claude" ? e.cost30d : 0;
}

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
  tool,
  delta,
  live,
  located,
  hideOrgBadge,
}: {
  entry: Entry;
  rank: number;
  board: Board;
  tool: string | null;
  delta: number;
  /** Live rows (WS top-100) reorder with spring physics; REST tail rows are static. */
  live: boolean;
  located: boolean;
  /** Org slug whose pill is redundant on this board (the dedicated org page). */
  hideOrgBadge?: string;
}) {
  const top = rank <= 3;
  const amount = board === "30d" ? toolCost(entry, tool) : entry.costAllTime;
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
        href={`/u/${encodeURIComponent(entry.githubLogin)}`}
        title={`${entry.githubLogin} on CCWarriors`}
      >
        <div className="h">
          <span className="hname">{entry.githubLogin}</span>
          <OrgBadges entry={entry} hide={hideOrgBadge} />
        </div>
        <div className="x">@{entry.xHandle ?? entry.githubLogin}</div>
      </a>
      <div className="tierc">{tierLabel(entry.tier)}</div>
      <Sparkline id={entry.id} />
      <div className="amt mono">
        {/* Slow honest tween — glides toward each confirmed value, flashes green on growth. */}
        <TickerValue
          target={amount}
          durationMs={4000}
          resetKey={`${board}:${tool ?? "all"}`}
          format={formatUsd}
        />
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
  byTool,
  tools,
  tool,
  setTool,
  total,
  connected,
  hasSnapshot,
  hasCompleteData,
  locate,
  org,
}: {
  board: Board;
  setBoard: (b: Board) => void;
  entries: Entry[];
  /** Per-tool live boards from the WS. {} on old servers. */
  byTool: Record<string, { top30d: Entry[] }>;
  /** Tools with data — drives the filter chips. [] on old servers. */
  tools: ToolInfo[];
  tool: string | null;
  setTool: (t: string | null) => void;
  /** Total warriors on the board (beyond what the live socket holds). */
  total: number;
  connected: boolean;
  /** True once a snapshot has arrived — distinguishes "connecting" from "empty". */
  hasSnapshot: boolean;
  /** True once tool metadata is complete enough to invalidate active filters. */
  hasCompleteData: boolean;
  /** Bumped by the "find me" button — scroll the board to this login. */
  locate?: { seq: number; login: string } | null;
  /** Org page: the tail fetch and footer copy scope to this org. */
  org?: WebOrg | null;
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

  // The live list: a tool filter swaps in that tool's WS board (still live —
  // it re-ranks on every update); All uses the totals board.
  const liveEntries: Entry[] = tool && byTool[tool] ? byTool[tool].top30d : entries;

  useEffect(() => {
    setExtra([]);
    setVisibleN(PAGE);
    boardRef.current?.scrollTo({ top: 0 });
  }, [board, tool]);

  // If the active tool disappears (reconnect to an old server, last warrior of
  // a tool drops to zero) fall back to All instead of showing a stale board.
  useEffect(() => {
    if (!tool || !hasCompleteData) return;
    if (!tools.some((t) => t.key === tool)) setTool(null);
  }, [tool, tools, hasCompleteData, setTool]);

  // Live entries first, fetched tail after (deduped — order can drift slightly).
  const all = useMemo(() => {
    const seen = new Set(liveEntries.map((e) => e.id));
    return [...liveEntries, ...extra.filter((e) => !seen.has(e.id))];
  }, [liveEntries, extra]);

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
    if (!tool && all.length >= total) return; // everything is on the board
    loadingRef.current = true;
    setLoadingMore(true);
    try {
      const toolParam = tool ? `&tool=${encodeURIComponent(tool)}` : "";
      const orgParam = org ? `&org=${encodeURIComponent(org.slug)}` : "";
      const r = await fetch(
        `${API_HTTP}/leaderboard?board=${board}&limit=${PAGE}&offset=${all.length}${toolParam}${orgParam}`,
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
  }, [board, tool, hasSnapshot]);

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
  const atEnd = !tool && visible.length >= total;
  // Genuinely empty only once a snapshot confirms zero entries; otherwise connecting.
  const isEmpty = liveEntries.length === 0 && hasSnapshot;
  const isConnecting = liveEntries.length === 0 && !hasSnapshot;

  return (
    <div>
      <div className="seclabel">Leaderboard</div>
      <div className="controls">
        <div className="seg">
          <button className={board === "30d" ? "on" : ""} onClick={() => setBoard("30d")}>
            30 Days
          </button>
          {/* All Time hidden for now: local agent logs prune after ~30 days, so
              ccusage "all-time" ≈ last 30 days. Re-enable once server-side
              accumulation has aged enough to be meaningful. */}
        </div>
        <FilterChips tools={tools} active={tool} onSelect={setTool} />
        <div className="live">
          <span className="dot" />
          {connected ? "live" : "reconnecting…"}
        </div>
      </div>

      <div className="board" ref={boardRef}>
        {isConnecting ? (
          <BoardSkeleton />
        ) : isEmpty ? (
          tool ? (
            <div className="empty">
              <h3>No warriors on this tool yet.</h3>
              <p>Burn some tokens and claim the top spot.</p>
            </div>
          ) : (
            <EmptyBoard />
          )
        ) : (
          <>
            <AnimatePresence initial={false}>
              {visible.map(({ entry, rank, delta }) => (
                <Row
                  key={entry.id}
                  entry={entry}
                  rank={rank}
                  board={board}
                  tool={tool}
                  delta={delta}
                  live={rank <= liveEntries.length}
                  located={locatedLogin === entry.githubLogin}
                  hideOrgBadge={org?.slug}
                />
              ))}
            </AnimatePresence>
            {/* Infinite-scroll sentinel + footer states live inside the scroll area. */}
            <div ref={sentinelRef} aria-hidden="true" />
            {loadingMore && <div className="rowload" />}
            {atEnd && total > PAGE && (
              <div className="board-end">
                <PixelGlyph name="sword" size={11} className="endglyph" /> end of the board ·{" "}
                {total} {org ? `${org.name} warriors` : "warriors"}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
