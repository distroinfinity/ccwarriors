import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { ingestRoute } from "../src/routes/ingest.js";
import { eq } from "drizzle-orm";
import { makeDb, seedUser } from "./helpers/db.js";
import { ingestUsage, resetSnapshotThrottle, SNAPSHOT_INTERVAL_MS, type RawIngestPayload } from "../src/services/ingest.js";
import { LeaderboardStore } from "../src/lib/leaderboard-store.js";
import { users, usageDays, snapshots, orgMembers } from "../src/db/schema.js";
import { lookupModelPrice } from "../src/lib/pricing.js";

const TOKEN = "tok_test";
const NOW = Date.UTC(2026, 5, 4, 12, 0, 0); // 2026-06-04T12:00Z

function isoDaysAgo(n: number): string {
  return new Date(NOW - n * 86_400_000).toISOString().slice(0, 10);
}

// One model-day worth exactly its token math at the snapshot's opus pricing.
const OPUS = "claude-opus-4-8";
const opusDay = (date: string, outputTokens = 1_000_000) => ({
  date,
  models: [
    {
      modelName: OPUS,
      inputTokens: 1_000_000,
      outputTokens,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    },
  ],
});

function expectedOpusCost(outputTokens = 1_000_000): number {
  const p = lookupModelPrice(OPUS)!;
  return Math.round((1_000_000 * p.input + outputTokens * p.output) * 100) / 100;
}

describe("ingest v1 (legacy clients)", () => {
  let db: Awaited<ReturnType<typeof makeDb>>;
  let store: LeaderboardStore;

  beforeEach(async () => {
    db = await makeDb();
    store = new LeaderboardStore();
    await seedUser(db, { login: "legacy", token: TOKEN });
  });

  it("accepts the v1 payload unchanged and keeps tool_breakdown null", async () => {
    const res = await ingestUsage(db, store, TOKEN, {
      kind: "legacy",
      cost30d: 123.45,
      costAllTime: 456.78,
    }, NOW);
    expect(res.ok).toBe(true);
    // The response carries the user's acked deep-disclosure version (default 1)
    // so the CLI can adopt a consent given on the web.
    if (res.ok) expect(res.consentVersion).toBe(1);
    const [u] = await db.select().from(users).where(eq(users.githubLogin, "legacy"));
    expect(Number(u!.cost30d)).toBe(123.45);
    expect(u!.toolBreakdown).toBeNull();
    expect(u!.hasBreakdown).toBe(false);
    // Store derives an all-claude breakdown so per-tool boards still work.
    expect(store.getTop("30d", 10, 0, "claude")).toHaveLength(1);
  });

  it("still rejects out-of-bounds totals with implausible (422 path)", async () => {
    const res = await ingestUsage(db, store, TOKEN, {
      kind: "legacy",
      cost30d: 2_000_000,
      costAllTime: 0,
    }, NOW);
    expect(res).toEqual({ ok: false, error: "implausible" });
  });

  it("rate limits within 10s", async () => {
    await ingestUsage(db, store, TOKEN, { kind: "legacy", cost30d: 1, costAllTime: 1 }, NOW);
    const res = await ingestUsage(db, store, TOKEN, { kind: "legacy", cost30d: 2, costAllTime: 2 }, NOW + 5_000);
    expect(res).toEqual({ ok: false, error: "rate_limited" });
  });

  it("a legacy dollar jump no longer quarantines (gates are token-denominated)", async () => {
    await ingestUsage(db, store, TOKEN, { kind: "legacy", cost30d: 100, costAllTime: 100 }, NOW);
    // +$50k eleven seconds later. v1 clients send dollars only, and dollars are
    // not a stable quantity (LiteLLM reprices under us), so the burn gate no
    // longer runs here — the sanity cap is the remaining bound on this path.
    const res = await ingestUsage(
      db,
      store,
      TOKEN,
      { kind: "legacy", cost30d: 50_100, costAllTime: 50_100 },
      NOW + 11_000,
    );
    expect(res.ok).toBe(true);
    const [u] = await db.select().from(users).where(eq(users.githubLogin, "legacy"));
    expect(u!.flaggedAt).toBeNull();
    expect(store.getTop("30d", 10)).toHaveLength(1); // stays on the board
  });
});

