import { Hono } from "hono";
import { httpInstrumentationMiddleware } from "@hono/otel";
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
import { daemonHealthRoute, type DaemonHealth } from "./routes/daemon-health.js";
import { adminRoute } from "./routes/admin.js";
import { donateRoute } from "./routes/donate.js";
import { sponsorsRoute } from "./routes/sponsors.js";
import { insightsRoute } from "./routes/insights.js";
import { profileRoute } from "./routes/profile.js";
import { ogRoute } from "./routes/og.js";
import { badgeRoute } from "./routes/badge.js";
import type { StoryGenerate } from "./lib/story.js";

export interface AppDeps {
  db: DB;
  store: LeaderboardStore;
  insightsStore?: InsightsStore;
  onIngest: () => void;
  // Shared with index.ts so the timer that refreshes the stale-daemon report
  // and the route that serves it are the same instance. Omitted in tests, which
  // get a fresh per-route instance that computes lazily on first request.
  daemonHealth?: DaemonHealth;
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
  // Server-owned PAT for public GitHub-stats reads (fallback when a user's
  // OAuth token isn't stored). Absent → user tokens only.
  githubToken?: string;
  // Story generation (#50): absent → transcripts stored dormant.
  storyGenerate?: StoryGenerate;
}

export function createApp(deps?: AppDeps) {
  const app = new Hono();

  // Outermost middleware so the span covers cors, etag and the handler. Names
  // spans by matched route rather than raw path, which the node http
  // auto-instrumentation cannot do. No-ops when no SDK is registered, so tests
  // and local runs pay nothing.
  app.use("*", httpInstrumentationMiddleware());

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

  // rss/heapUsed expose live memory so RSS tuning (heap caps, cache changes)
  // is observable with a curl instead of the Railway dashboard.
  app.get("/health", (c) => {
    const mem = process.memoryUsage();
    return c.json({ status: "ok", rss: mem.rss, heapUsed: mem.heapUsed });
  });
  app.route("/", installerRoute());
  app.route("/telemetry", telemetryRoute(deps?.store));
  if (deps) {
    app.route("/ingest", ingestRoute(deps.db, deps.store, deps.onIngest));
    // Stale-daemon detection (issue #91) — shares the /telemetry prefix with the
    // beacon route; the scheduled health workflow polls /telemetry/stale-daemons.
    app.route("/telemetry", deps.daemonHealth?.route ?? daemonHealthRoute(deps.db));
    app.route("/leaderboard", leaderboardRoute(deps.store));
    app.route("/admin", adminRoute(deps.db, deps.store, deps.onIngest));
    app.route("/sponsors", sponsorsRoute(deps.db));
    if (deps.insightsStore) {
      app.route(
        "/insights",
        insightsRoute({
          db: deps.db,
          insightsStore: deps.insightsStore,
          store: deps.store,
          sessionSecret: deps.auth?.clientSecret,
          storyGenerate: deps.storyGenerate,
        }),
      );
      app.route(
        "/profile",
        profileRoute({
          db: deps.db,
          store: deps.store,
          insightsStore: deps.insightsStore,
          sessionSecret: deps.auth?.clientSecret,
          githubToken: deps.githubToken ?? null,
        }),
      );
    }
    app.route("/og", ogRoute(deps.db, deps.store, deps.auth?.webBaseUrl ?? "https://ccwarriors.xyz"));
    app.route("/badge", badgeRoute(deps.store));
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
