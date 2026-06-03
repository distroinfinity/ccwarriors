import { Hono } from "hono";
import { cors } from "hono/cors";
import type { DB } from "./db/index.js";
import { LeaderboardStore } from "./lib/leaderboard-store.js";
import { ingestRoute } from "./routes/ingest.js";
import { leaderboardRoute } from "./routes/leaderboard.js";
import { authRoute } from "./routes/auth.js";
import { installerRoute } from "./routes/installer.js";

export interface AppDeps {
  db: DB;
  store: LeaderboardStore;
  onIngest: () => void;
  corsOrigin?: string;
  auth?: {
    clientId: string;
    clientSecret: string;
    publicBaseUrl: string;
    webBaseUrl: string;
  };
}

export function createApp(deps?: AppDeps) {
  const app = new Hono();

  const corsOrigin = deps?.corsOrigin ?? "*";
  app.use(
    "*",
    cors({
      origin: corsOrigin === "*" ? "*" : corsOrigin.split(",").map((s) => s.trim()),
      credentials: corsOrigin !== "*",
    }),
  );

  app.get("/health", (c) => c.json({ status: "ok" }));
  app.route("/", installerRoute());
  if (deps) {
    app.route("/ingest", ingestRoute(deps.db, deps.store, deps.onIngest));
    app.route("/leaderboard", leaderboardRoute(deps.store));
    if (deps.auth) {
      app.route("/", authRoute(deps.db, deps.auth));
    }
  }
  return app;
}
