import { useEffect, useRef, useState } from "react";
import type { Snapshot, ToolInfo } from "./types";

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
  /** True once the first snapshot has been received from the backend. */
  hasSnapshot: boolean;
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
};

/**
 * Connects to the live backend WebSocket, replacing state on every
 * snapshot/update message. Auto-reconnects on close via setTimeout.
 * `enabled:false` skips the socket entirely (org pages poll REST instead).
 */
export function useLeaderboard(enabled = true): BoardState {
  const [state, setState] = useState<BoardState>(EMPTY);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    closedRef.current = false;

    function connect() {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => setState((s) => ({ ...s, connected: true }));
      ws.onmessage = (ev) => {
        try {
          const msg: Snapshot = JSON.parse(ev.data);
          setState({
            count: msg.count,
            top30d: msg.top30d ?? [],
            topAllTime: msg.topAllTime ?? [],
            byTool: msg.byTool ?? {},
            tools: Array.isArray(msg.tools) ? msg.tools : [],
            totals: msg.totals ?? null,
            connected: true,
            hasSnapshot: true,
          });
        } catch {
          /* ignore malformed frames */
        }
      };
      ws.onclose = () => {
        setState((s) => ({ ...s, connected: false }));
        if (!closedRef.current) retryRef.current = setTimeout(connect, 1500);
      };
      ws.onerror = () => ws.close();
    }

    connect();

    return () => {
      closedRef.current = true;
      if (retryRef.current) clearTimeout(retryRef.current);
      wsRef.current?.close();
    };
  }, [enabled]);

  return state;
}
