import type { WebSocketServer } from "ws";
import type { LeaderboardStore, Entry } from "../lib/leaderboard-store.js";
import { toolLabel } from "../lib/tools.js";

const TOP_N = 100;

// The legacy keys (count/top30d/topAllTime) are kept byte-compatible — old web
// clients read exactly those. byTool/tools/totals are additive.
function payload(store: LeaderboardStore, type: "snapshot" | "update") {
  const tools = store.toolSummaries();
  const byTool: Record<string, { top30d: Entry[] }> = {};
  for (const t of tools) {
    byTool[t.key] = { top30d: store.getTop("30d", TOP_N, 0, t.key) };
  }
  return JSON.stringify({
    type,
    count: store.count(),
    top30d: store.getTop("30d", TOP_N),
    topAllTime: store.getTop("allTime", TOP_N),
    byTool,
    tools: tools.map((t) => ({ key: t.key, label: toolLabel(t.key), count: t.count })),
    totals: store.totals(),
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
