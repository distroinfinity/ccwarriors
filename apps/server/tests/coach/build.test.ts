import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { buildCoach } from "../../src/lib/coach/build.js";
import { clearBenchmarkCache } from "../../src/lib/coach/benchmark.js";
import { makeDb, seedUser } from "../helpers/db.js";
import { users, usageDays } from "../../src/db/schema.js";

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
