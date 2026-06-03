import { useEffect, useRef, useState } from "react";
import type { Snapshot } from "./types";

const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://localhost:8787";

export interface BoardState {
  count: number;
  top30d: Snapshot["top30d"];
  topAllTime: Snapshot["topAllTime"];
  connected: boolean;
}

const EMPTY: BoardState = { count: 0, top30d: [], topAllTime: [], connected: false };

/**
 * Connects to the live backend WebSocket, replacing state on every
 * snapshot/update message. Auto-reconnects on close via setTimeout.
 */
export function useLeaderboard(): BoardState {
  const [state, setState] = useState<BoardState>(EMPTY);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedRef = useRef(false);

  useEffect(() => {
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
            top30d: msg.top30d,
            topAllTime: msg.topAllTime,
            connected: true,
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
  }, []);

  return state;
}
