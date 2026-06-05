import { useEffect, useState } from "react";
import { API_HTTP } from "./api";
import type { BoardState } from "./useLeaderboard";
import type { Entry, ToolInfo } from "./types";

const POLL_MS = 10_000;
const TOP_N = 100;

const EMPTY: BoardState = {
  count: 0,
  top30d: [],
  topAllTime: [],
  byTool: {},
  tools: [],
  totals: null,
  connected: false,
  hasSnapshot: false,
  hasCompleteData: false,
};

/**
 * Org-scoped board over REST + polling. The WS broadcast is global-only
 * (orgs ride along as entry fields); org pages poll their filtered slice.
 * Pass null to disable (the global page).
 */
export function useOrgBoard(slug: string | null): BoardState {
  const [state, setState] = useState<BoardState>(EMPTY);

  useEffect(() => {
    if (!slug) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      try {
        const r = await fetch(
          `${API_HTTP}/leaderboard?board=30d&limit=${TOP_N}&org=${encodeURIComponent(slug!)}`,
        );
        if (!r.ok) throw new Error(`org leaderboard failed: ${r.status}`);
        const d = (await r.json()) as {
          count?: number;
          entries?: Entry[];
          totals?: { burned30d: number; count: number };
          tools?: ToolInfo[];
          byTool?: Record<string, { top30d: Entry[] }>;
        };
        if (stop) return;
        const entries = Array.isArray(d.entries) ? d.entries : [];
        setState({
          count: d.count ?? entries.length,
          top30d: entries,
          topAllTime: entries, // all-time board is hidden in the UI anyway
          byTool: d.byTool ?? {},
          tools: Array.isArray(d.tools) ? d.tools : [],
          totals: d.totals ?? null,
          connected: true,
          hasSnapshot: true,
          hasCompleteData: true,
        });
      } catch {
        if (!stop) setState((s) => ({ ...s, connected: false }));
      } finally {
        if (!stop) timer = setTimeout(poll, POLL_MS);
      }
    }

    void poll();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [slug]);

  return slug ? state : EMPTY;
}
