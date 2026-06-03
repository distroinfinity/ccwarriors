// Dev server: in-memory DB + seeded demo warriors + simulated live updates.
// Run with: pnpm --filter server dev:seed   (serves HTTP + WebSocket on :8080)
import { serve } from "@hono/node-server";
import { WebSocketServer } from "ws";
import { createTestDb } from "./db/index.js";
import { LeaderboardStore } from "./lib/leaderboard-store.js";
import { computeTier } from "./lib/tier.js";
import { createApp } from "./app.js";
import { attachBroadcast } from "./ws/broadcast.js";

const SCENES = [
  "crane", "wave", "fujiDawn", "sakura", "temple",
  "bonsai", "fujiNight", "monk", "torii",
];

const PEOPLE: Array<[string, string]> = [
  ["torvaldsjr", "torvaldsjr"], ["shipfast", "shipfast_dev"], ["nightowl", "nightowl"],
  ["vibecoder", "vibecoder"], ["promptsmith", "promptsmith"], ["laurakdev", "laurakdev"],
  ["merge_conflict", "merge_conflict"], ["async_andy", "async_andy"], ["kernelpanic", "kernelpanic"],
  ["ctrl_z", "ctrl_z"], ["segfault", "segfault"], ["yak_shaver", "yak_shaver"],
  ["regexwizard", "regexwizard"], ["rubberduck", "rubberduck"], ["manu", "getdodge"],
];

const SEED_30D = [9847, 8120, 6755, 4980, 4210, 3650, 3110, 2740, 2390, 2050, 1760, 1540, 1180, 1020, 812];

const store = new LeaderboardStore();

function seed() {
  PEOPLE.forEach(([login, x], i) => {
    const c30 = SEED_30D[i] ?? 500;
    const all = Math.round(c30 * (2.4 + (i % 4) * 0.5));
    store.upsert({
      id: login,
      githubLogin: login,
      avatarUrl: `https://i.pravatar.cc/120?img=${(i * 5 + 3) % 70}`,
      xHandle: x,
      tier: computeTier(all),
      cardScene: SCENES[i % SCENES.length] ?? "fujiNight",
      cost30d: c30,
      costAllTime: all,
    });
  });
}

seed();

const db = await createTestDb(); // satisfies createApp deps; demo data lives in the store
const wss = new WebSocketServer({ noServer: true });
const broadcast = attachBroadcast(wss, store, { debounceMs: 250 });
const app = createApp({ db, store, onIngest: broadcast });

const server = serve({ fetch: app.fetch, port: 8787 }, (info) => {
  console.log(`ccwarriors DEV server on http://localhost:${info.port}  (ws + ${store.count()} seeded warriors)`);
});

server.on("upgrade", (req, socket, head) => {
  wss.handleUpgrade(req, socket as any, head, (ws) => wss.emit("connection", ws, req));
});

// Simulate live spend: every few seconds a random warrior burns a bit more.
let tick = 0;
setInterval(() => {
  const top = store.getTop("30d", 100);
  if (top.length === 0) return;
  const victim = top[Math.floor(Math.random() * top.length)]!;
  const bump = tick % 7 === 0 ? 300 + Math.random() * 900 : 15 + Math.random() * 120;
  const cost30d = Math.round(victim.cost30d + bump);
  const costAllTime = Math.round(victim.costAllTime + bump);
  store.upsert({ ...victim, cost30d, costAllTime, tier: computeTier(costAllTime) });
  broadcast();
  tick++;
}, 2500);