describe("ingest v3 (raw token counts)", () => {
  let db: Awaited<ReturnType<typeof makeDb>>;
  let store: LeaderboardStore;

  const raw = (tools: RawIngestPayload["tools"], machineId = "aabbccdd00112233"): RawIngestPayload => ({
    kind: "raw",
    tools,
    machineId,
    clientBuildId: "test123",
  });

  beforeEach(async () => {
    db = await makeDb();
    store = new LeaderboardStore();
    await seedUser(db, { login: "modern", token: TOKEN });
  });

  it("prices days server-side and persists usage_days + breakdown", async () => {
    const res = await ingestUsage(
      db,
      store,
      TOKEN,
      raw({ claude: [opusDay(isoDaysAgo(1))], codex: [opusDay(isoDaysAgo(2), 500_000)] }),
      NOW,
    );
    expect(res.ok).toBe(true);

    const [u] = await db.select().from(users).where(eq(users.githubLogin, "modern"));
    expect(u!.hasBreakdown).toBe(true);
    expect(u!.clientBuildId).toBe("test123");
    const claude = expectedOpusCost();
    const codex = expectedOpusCost(500_000);
    expect(u!.toolBreakdown!["claude"]!.cost30d).toBeCloseTo(claude, 2);
    expect(u!.toolBreakdown!["codex"]!.cost30d).toBeCloseTo(codex, 2);
    expect(Number(u!.cost30d)).toBeCloseTo(claude + codex, 2);

    const rows = await db.select().from(usageDays);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.machineId === "aabbccdd00112233")).toBe(true);

    // Snapshot audit row carries the breakdown too.
    const [snap] = await db.select().from(snapshots);
    expect(snap!.toolBreakdown).not.toBeNull();

    // Per-tool board has the entry; a tool the user doesn't use does not.
    expect(store.getTop("30d", 10, 0, "codex")).toHaveLength(1);
    expect(store.getTop("30d", 10, 0, "gemini")).toHaveLength(0);
  });

  // snapshots was 87MB of a 102MB production database because the daemon writes
  // on fs.watch, not on the heartbeat — 400-900 syncs/user/day. Postgres memory
  // is ~90% of the Railway bill, so the row rate is a direct cost lever.
  it("writes at most one snapshot per user per hour", async () => {
    resetSnapshotThrottle();
    // Three syncs inside the hour → one row.
    await ingestUsage(db, store, TOKEN, raw({ claude: [opusDay(isoDaysAgo(1))] }), NOW);
    await ingestUsage(db, store, TOKEN, raw({ claude: [opusDay(isoDaysAgo(1))] }), NOW + 60_000);
    await ingestUsage(db, store, TOKEN, raw({ claude: [opusDay(isoDaysAgo(1))] }), NOW + 120_000);
    expect(await db.select().from(snapshots)).toHaveLength(1);

    // Past the interval → a second row.
    await ingestUsage(
      db,
      store,
      TOKEN,
      raw({ claude: [opusDay(isoDaysAgo(1))] }),
      NOW + SNAPSHOT_INTERVAL_MS,
    );
    expect(await db.select().from(snapshots)).toHaveLength(2);
  });

  it("stamps last_synced_at on EVERY sync, throttled snapshot or not", async () => {
    resetSnapshotThrottle();
    await ingestUsage(db, store, TOKEN, raw({ claude: [opusDay(isoDaysAgo(1))] }), NOW);
    // Suppressed snapshot, but freshness must still advance — this is the value
    // the stale-daemon report reads to decide whether a daemon has gone silent.
    await ingestUsage(db, store, TOKEN, raw({ claude: [opusDay(isoDaysAgo(1))] }), NOW + 60_000);
    expect(await db.select().from(snapshots)).toHaveLength(1);
    const [u] = await db.select().from(users).where(eq(users.githubLogin, "modern"));
    expect(u!.lastSyncedAt!.getTime()).toBe(NOW + 60_000);
  });

  it("re-syncing the same day is idempotent (upsert, not duplicate)", async () => {
    await ingestUsage(db, store, TOKEN, raw({ claude: [opusDay(isoDaysAgo(1))] }), NOW);
    await ingestUsage(db, store, TOKEN, raw({ claude: [opusDay(isoDaysAgo(1))] }), NOW + 60_000);
    const rows = await db.select().from(usageDays);
    expect(rows).toHaveLength(1);
    const [u] = await db.select().from(users).where(eq(users.githubLogin, "modern"));
    expect(Number(u!.cost30d)).toBeCloseTo(expectedOpusCost(), 2);
    // All-time must not double count an unchanged re-synced day.
    expect(Number(u!.costAllTime)).toBeCloseTo(expectedOpusCost(), 2);
  });

  it("a sync preserves org membership already in the store", async () => {
    const [u] = await db.select().from(users).where(eq(users.githubLogin, "modern"));
    store.upsert({
      id: u!.id,
      githubLogin: "modern",
      avatarUrl: "",
      xHandle: null,
      tier: "Stone",
      cardScene: "fujiNight",
      cost30d: 1,
      costAllTime: 1,
      orgs: ["ns"],
    });
    await ingestUsage(db, store, TOKEN, raw({ claude: [opusDay(isoDaysAgo(1))] }), NOW);
    expect(store.get(u!.id)?.orgs).toEqual(["ns"]);
  });

  it("first sync after boot loads org membership from the DB", async () => {
    const [u] = await db.select().from(users).where(eq(users.githubLogin, "modern"));
    await db.insert(orgMembers).values({ userId: u!.id, orgSlug: "ns", discordUserId: "d1" });
    // Store is cold: user verified via web before ever syncing.
    await ingestUsage(db, store, TOKEN, raw({ claude: [opusDay(isoDaysAgo(1))] }), NOW);
    expect(store.get(u!.id)?.orgs).toEqual(["ns"]);
  });

  it("unknown tool keys fold into 'other' instead of being dropped", async () => {
    await ingestUsage(db, store, TOKEN, raw({ "mystery-agent": [opusDay(isoDaysAgo(1))] }), NOW);
    const [u] = await db.select().from(users).where(eq(users.githubLogin, "modern"));
    expect(u!.toolBreakdown!["other"]).toBeDefined();
  });

  it("legacy→raw transition does not double count the overlapping window", async () => {
    // Legacy client reported ~$673 (≈ the same opus day the raw client will send).
    await ingestUsage(db, store, TOKEN, { kind: "legacy", cost30d: 700, costAllTime: 700 }, NOW - 86_400_000);
    await ingestUsage(db, store, TOKEN, raw({ claude: [opusDay(isoDaysAgo(1))] }), NOW);
    const [u] = await db.select().from(users).where(eq(users.githubLogin, "modern"));
    // max(legacy 700, window) — NOT 700 + window.
    expect(Number(u!.costAllTime)).toBeCloseTo(700, 2);
  });

  it("daily-ceiling gate quarantines a fabricated mega-day", async () => {
    // 25B tokens in one tool-day — past the 20B ceiling, but shaped like real
    // cache-heavy traffic so it's the ceiling that catches it, not token_shape.
    const megaDay = {
      date: isoDaysAgo(1),
      models: [
        {
          modelName: OPUS,
          inputTokens: 1_000_000,
          outputTokens: 1_000_000,
          cacheCreationTokens: 0,
          cacheReadTokens: 25_000_000_000,
        },
      ],
    };
    const res = await ingestUsage(db, store, TOKEN, raw({ claude: [megaDay] }), NOW);
    expect(res.ok).toBe(true);
    const [u] = await db.select().from(users).where(eq(users.githubLogin, "modern"));
    expect(u!.flagReason).toContain("daily_ceiling");
    expect(store.getTop("30d", 10)).toHaveLength(0);
  });

  it("new-tool backfill gate catches a fabricated 40-day history", async () => {
    // 10 days × 16B tokens = 160B for a tool we've never seen — over the 150B
    // backfill cap, while each single day stays under the 20B daily ceiling.
    const days = Array.from({ length: 10 }, (_, i) => ({
      date: isoDaysAgo(i + 1),
      models: [
        {
          modelName: OPUS,
          inputTokens: 0,
          outputTokens: 1_000_000,
          cacheCreationTokens: 0,
          cacheReadTokens: 15_999_000_000,
        },
      ],
    }));
    await ingestUsage(db, store, TOKEN, raw({ codex: days }), NOW);
    const [u] = await db.select().from(users).where(eq(users.githubLogin, "modern"));
    expect(u!.flagReason).toContain("new_tool_backfill");
  });

  it("a settled day that grows is reported but no longer quarantines", async () => {
    // history_rewrite is observation-only (see DEFAULT_QUARANTINE_REASONS): it
    // was the gate LiteLLM price drift tripped, taking 31 of 77 real users off
    // the board. The signal still fires into telemetry; the user stays ranked.
    const settled = isoDaysAgo(10);
    await ingestUsage(db, store, TOKEN, raw({ claude: [opusDay(settled)] }), NOW);
    await ingestUsage(
      db,
      store,
      TOKEN,
      raw({ claude: [opusDay(settled, 3_000_000)] }),
      NOW + 60_000,
    );
    const [u] = await db.select().from(users).where(eq(users.githubLogin, "modern"));
    expect(u!.flaggedAt).toBeNull();
    expect(store.getTop("30d", 10)).toHaveLength(1);
  });

  it("multi-machine days aggregate by sum instead of overwriting", async () => {
    await ingestUsage(db, store, TOKEN, raw({ claude: [opusDay(isoDaysAgo(1))] }, "aaaaaaaaaaaaaaaa"), NOW);
    await ingestUsage(
      db,
      store,
      TOKEN,
      raw({ claude: [opusDay(isoDaysAgo(1))] }, "bbbbbbbbbbbbbbbb"),
      NOW + 60_000,
    );
    const [u] = await db.select().from(users).where(eq(users.githubLogin, "modern"));
    expect(Number(u!.cost30d)).toBeCloseTo(expectedOpusCost() * 2, 2);
    const rows = await db.select().from(usageDays);
    expect(rows).toHaveLength(2);
  });

  it("first sync from a legitimate second machine is exempt from the burn gate", async () => {
    await ingestUsage(db, store, TOKEN, raw({ claude: [opusDay(isoDaysAgo(1))] }, "aaaaaaaaaaaaaaaa"), NOW - 3_600_000);
    const secondMachineDays = Array.from({ length: 10 }, (_, i) => opusDay(isoDaysAgo(i + 1)));
    const res = await ingestUsage(
      db,
      store,
      TOKEN,
      raw({ claude: secondMachineDays }, "bbbbbbbbbbbbbbbb"),
      NOW,
    );
    expect(res.ok).toBe(true);
    const [u] = await db.select().from(users).where(eq(users.githubLogin, "modern"));
    expect(u!.flaggedAt).toBeNull();
    const rows = await db.select().from(usageDays);
    expect(rows).toHaveLength(11);
  });

  it("first multi-tool sync is exempt from the burn gate for newly-appearing tools", async () => {
    // Established claude user…
    await ingestUsage(db, store, TOKEN, raw({ claude: [opusDay(isoDaysAgo(1))] }), NOW - 3_600_000);
    // …whose next sync suddenly includes a real codex history (new tool, $6.7k).
    const codexDays = Array.from({ length: 10 }, (_, i) => opusDay(isoDaysAgo(i + 1)));
    await ingestUsage(
      db,
      store,
      TOKEN,
      raw({ claude: [opusDay(isoDaysAgo(1))], codex: codexDays }),
      NOW,
    );
    const [u] = await db.select().from(users).where(eq(users.githubLogin, "modern"));
    expect(u!.flaggedAt).toBeNull(); // legit multi-tool adoption, not a rig
  });

  it("a NEW machine's first sync is exempt from the burn gate (2nd laptop backfill)", async () => {
    // Established on laptop A one hour ago.
    await ingestUsage(db, store, TOKEN, raw({ claude: [opusDay(isoDaysAgo(1))] }, "aaaaaaaaaaaaaaaa"), NOW - 3_600_000);
    // Enlists laptop B: its ~10-day backfill (~$6.7k) lands at once, minutes later.
    const backfill = Array.from({ length: 10 }, (_, i) => opusDay(isoDaysAgo(i + 1)));
    await ingestUsage(db, store, TOKEN, raw({ claude: backfill }, "bbbbbbbbbbbbbbbb"), NOW + 60_000);
    const [u] = await db.select().from(users).where(eq(users.githubLogin, "modern"));
    // The merge happened (sum of both machines) and the user was NOT flagged —
    // this is the Seungwoo321 case: a legit 2nd machine, not a rig.
    expect(u!.flaggedAt).toBeNull();
    expect(Number(u!.cost30d)).toBeCloseTo(expectedOpusCost() * 11, 2);
  });

  it("an EXISTING machine's implausible jump is reported but does not quarantine", async () => {
    await ingestUsage(db, store, TOKEN, raw({ claude: [opusDay(isoDaysAgo(1))] }, "aaaaaaaaaaaaaaaa"), NOW);
    // burn_rate is observation-only now — the same LiteLLM reprice that moved a
    // settled day also moved the whole 30d window between two heartbeats.
    await ingestUsage(
      db,
      store,
      TOKEN,
      raw({ claude: [opusDay(isoDaysAgo(1), 40_000_000)] }, "aaaaaaaaaaaaaaaa"),
      NOW + 11_000,
    );
    const [u] = await db.select().from(users).where(eq(users.githubLogin, "modern"));
    expect(u!.flaggedAt).toBeNull();
  });

  it("v1 sync after v3 doesn't double count (old client lumps all agents)", async () => {
    // v3 establishes claude + codex…
    await ingestUsage(
      db,
      store,
      TOKEN,
      raw({ claude: [opusDay(isoDaysAgo(1))], codex: [opusDay(isoDaysAgo(2), 500_000)] }),
      NOW - 60_000,
    );
    const claude = expectedOpusCost();
    const codex = expectedOpusCost(500_000);
    // …then a still-old client on the same account reports the LUMPED total
    // (ccusage v20 base aggregate = claude + codex) one minute later.
    const lumped = claude + codex;
    const res = await ingestUsage(
      db,
      store,
      TOKEN,
      { kind: "legacy", cost30d: lumped, costAllTime: lumped },
      NOW,
    );
    expect(res.ok).toBe(true);
    const [u] = await db.select().from(users).where(eq(users.githubLogin, "modern"));
    expect(u!.flaggedAt).toBeNull(); // burn gate must NOT fire on attribution shift
    expect(Number(u!.cost30d)).toBeCloseTo(lumped, 1); // total stable, not lumped+codex
    expect(u!.toolBreakdown!["claude"]!.cost30d).toBeCloseTo(claude, 1);
    expect(u!.toolBreakdown!["codex"]!.cost30d).toBeCloseTo(codex, 1);
  });

  it("stores the server-computed price even when a ccusage estimate is sent", async () => {
    // Estimates are a cross-check signal, never the ranked value — a client
    // shading every day to 1.24x computed gains exactly nothing.
    const day = { ...opusDay(isoDaysAgo(1)), costEstimate: expectedOpusCost() * 1.24 };
    await ingestUsage(db, store, TOKEN, raw({ claude: [day] }), NOW);
    const [u] = await db.select().from(users).where(eq(users.githubLogin, "modern"));
    expect(Number(u!.cost30d)).toBeCloseTo(expectedOpusCost(), 2);
    expect(u!.flaggedAt).toBeNull();
  });

  it("emits estimate_mismatch telemetry when the estimate diverges beyond the band", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const day = { ...opusDay(isoDaysAgo(1)), costEstimate: 50_000 }; // tokens say ~$675
      await ingestUsage(db, store, TOKEN, raw({ claude: [day] }), NOW);
      const lines = logSpy.mock.calls.map((c) => String(c[0]));
      expect(lines.some((l) => l.includes("estimate_mismatch"))).toBe(true);
      const [u] = await db.select().from(users).where(eq(users.githubLogin, "modern"));
      expect(Number(u!.cost30d)).toBeCloseTo(expectedOpusCost(), 2); // value untouched
      expect(u!.flaggedAt).toBeNull(); // signal, not quarantine
    } finally {
      logSpy.mockRestore();
    }
  });

  it("surfaces unknown model names as unknown_model_priced telemetry", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const day = {
        date: isoDaysAgo(1),
        models: [
          {
            modelName: "totally-made-up-9000",
            inputTokens: 1_000_000,
            outputTokens: 1_000_000,
            cacheCreationTokens: 0,
            cacheReadTokens: 0,
          },
        ],
      };
      await ingestUsage(db, store, TOKEN, raw({ claude: [day] }), NOW);
      const lines = logSpy.mock.calls.map((c) => String(c[0]));
      expect(lines.some((l) => l.includes("unknown_model_priced") && l.includes("totally-made-up-9000"))).toBe(true);
      const [u] = await db.select().from(users).where(eq(users.githubLogin, "modern"));
      expect(Number(u!.cost30d)).toBeCloseTo(18, 1); // default-rate priced, not zero
      expect(u!.flaggedAt).toBeNull(); // non-quarantining
    } finally {
      logSpy.mockRestore();
    }
  });

  it("returns unauthorized for a bad token", async () => {
    const res = await ingestUsage(db, store, "nope", raw({ claude: [opusDay(isoDaysAgo(1))] }), NOW);
    expect(res).toEqual({ ok: false, error: "unauthorized" });
  });
});

