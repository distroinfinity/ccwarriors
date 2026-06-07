import { Hono } from "hono";
import { cors } from "hono/cors";
import { etag, RETAINED_304_HEADERS } from "hono/etag";
import type { DB } from "./db/index.js";
import { LeaderboardStore } from "./lib/leaderboard-store.js";
import type { InsightsStore } from "./lib/insights-store.js";
import { ingestRoute } from "./routes/ingest.js";
import { leaderboardRoute } from "./routes/leaderboard.js";
import { authRoute } from "./routes/auth.js";
import { orgsRoute, type DiscordCfg } from "./routes/orgs.js";
import { installerRoute } from "./routes/installer.js";
import { telemetryRoute, captureEvent } from "./routes/telemetry.js";
import { adminRoute } from "./routes/admin.js";
import { donateRoute } from "./routes/donate.js";
import { sponsorsRoute } from "./routes/sponsors.js";
import { insightsRoute } from "./routes/insights.js";

export interface AppDeps {
  db: DB;
  store: LeaderboardStore;
  insightsStore?: InsightsStore;
  onIngest: () => void;
  corsOrigin?: string;
  auth?: {
    clientId: string;
    clientSecret: string;
    publicBaseUrl: string;
    webBaseUrl: string;
  };
  donate?: {
    keyId: string;
    keySecret: string;
    webhookSecret?: string;
    // USD→INR rate source; tests inject a fixed rate (default: live fx).
    usdInr?: () => number;
  };
  discord?: DiscordCfg;
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
  // Org boards live on subdomains (ns.ccwarriors.xyz, ...) — Hono's array
  // origin is exact-match only, so a function allows the whole family.
  const allowed = corsOrigin.split(",").map((s) => s.trim());
  const SUBDOMAIN_RE = /^https:\/\/[a-z0-9-]+\.ccwarriors\.xyz$/;
  app.use(
    "*",
    cors({
      origin:
        corsOrigin === "*"
          ? "*"
          : (origin) => (allowed.includes(origin) || SUBDOMAIN_RE.test(origin) ? origin : null),
      credentials: corsOrigin !== "*",
    }),
  );

  // Conditional requests for the public read endpoints: org pages poll
  // /leaderboard every few seconds, so unchanged payloads become 304s.
  // Scoped per-route (never /me — cookie-gated) and the CORS headers must be
  // retained explicitly: hono's etag rebuilds the response on 304 and would
  // otherwise strip Access-Control-Allow-* — breaking cross-origin org polls.
  const cacheEtag = etag({
    retainedHeaders: [
      ...RETAINED_304_HEADERS,
      "access-control-allow-origin",
      "access-control-allow-credentials",
      "access-control-expose-headers",
    ],
  });
  app.use("/leaderboard", cacheEtag);
  app.use("/sponsors", cacheEtag);

  app.get("/health", (c) => c.json({ status: "ok" }));
  app.route("/", installerRoute());
  app.route("/telemetry", telemetryRoute());
  if (deps) {
    app.route("/ingest", ingestRoute(deps.db, deps.store, deps.onIngest));
    app.route("/leaderboard", leaderboardRoute(deps.store));
    app.route("/admin", adminRoute(deps.db, deps.store, deps.onIngest));
    app.route("/sponsors", sponsorsRoute(deps.db));
    if (deps.insightsStore) {
      app.route(
        "/insights",
        insightsRoute({ db: deps.db, insightsStore: deps.insightsStore, sessionSecret: deps.auth?.clientSecret }),
      );
    }
    if (deps.auth) {
      app.route("/", authRoute(deps.db, deps.auth));
    }
    if (deps.donate) {
      app.route("/donate", donateRoute(deps.db, deps.donate));
    }
    if (deps.discord) {
      app.route("/", orgsRoute(deps.db, deps.store, deps.discord, deps.onIngest));
    }
  }
  return app;
}
