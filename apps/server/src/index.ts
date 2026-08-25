import { serve } from "@hono/node-server";
import { WebSocketServer } from "ws";
import { eq, gte, sql } from "drizzle-orm";
import { parseConfig } from "./config.js";
import { createDbFromEnv } from "./db/index.js";
import { users, orgMembers, userInsights, usageDays } from "./db/schema.js";
import { LeaderboardStore, craftEntryFor } from "./lib/leaderboard-store.js";
import { InsightsStore } from "./lib/insights-store.js";
import { createApp } from "./app.js";
import { generateStory } from "./lib/story.js";
import { computeSpark } from "./lib/spark.js";
import { BOARD_DAYS } from "./services/ingest.js";
import { attachBroadcast } from "./ws/broadcast.js";
import { seedDemo, seedDemoDonations, seedDemoProfiles, startSimulation } from "./seed.js";
import { startPricingRefresh } from "./lib/pricing.js";
import { startFxRefresh } from "./lib/fx.js";
import { startRetention } from "./services/retention.js";
import { createDaemonHealth } from "./routes/daemon-health.js";
import { captureEvent } from "./routes/telemetry.js";

async function main() {
  const cfg = parseConfig(process.env);
  const db = await createDbFromEnv(cfg.databaseUrl);
  const store = new LeaderboardStore();
  const insightsStore = new InsightsStore();

  // Local/demo only — never enabled in production.
  if (cfg.seedDemo) {
    seedDemo(store);
    await seedDemoDonations(db);
    await seedDemoProfiles(db);
  }

  // Dev-only: a DB-backed user with a known CLI token, so the real CLI and
  // curl can exercise /ingest against a local server (SEED_CLI_TOKEN=devtoken).
  const devToken = process.env["SEED_CLI_TOKEN"];
  if (devToken && cfg.seedDemo) {
    const { hashToken } = await import("./lib/token.js");
    await db
      .insert(users)
      .values({ githubId: "dev-1", githubLogin: "devwarrior", cliTokenHash: hashToken(devToken) })
      .onConflictDoNothing();
    console.log("seeded dev user 'devwarrior' with SEED_CLI_TOKEN");
  }

  // Warm the store from Postgres (real users). Tolerate an unmigrated/empty DB.
  // Legacy rows (no tool_breakdown) derive an all-claude breakdown at load —
  // no destructive backfill, the next sync overwrites it correctly anyway.
  try {
    // Explicit column list: SELECT * dragged github_access_token, pinned_cards,
    // flag_reason, etc. through the boot transient for every user — real peak
    // RSS on a memory-billed host. Only what the store needs rides along.
    const rows = await db
      .select({
        id: users.id,
        githubLogin: users.githubLogin,
        avatarUrl: users.avatarUrl,
        xHandle: users.xHandle,
        tier: users.tier,
        cardScene: users.cardScene,
        cost30d: users.cost30d,
        costAllTime: users.costAllTime,
        toolBreakdown: users.toolBreakdown,
        flaggedAt: users.flaggedAt,
        lastSyncedAt: users.lastSyncedAt,
        insightsConsent: users.insightsConsent,
        insightsVisibility: users.insightsVisibility,
        craftScore: users.craftScore,
      })
      .from(users);
    // Verified org memberships ride along into the store (org boards + badges).
    const orgRows = await db.select().from(orgMembers);
    const orgsByUser = new Map<string, string[]>();
    for (const m of orgRows) {
      orgsByUser.set(m.userId, [...(orgsByUser.get(m.userId) ?? []), m.orgSlug]);
    }
    for (const u of rows) {
      const cost30d = Number(u.cost30d);
      const breakdown = u.toolBreakdown
        ? Object.fromEntries(
            Object.entries(u.toolBreakdown)
              .filter(([, v]) => v.cost30d > 0)
              .map(([k, v]) => [k, v.cost30d]),
          )
        : cost30d > 0
          ? { claude: cost30d }
          : {};
      store.upsert({
        id: u.id,
        githubLogin: u.githubLogin,
        avatarUrl: u.avatarUrl,
        xHandle: u.xHandle,
        tier: u.tier,
        cardScene: u.cardScene,
        cost30d,
        costAllTime: Number(u.costAllTime),
        breakdown,
        flagged: !!u.flaggedAt,
        orgs: orgsByUser.get(u.id) ?? [],
        lastSyncedAt: u.lastSyncedAt?.getTime(),
        craft: craftEntryFor(u),
      });
    }
    // Warm insights (consented users only — revokes deleted their rows).
    const insightRows = await db.select().from(userInsights);
    for (const r of insightRows) insightsStore.upsert(r.userId, r.machineId, r.payload);
  } catch (err) {
    console.warn("store warm-up skipped:", (err as Error).message);
  }

  // Attach 30d sparks to all entries loaded above. Separate try: a spark
  // failure must not prevent the server from starting.
  try {
    const cutoff30 = new Date(Date.now() - BOARD_DAYS * 86_400_000).toISOString().slice(0, 10);
    const sparkRows = await db
      .select({
        userId: usageDays.userId,
        day: usageDays.day,
        cost: sql<number>`sum(${usageDays.cost})`,
      })
      .from(usageDays)
      .where(gte(usageDays.day, cutoff30))
      .groupBy(usageDays.userId, usageDays.day);
    // Group by user.
    const byUser = new Map<string, Array<{ day: string; cost: number }>>();
    for (const r of sparkRows) {
      const list = byUser.get(r.userId) ?? [];
      list.push({ day: r.day, cost: Number(r.cost) });
      byUser.set(r.userId, list);
    }
    const now = new Date();
    for (const [userId, dayRows] of byUser) {
      const entry = store.get(userId);
      if (!entry) continue;
      const spark = computeSpark(dayRows, now);
      if (spark) store.upsert({ ...entry, spark });
    }
  } catch (err) {
    console.warn("spark warm-up skipped:", (err as Error).message);
  }

  // Keep model pricing current (committed snapshot already loaded at import).
  // Emit a per-refresh signal for any hand-priced override still shadowing
  // LiteLLM — its disappearance is how we learn upstream priced the model and
  // the override can be removed (see lib/pricing.ts `activeOverrides`).
  startPricingRefresh((activeModels) => {
    for (const model of activeModels) {
      captureEvent("price_override_active", "system", { model });
    }
  });
  // Keep the donation USD→INR rate current (fallback constant until first fetch).
  startFxRefresh();
  // Prune old sync snapshots daily (first run delayed past boot hydration).
  startRetention(db);

  // The stale-daemon report is a 7-day aggregate over `snapshots`. Computing it
  // on a timer keeps it off the request path, so the hourly health check reads
  // a precomputed value instead of paying for the scan every single poll.
  const daemonHealth = createDaemonHealth(db);
  daemonHealth.start();

  // permessage-deflate is OFF: each socket's zlib context costs ~200-400KB RSS
  // and fragments the allocator (a well-known `ws` memory issue). Memory is
  // ~90% of the Railway bill; the ~6× larger payload every 15s is far cheaper
  // (egress is $0.05/GB) than the resident zlib state. Clients that negotiated
  // compression before simply receive uncompressed frames — no protocol break.
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
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

  let donateDeps: { keyId: string; keySecret: string; webhookSecret?: string } | undefined;
  if (cfg.razorpayKeyId && cfg.razorpayKeySecret) {
    donateDeps = {
      keyId: cfg.razorpayKeyId,
      keySecret: cfg.razorpayKeySecret,
      webhookSecret: cfg.razorpayWebhookSecret,
    };
    if (!cfg.razorpayWebhookSecret) console.log("donations: webhook disabled (no secret)");
  } else {
    console.log("donations: disabled (no razorpay keys)");
  }

  // Org verification needs Discord creds plus the session secret (GitHub's).
  let discordDeps:
    | { clientId: string; clientSecret: string; sessionSecret: string; publicBaseUrl: string; webBaseUrl: string }
    | undefined;
  if (cfg.discordClientId && cfg.discordClientSecret && cfg.githubClientSecret) {
    discordDeps = {
      clientId: cfg.discordClientId,
      clientSecret: cfg.discordClientSecret,
      sessionSecret: cfg.githubClientSecret,
      publicBaseUrl: cfg.publicBaseUrl,
      webBaseUrl: cfg.webBaseUrl,
    };
  } else {
    console.log("discord oauth: disabled (no credentials)");
  }

  const app = createApp({
    daemonHealth,
    db,
    store,
    insightsStore,
    onIngest: broadcast,
    corsOrigin: cfg.corsOrigin,
    auth: authDeps,
    donate: donateDeps,
    discord: discordDeps,
    githubToken: cfg.githubToken,
    storyGenerate: cfg.anthropicApiKey
      ? (login, source) =>
          generateStory({ apiKey: cfg.anthropicApiKey!, model: cfg.storyModel }, login, source)
      : undefined,
  });

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