describe("spark on ingest v3", () => {
  let db: Awaited<ReturnType<typeof makeDb>>;
  let store: LeaderboardStore;

  const raw = (tools: RawIngestPayload["tools"], machineId = "aabbccdd00112233"): RawIngestPayload => ({
    kind: "raw",
    tools,
    machineId,
  });

  beforeEach(async () => {
    db = await makeDb();
    store = new LeaderboardStore();
    await seedUser(db, { login: "sparkuser", token: TOKEN });
  });

  it("store entry has a spark array of length 8 after a raw sync with spend", async () => {
    const res = await ingestUsage(db, store, TOKEN, raw({ claude: [opusDay(isoDaysAgo(1))] }), NOW);
    expect(res.ok).toBe(true);
    const [u] = await db.select().from(users).where(eq(users.githubLogin, "sparkuser"));
    const entry = store.get(u!.id);
    expect(entry?.spark).toHaveLength(8);
  });

  it("the bucket containing the synced day has a nonzero level", async () => {
    await ingestUsage(db, store, TOKEN, raw({ claude: [opusDay(isoDaysAgo(1))] }), NOW);
    const [u] = await db.select().from(users).where(eq(users.githubLogin, "sparkuser"));
    const spark = store.get(u!.id)?.spark;
    expect(spark).toBeDefined();
    // At least one bucket must be nonzero (day 1 ago is always in the 30d window)
    expect(spark!.some((v) => v > 0)).toBe(true);
  });

  it("legacy sync carries forward an existing spark from the store", async () => {
    // First a raw sync to establish a spark
    await ingestUsage(db, store, TOKEN, raw({ claude: [opusDay(isoDaysAgo(1))] }), NOW);
    const [u] = await db.select().from(users).where(eq(users.githubLogin, "sparkuser"));
    const sparkBefore = store.get(u!.id)?.spark;
    expect(sparkBefore).toBeDefined();

    // Now a legacy sync — spark must be preserved
    await ingestUsage(
      db,
      store,
      TOKEN,
      { kind: "legacy", cost30d: expectedOpusCost(), costAllTime: expectedOpusCost() },
      NOW + 60_000,
    );
    const sparkAfter = store.get(u!.id)?.spark;
    expect(sparkAfter).toEqual(sparkBefore);
  });
});

