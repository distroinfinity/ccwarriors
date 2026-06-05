import { useEffect, useRef, useState } from "react";
import { API_HTTP } from "./api";
import type { Entry, Snapshot, ToolInfo } from "./types";

const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://localhost:8787";

export interface BoardState {
  count: number;
  top30d: Snapshot["top30d"];
  topAllTime: Snapshot["topAllTime"];
  /** Per-tool live boards (ranked by that tool's 30d cost). {} on old servers. */
  byTool: Record<string, { top30d: Snapshot["top30d"] }>;
  /** Tools with at least one warrior. [] on old servers → filter chips hide. */
  tools: ToolInfo[];
  /** Server-computed totals — the headline numbers are never summed client-side. */
  totals: { burned30d: number; count: number } | null;
  connected: boolean;
  /** True once any server response can render the board. */
  hasSnapshot: boolean;
  /** True once state includes the full board metadata, not just the REST seed. */
  hasCompleteData: boolean;
}

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
 * Connects to the live backend WebSocket, replacing state on every
 * snapshot/update message. Auto-reconnects on close via setTimeout.
 * `enabled:false` skips the socket entirely (org pages poll REST instead).
 *
 * First paint doesn't wait for the socket: a REST fetch of the top page fires
 * in parallel and seeds the board (empty tools/byTool — the same degraded
 * shape old servers send, so chips just stay hidden until the snapshot lands).
 * The WS snapshot replaces the seed; if the seed loses the race it's a no-op.
 */
export function useLeaderboard(enabled = true): BoardState {
  const [state, setState] = useState<BoardState>(EMPTY);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const seedAbort = new AbortController();
    let stopped = false;
    let gotSnapshot = false;

    fetch(`${API_HTTP}/leaderboard?board=30d&limit=20`, { signal: seedAbort.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`leaderboard seed failed: ${r.status}`);
        return r.json();
      })
      .then((d: { count?: number; entries?: Entry[]; totals?: BoardState["totals"] }) => {
        if (gotSnapshot || stopped) return;
        const entries = Array.isArray(d.entries) ? d.entries : [];
        setState((s) =>
          s.hasCompleteData
            ? s
            : {
                count: d.count ?? entries.length,
                top30d: entries,
                topAllTime: [],
                byTool: {},
                tools: [],
                totals: d.totals ?? null,
                connected: false,
                hasSnapshot: true,
                hasCompleteData: false,
              },
        );
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        /* WS path still loads the board */
      });

    function connect() {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!stopped) setState((s) => ({ ...s, connected: true }));
      };
      ws.onmessage = (ev) => {
        if (stopped) return;
        try {
          const msg: Snapshot = JSON.parse(ev.data);
          gotSnapshot = true;
          setState({
            count: msg.count,
            top30d: msg.top30d ?? [],
            topAllTime: msg.topAllTime ?? [],
            byTool: msg.byTool ?? {},
            tools: Array.isArray(msg.tools) ? msg.tools : [],
            totals: msg.totals ?? null,
            connected: true,
            hasSnapshot: true,
            hasCompleteData: true,
          });
        } catch {
          /* ignore malformed frames */
        }
      };
      ws.onclose = () => {
        if (stopped) return;
        setState((s) => ({ ...s, connected: false }));
        retryRef.current = setTimeout(connect, 1500);
      };
      ws.onerror = () => {
        if (!stopped) ws.close();
      };
    }

    connect();

    return () => {
      stopped = true;
      seedAbort.abort();
      if (retryRef.current) clearTimeout(retryRef.current);
      wsRef.current?.close();
    };
  }, [enabled]);

  return state;
}
