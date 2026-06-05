import { serve } from "@hono/node-server";
import { WebSocketServer } from "ws";
import { parseConfig } from "./config.js";
import { createDbFromEnv } from "./db/index.js";
import { users, orgMembers } from "./db/schema.js";
import { LeaderboardStore } from "./lib/leaderboard-store.js";
import { createApp } from "./app.js";
import { attachBroadcast } from "./ws/broadcast.js";
import { seedDemo, seedDemoDonations, startSimulation } from "./seed.js";
import { startPricingRefresh } from "./lib/pricing.js";
import { startFxRefresh } from "./lib/fx.js";

async function main() {
  const cfg = parseConfig(process.env);
  const db = await createDbFromEnv(cfg.databaseUrl);
  const store = new LeaderboardStore();

  // Local/demo only — never enabled in production.
  if (cfg.seedDemo) {
    seedDemo(store);
    await seedDemoDonations(db);
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
    const rows = await db.select().from(users);
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
      });
    }
  } catch (err) {
    console.warn("store warm-up skipped:", (err as Error).message);
  }

  // Keep model pricing current (committed snapshot already loaded at import).
  startPricingRefresh();
  // Keep the donation USD→INR rate current (fallback constant until first fetch).
  startFxRefresh();

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
    db,
    store,
    onIngest: broadcast,
    corsOrigin: cfg.corsOrigin,
    auth: authDeps,
    donate: donateDeps,
    discord: discordDeps,
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
