import type { WebSocketServer } from "ws";
import type { LeaderboardStore, Entry } from "../lib/leaderboard-store.js";
import { toolLabel } from "../lib/tools.js";

const TOP_N = 100;

// The legacy keys (count/top30d/topAllTime) are kept byte-compatible — old web
// clients read exactly those. byTool/tools/totals are additive.
//
// The body is serialized ONCE per store change and reused for every new
// connection and every broadcast tick until the next ingest invalidates it —
// rebuilding it per client was a major source of allocation churn (RSS).
function buildPayloads(store: LeaderboardStore): { snapshot: string; update: string } {
  const tools = store.toolSummaries();
  const byTool: Record<string, { top30d: Entry[] }> = {};
  for (const t of tools) {
    byTool[t.key] = { top30d: store.getTop("30d", TOP_N, 0, t.key) };
  }
  const body = JSON.stringify({
    count: store.count(),
    top30d: store.getTop("30d", TOP_N),
    topAllTime: store.getTop("allTime", TOP_N),
    byTool,
    tools: tools.map((t) => ({ key: t.key, label: toolLabel(t.key), count: t.count })),
    totals: store.totals(),
  });
  // Splice the type in rather than stringifying twice.
  return {
    snapshot: `{"type":"snapshot",${body.slice(1)}`,
    update: `{"type":"update",${body.slice(1)}`,
  };
}

export function attachBroadcast(
  wss: WebSocketServer,
  store: LeaderboardStore,
  opts: { debounceMs?: number } = {},
) {
  const debounceMs = opts.debounceMs ?? 15_000;

  let cached: { snapshot: string; update: string } | null = null;
  const payloads = () => (cached ??= buildPayloads(store));

  wss.on("connection", (ws) => {
    ws.send(payloads().snapshot);
  });

  let timer: NodeJS.Timeout | null = null;
  return function broadcast() {
    // The store just changed — new connections must not see the stale snapshot.
    cached = null;
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      const msg = payloads().update;
      for (const client of wss.clients) {
        if (client.readyState === client.OPEN) client.send(msg);
      }
    }, debounceMs);
  };
}
