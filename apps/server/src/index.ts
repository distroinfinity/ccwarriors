import { serve } from "@hono/node-server";
import { WebSocketServer } from "ws";
import { parseConfig } from "./config.js";
import { createDb } from "./db/index.js";
import { users } from "./db/schema.js";
import { LeaderboardStore } from "./lib/leaderboard-store.js";
import { createApp } from "./app.js";
import { attachBroadcast } from "./ws/broadcast.js";

const cfg = parseConfig(process.env);
const db = createDb(cfg.databaseUrl);
const store = new LeaderboardStore();

// Warm the store from Postgres on boot.
const rows = await db.select().from(users);
for (const u of rows) {
  store.upsert({
    id: u.id,
    githubLogin: u.githubLogin,
    avatarUrl: u.avatarUrl,
    xHandle: u.xHandle,
    tier: u.tier,
    cardScene: u.cardScene,
    cost30d: Number(u.cost30d),
    costAllTime: Number(u.costAllTime),
  });
}

const wss = new WebSocketServer({ noServer: true });
const broadcast = attachBroadcast(wss, store);
const app = createApp({ db, store, onIngest: broadcast });

const server = serve({ fetch: app.fetch, port: cfg.port }, (info) => {
  console.log(`ccwarriors server on :${info.port}`);
});

server.on("upgrade", (req, socket, head) => {
  wss.handleUpgrade(req, socket as any, head, (ws) => wss.emit("connection", ws, req));
});
