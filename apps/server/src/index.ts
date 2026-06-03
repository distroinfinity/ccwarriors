import { serve } from "@hono/node-server";
import { WebSocketServer } from "ws";
import { parseConfig } from "./config.js";
import { createDbFromEnv } from "./db/index.js";
import { users } from "./db/schema.js";
import { LeaderboardStore } from "./lib/leaderboard-store.js";
import { createApp } from "./app.js";
import { attachBroadcast } from "./ws/broadcast.js";
import { seedDemo, startSimulation } from "./seed.js";

async function main() {
  const cfg = parseConfig(process.env);
  const db = await createDbFromEnv(cfg.databaseUrl);
  const store = new LeaderboardStore();

  // Local/demo only — never enabled in production.
  if (cfg.seedDemo) seedDemo(store);

  // Warm the store from Postgres (real users). Tolerate an unmigrated/empty DB.
  try {
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
  } catch (err) {
    console.warn("store warm-up skipped:", (err as Error).message);
  }

  const wss = new WebSocketServer({ noServer: true });
  const broadcast = attachBroadcast(wss, store);

  let authDeps:
    | { clientId: string; clientSecret: string; publicBaseUrl: string; webBaseUrl: string }
    | undefined;
  if (cfg.githubClientId && cfg.githubClientSecret) {
    authDeps = {
      clientId: cfg.githubClientId,
      clientSecret: cfg.githubClientSecret,
      publicBaseUrl: cfg.publicBaseUrl,
      webBaseUrl: cfg.webBaseUrl,
    };
  } else {
    console.log("github oauth: disabled (no credentials)");
  }

  const app = createApp({ db, store, onIngest: broadcast, corsOrigin: cfg.corsOrigin, auth: authDeps });

  const server = serve({ fetch: app.fetch, port: cfg.port }, (info) => {
    console.log(
      `ccwarriors on :${info.port} ` +
        `(db=${cfg.databaseUrl ? "postgres" : "pglite"} seed=${cfg.seedDemo} simulate=${cfg.simulate})`,
    );
  });

  server.on("upgrade", (req, socket, head) => {
    wss.handleUpgrade(req, socket as any, head, (ws) => wss.emit("connection", ws, req));
  });

  if (cfg.simulate) startSimulation(store, broadcast);
}

main().catch((err) => {
  console.error("failed to start ccwarriors server", err);
  process.exit(1);
});