describe("craft score carry-through on cost sync", () => {
  let db: Awaited<ReturnType<typeof makeDb>>;
  let store: LeaderboardStore;

  const raw = (tools: RawIngestPayload["tools"]): RawIngestPayload => ({
    kind: "raw",
    tools,
    machineId: "aabbccdd00112233",
  });

  beforeEach(async () => {
    db = await makeDb();
    store = new LeaderboardStore();
    await seedUser(db, { login: "crafter", token: TOKEN });
  });

  it("cost sync preserves craft for a public+consented user with a DB craftScore", async () => {
    // Seed the user with craft score, consent, and public visibility.
    const [u] = await db.select().from(users).where(eq(users.githubLogin, "crafter"));
    await db.update(users).set({ insightsConsent: true, insightsVisibility: "public", craftScore: "72" }).where(eq(users.id, u!.id));

    const res = await ingestUsage(db, store, TOKEN, raw({ claude: [opusDay(isoDaysAgo(1))] }), NOW);
    expect(res.ok).toBe(true);
    const entry = store.get(u!.id);
    expect(entry?.craft).toBeDefined();
    expect(entry?.craft?.score).toBe(72);
    expect(typeof entry?.craft?.tier).toBe("string");
  });

  it("cost sync does NOT set craft for a private-visibility user (even with craftScore in DB)", async () => {
    const [u] = await db.select().from(users).where(eq(users.githubLogin, "crafter"));
    await db.update(users).set({ insightsConsent: true, insightsVisibility: "private", craftScore: "72" }).where(eq(users.id, u!.id));

    await ingestUsage(db, store, TOKEN, raw({ claude: [opusDay(isoDaysAgo(1))] }), NOW);
    const entry = store.get(u!.id);
    expect(entry?.craft).toBeUndefined();
  });

  it("cost sync does NOT set craft when craftScore is null", async () => {
    const [u] = await db.select().from(users).where(eq(users.githubLogin, "crafter"));
    await db.update(users).set({ insightsConsent: true, insightsVisibility: "public", craftScore: null }).where(eq(users.id, u!.id));

    await ingestUsage(db, store, TOKEN, raw({ claude: [opusDay(isoDaysAgo(1))] }), NOW);
    expect(store.get(u!.id)?.craft).toBeUndefined();
  });
});

