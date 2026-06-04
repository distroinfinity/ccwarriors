import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { makeDb, seedUser } from "./helpers/db.js";
import { ingestUsage, type RawIngestPayload } from "../src/services/ingest.js";
import { LeaderboardStore } from "../src/lib/leaderboard-store.js";
import { users, usageDays, snapshots } from "../src/db/schema.js";
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

  it("burn-rate gate quarantines a legacy rigger without rejecting the sync", async () => {
    await ingestUsage(db, store, TOKEN, { kind: "legacy", cost30d: 100, costAllTime: 100 }, NOW);
    // +$50k eleven seconds later — impossible for a human.
    const res = await ingestUsage(
      db,
      store,
      TOKEN,
      { kind: "legacy", cost30d: 50_100, costAllTime: 50_100 },
      NOW + 11_000,
    );
    expect(res.ok).toBe(true); // shadow quarantine: no error feedback
    const [u] = await db.select().from(users).where(eq(users.githubLogin, "legacy"));
    expect(u!.flaggedAt).not.toBeNull();
    expect(u!.flagReason).toContain("burn_rate");
    expect(store.getTop("30d", 10)).toHaveLength(0); // off the board
    expect(store.count()).toBe(0);
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
    // ~$67k day from 2.2B output tokens — flagged, stored, hidden.
    const res = await ingestUsage(
      db,
      store,
      TOKEN,
      raw({ claude: [opusDay(isoDaysAgo(1), 2_200_000_000)] }),
      NOW,
    );
    expect(res.ok).toBe(true);
    const [u] = await db.select().from(users).where(eq(users.githubLogin, "modern"));
    expect(u!.flagReason).toContain("daily_ceiling");
    expect(store.getTop("30d", 10)).toHaveLength(0);
  });

  it("new-tool backfill gate catches a fabricated 40-day history", async () => {
    // 8 days × ~$2.9k (via cache reads — under the per-day and shape gates)
    // ≈ $23k for a tool we've never seen — over the $15k backfill cap.
    const days = Array.from({ length: 8 }, (_, i) => ({
      date: isoDaysAgo(i + 1),
      models: [
        {
          modelName: OPUS,
          inputTokens: 0,
          outputTokens: 1_000_000, // $25
          cacheCreationTokens: 0,
          cacheReadTokens: 5_700_000_000, // $2,850 at $0.5/M
        },
      ],
    }));
    await ingestUsage(db, store, TOKEN, raw({ codex: days }), NOW);
    const [u] = await db.select().from(users).where(eq(users.githubLogin, "modern"));
    expect(u!.flagReason).toContain("new_tool_backfill");
  });

  it("history-immutability gate flags a settled day that grows", async () => {
    const settled = isoDaysAgo(5);
    await ingestUsage(db, store, TOKEN, raw({ claude: [opusDay(settled)] }), NOW);
    // Same settled day, 3x the tokens, two days later.
    await ingestUsage(
      db,
      store,
      TOKEN,
      raw({ claude: [opusDay(settled, 3_000_000)] }),
      NOW + 60_000,
    );
    const [u] = await db.select().from(users).where(eq(users.githubLogin, "modern"));
    expect(u!.flagReason).toContain("history_rewrite");
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

  it("returns unauthorized for a bad token", async () => {
    const res = await ingestUsage(db, store, "nope", raw({ claude: [opusDay(isoDaysAgo(1))] }), NOW);
    expect(res).toEqual({ ok: false, error: "unauthorized" });
  });
});
