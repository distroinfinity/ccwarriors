import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import {
  percentileRank, makeBenchmarks, loadCohortDistributions, COHORT_MIN_POPULATION,
} from "../../src/lib/coach/benchmark.js";
import { makeDb, seedUser } from "../helpers/db.js";
import { users, usageDays } from "../../src/db/schema.js";

const NOW = Date.UTC(2026, 5, 15, 12, 0, 0); // 2026-06-15

describe("percentileRank", () => {
  it("counts members strictly below, normalized by population-1", () => {
    expect(percentileRank(50, [10, 20, 30, 40, 50])).toBe(100); // 4 below / 4
    expect(percentileRank(10, [10, 20, 30, 40, 50])).toBe(0);
    expect(percentileRank(35, [10, 20, 30, 40, 50])).toBe(75);  // 3 below / 4
  });
});

describe("makeBenchmarks", () => {
  it("returns null below the population floor and a rank at/above it", () => {
    const small = makeBenchmarks({ cacheReadRatio: Array(COHORT_MIN_POPULATION - 1).fill(0.5) });
    expect(small.rank("cacheReadRatio", 0.9)).toBeNull();
    const big = makeBenchmarks({ cacheReadRatio: Array(COHORT_MIN_POPULATION).fill(0).map((_, i) => i / 100) });
    const r = big.rank("cacheReadRatio", 0.15);
    expect(r).not.toBeNull();
    expect(r!.population).toBe(COHORT_MIN_POPULATION);
    expect(big.rank("unknownMetric", 1)).toBeNull();
  });

  it("exposes the cacheReadRatio cohort size as population", () => {
    expect(makeBenchmarks({ cacheReadRatio: [0.1, 0.2] }).population).toBe(2);
    expect(makeBenchmarks({}).population).toBe(0);
  });
});

describe("loadCohortDistributions", () => {
  it("computes window cache ratio per consenting public user, excluding others", async () => {
    const db = await makeDb();
    // consenting public user with a warm cache: cacheRead 9000 / (input 1000 + cacheRead 9000) = 0.9
    await seedUser(db, { login: "pub", token: "t1" });
    await db.update(users).set({ insightsConsent: true, insightsVisibility: "public" })
      .where(eq(users.githubLogin, "pub"));
    const [pub] = await db.select().from(users).where(eq(users.githubLogin, "pub"));
    await db.insert(usageDays).values({
      userId: pub!.id, machineId: "m", tool: "claude", day: "2026-06-10",
      inputTokens: 1000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 9000, cost: "5",
    });
    // private user — must be excluded
    await seedUser(db, { login: "priv", token: "t2", githubId: "priv" });
    await db.update(users).set({ insightsConsent: true, insightsVisibility: "private" })
      .where(eq(users.githubLogin, "priv"));
    const [priv] = await db.select().from(users).where(eq(users.githubLogin, "priv"));
    await db.insert(usageDays).values({
      userId: priv!.id, machineId: "m", tool: "claude", day: "2026-06-10",
      inputTokens: 9000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 1000, cost: "5",
    });

    const dist = await loadCohortDistributions(db, NOW);
    expect(dist["cacheReadRatio"]).toEqual([0.9]); // only the public user
  });
});