describe("POST /ingest route validation", () => {
  let app: Hono;

  beforeEach(async () => {
    const db = await makeDb();
    const store = new LeaderboardStore();
    await seedUser(db, { login: "modern", token: TOKEN });
    app = new Hono();
    app.route("/ingest", ingestRoute(db, store, () => {}));
  });

  const post = (body: unknown) =>
    app.request("/ingest", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(body),
    });

  // The route runs on real wall-clock time — derive the day from it so the
  // fixture never ages out of the 40-day ingest window.
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

  it("rejects a v3 payload without machineId (no empty-machine collisions)", async () => {
    const res = await post({ tools: { claude: [opusDay(yesterday)] }, clientBuildId: "x" });
    expect(res.status).toBe(400);
  });

  it("accepts a v3 payload with machineId", async () => {
    const res = await post({
      tools: { claude: [opusDay(yesterday)] },
      machineId: "aabbccdd00112233",
    });
    expect(res.status).toBe(200);
  });

  it("accepts a v1 payload without machineId (legacy clients)", async () => {
    const res = await post({ cost30d: 10, costAllTime: 20 });
    expect(res.status).toBe(200);
  });

  it("rejects a payload with neither tools nor totals", async () => {
    const res = await post({ ccusageVersion: "x" });
    expect(res.status).toBe(400);
  });
});
