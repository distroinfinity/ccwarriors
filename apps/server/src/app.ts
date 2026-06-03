import { Hono } from "hono";
import { cors } from "hono/cors";
import type { DB } from "./db/index.js";
import { LeaderboardStore } from "./lib/leaderboard-store.js";
import { ingestRoute } from "./routes/ingest.js";
import { leaderboardRoute } from "./routes/leaderboard.js";
import { authRoute } from "./routes/auth.js";
import { installerRoute } from "./routes/installer.js";
import { telemetryRoute, captureEvent } from "./routes/telemetry.js";

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

  // Uncaught route errors: structured log + PostHog trace, generic 500 to the client.
  app.onError((err, c) => {
    captureEvent("server_error", "server", {
      path: c.req.path,
      method: c.req.method,
      message: String(err instanceof Error ? err.message : err).slice(0, 200),
    });
    return c.json({ error: "internal" }, 500);
  });

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
  app.route("/telemetry", telemetryRoute());
  if (deps) {
    app.route("/ingest", ingestRoute(deps.db, deps.store, deps.onIngest));
    app.route("/leaderboard", leaderboardRoute(deps.store));
    if (deps.auth) {
      app.route("/", authRoute(deps.db, deps.auth));
    }
  }
  return app;
}
