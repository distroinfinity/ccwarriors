import { Hono } from "hono";
import type { DB } from "./db/index.js";
import { LeaderboardStore } from "./lib/leaderboard-store.js";
import { ingestRoute } from "./routes/ingest.js";
import { leaderboardRoute } from "./routes/leaderboard.js";

export interface AppDeps {
  db: DB;
  store: LeaderboardStore;
  onIngest: () => void;
}

export function createApp(deps?: AppDeps) {
  const app = new Hono();
  app.get("/health", (c) => c.json({ status: "ok" }));
  if (deps) {
    app.route("/ingest", ingestRoute(deps.db, deps.store, deps.onIngest));
    app.route("/leaderboard", leaderboardRoute(deps.store));
  }
  return app;
}
