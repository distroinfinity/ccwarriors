import type { WebSocketServer } from "ws";
import type { LeaderboardStore } from "../lib/leaderboard-store.js";

const TOP_N = 100;

function payload(store: LeaderboardStore, type: "snapshot" | "update") {
  return JSON.stringify({
    type,
    count: store.count(),
    top30d: store.getTop("30d", TOP_N),
    topAllTime: store.getTop("allTime", TOP_N),
  });
}

export function attachBroadcast(
  wss: WebSocketServer,
  store: LeaderboardStore,
  opts: { debounceMs?: number } = {},
) {
  const debounceMs = opts.debounceMs ?? 1000;

  wss.on("connection", (ws) => {
    ws.send(payload(store, "snapshot"));
  });

  let timer: NodeJS.Timeout | null = null;
  return function broadcast() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      const msg = payload(store, "update");
      for (const client of wss.clients) {
        if (client.readyState === client.OPEN) client.send(msg);
      }
    }, debounceMs);
  };
}
