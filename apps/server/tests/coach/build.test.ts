import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { buildCoach } from "../../src/lib/coach/build.js";
import { clearBenchmarkCache } from "../../src/lib/coach/benchmark.js";
import { makeDb, seedUser } from "../helpers/db.js";
import { users, usageDays, userDeepSessions } from "../../src/db/schema.js";
import { sess, git } from "./deep-fixtures.js";

const NOW = Date.UTC(2026, 5, 15, 12, 0, 0);

async function user(db: Awaited<ReturnType<typeof makeDb>>, login: string, mode = "off") {
  await seedUser(db, { login, token: `tk-${login}`, githubId: login });
  await db.update(users).set({ insightsConsent: true, insightsMode: mode }).where(eq(users.githubLogin, login));
  const [u] = await db.select().from(users).where(eq(users.githubLogin, login));
  return u!;
}

beforeEach(() => clearBenchmarkCache());

describe("buildCoach", () => {
  it("returns an owner feed + dashboard with a model-mix module and locked Tier-2 teasers", async () => {
    const db = await makeDb();
    const u = await user(db, "owner", "off"); // not deep => Tier-2 locked
    await db.insert(usageDays).values({
      userId: u.id, machineId: "m", tool: "claude", day: "2026-06-10",
      inputTokens: 1_000_000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 1_000_000,
      cost: "50", modelBreakdown: [{ modelName: "claude-opus-4-7", inputTokens: 1_000_000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 1_000_000 }],
    });
    const payload = await buildCoach(db, u, true, NOW);
    expect(payload.isOwner).toBe(true);
    expect(payload.deepModeLocked).toBe(true);
    expect(payload.recommendations.length).toBeGreaterThan(0);
    expect(payload.recommendations.length).toBeLessThanOrEqual(3);
    expect(payload.modules.some((m) => m.id === "model-mix")).toBe(true);
    expect(payload.modules.some((m) => m.locked && m.tier === 2)).toBe(true);
    expect(payload.cohort.calibrated).toBe(false); // tiny cohort
  });

  it("hides owner-only recs and owner modules from public viewers", async () => {
    const db = await makeDb();
    const u = await user(db, "pubview", "off");
    await db.insert(usageDays).values({
      userId: u.id, machineId: "m", tool: "claude", day: "2026-06-10",
      inputTokens: 1_000_000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 100,
      cost: "50", modelBreakdown: [{ modelName: "claude-opus-4-7", inputTokens: 1_000_000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 100 }],
    });
    const payload = await buildCoach(db, u, false, NOW);
    expect(payload.isOwner).toBe(false);
    expect(payload.recommendations).toEqual([]);                       // no feed for public
    expect(payload.modules.every((m) => m.visibility === "public")).toBe(true);
    expect(payload.modules.some((m) => m.locked)).toBe(false);          // no locked teasers for public
  });
});

describe("buildCoach deep mode (Tier-2)", () => {
  async function deepOwner(db: Awaited<ReturnType<typeof makeDb>>) {
    await seedUser(db, { login: "deep", token: "tk-deep", githubId: "deep" });
    await db.update(users).set({ insightsConsent: true, insightsVisibility: "public", insightsMode: "deep" })
      .where(eq(users.githubLogin, "deep"));
    const [u] = await db.select().from(users).where(eq(users.githubLogin, "deep"));
    await db.insert(usageDays).values({
      userId: u!.id, machineId: "m", tool: "claude", day: "2026-06-10",
      inputTokens: 1_000_000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 1_000_000,
      cost: "500", modelBreakdown: [{ modelName: "claude-opus-4-7", inputTokens: 1_000_000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 1_000_000 }],
    });
    // 6 git sessions with meaningful revert + surviving lines → fires waste-detector + cost-per-outcome.
    await db.insert(userDeepSessions).values({
      userId: u!.id, machineId: "m", windowDays: 30,
      sessions: Array.from({ length: 6 }, () => sess({
        estimatedCost: 0, git: git({ linesAdded: 100, revertedLinesWithin14d: 25, commitsInWindow: 2, hasRemote: true }),
      })),
    });
    return u!;
  }

  it("gives a deep owner real Tier-2 recs and no locked teasers", async () => {
    const db = await makeDb();
    const u = await deepOwner(db);
    const payload = await buildCoach(db, u, true, NOW);
    expect(payload.deepModeLocked).toBe(false);
    expect(payload.recommendations.some((r) => r.tier === 2)).toBe(true);
    expect(payload.modules.some((m) => m.locked && m.tier === 2)).toBe(false);
  });

  it("shows a public viewer only public modules (incl. cost-per-outcome), no feed", async () => {
    const db = await makeDb();
    const u = await deepOwner(db);
    const payload = await buildCoach(db, u, false, NOW);
    expect(payload.recommendations).toEqual([]);
    expect(payload.modules.every((m) => m.visibility === "public")).toBe(true);
    expect(payload.modules.some((m) => m.id === "cost-per-outcome")).toBe(true);
  });
});
