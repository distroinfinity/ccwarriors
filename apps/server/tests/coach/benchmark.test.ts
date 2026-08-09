import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import {
  percentileRank, makeBenchmarks, loadCohortDistributions, COHORT_MIN_POPULATION,
} from "../../src/lib/coach/benchmark.js";
import { makeDb, seedUser } from "../helpers/db.js";
import { users, usageDays, userDeepSessions } from "../../src/db/schema.js";

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

describe("loadCohortDistributions deep metrics", () => {
  it("emits revertRatio + dollarPerSurvivingLine per consenting public deep user", async () => {
    const db = await makeDb();
    // helper: a consenting public user with cost + one git session
    async function pub(login: string, cost: string, added: number, reverted: number) {
      await seedUser(db, { login, token: `t-${login}`, githubId: login });
      await db.update(users)
        .set({ insightsConsent: true, insightsVisibility: "public", insightsMode: "deep" })
        .where(eq(users.githubLogin, login));
      const [u] = await db.select().from(users).where(eq(users.githubLogin, login));
      await db.insert(usageDays).values({
        userId: u!.id, machineId: "m", tool: "claude", day: "2026-06-10",
        inputTokens: 10, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 90, cost,
      });
      await db.insert(userDeepSessions).values({
        userId: u!.id, machineId: "m", windowDays: 30,
        sessions: [{
          startHour: 9, durationMinutes: 10, prompts: 1, interrupts: 0, usedPlanMode: false,
          exploreBeforeFirstEdit: false, hadEdits: true, subagentSpawns: 0, maxParallel: 0,
          editCalls: 1, assistantTurns: 3, wordBuckets: { "1-5": 1, "6-10": 0, "11-25": 0, "26+": 0 },
          model: "claude-opus-4-7", timing: { events: 2, medianGapMs: 1, p10GapMs: 1, subSecondFraction: 0 },
          tool: "claude",
          git: {
            repoIdHash: "r", branchHash: "b", commitsInWindow: 2, linesAdded: added, linesDeleted: 0,
            filesChanged: 1, testFilesTouched: 0, aiLinkedCommits: 2, revertedLinesWithin14d: reverted,
            squashMergeDetected: false, rebaseDetected: false, isMonorepo: false, hasRemote: true,
          },
        }],
      });
    }
    await pub("cohortA", "100", 1000, 100); // revert 0.1, $/surviving = 100/900 ≈ 0.111
    await pub("cohortB", "200", 500, 0);     // revert 0.0, $/surviving = 200/500 = 0.4

    const dist = await loadCohortDistributions(db, Date.UTC(2026, 5, 15));
    expect(dist.revertRatio).toEqual(expect.arrayContaining([0.1, 0]));
    expect(dist.revertRatio.length).toBe(2);
    expect(dist.dollarPerSurvivingLine.length).toBe(2);
    expect(Math.min(...dist.dollarPerSurvivingLine)).toBeCloseTo(0.111, 2);
    expect(Math.max(...dist.dollarPerSurvivingLine)).toBeCloseTo(0.4, 5);
  });

  it("combines a user's multiple machines into one datapoint", async () => {
    const db = await makeDb();
    await seedUser(db, { login: "multi", token: "t-multi", githubId: "multi" });
    await db.update(users)
      .set({ insightsConsent: true, insightsVisibility: "public", insightsMode: "deep" })
      .where(eq(users.githubLogin, "multi"));
    const [u] = await db.select().from(users).where(eq(users.githubLogin, "multi"));
    await db.insert(usageDays).values({
      userId: u!.id, machineId: "m1", tool: "claude", day: "2026-06-10",
      inputTokens: 10, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 90, cost: "100",
    });
    const mkSession = (added: number, reverted: number) => ({
      startHour: 9, durationMinutes: 10, prompts: 1, interrupts: 0, usedPlanMode: false,
      exploreBeforeFirstEdit: false, hadEdits: true, subagentSpawns: 0, maxParallel: 0,
      editCalls: 1, assistantTurns: 3, wordBuckets: { "1-5": 1, "6-10": 0, "11-25": 0, "26+": 0 },
      model: "claude-opus-4-7", timing: { events: 2, medianGapMs: 1, p10GapMs: 1, subSecondFraction: 0 },
      tool: "claude",
      git: {
        repoIdHash: "r", branchHash: "b", commitsInWindow: 2, linesAdded: added, linesDeleted: 0,
        filesChanged: 1, testFilesTouched: 0, aiLinkedCommits: 2, revertedLinesWithin14d: reverted,
        squashMergeDetected: false, rebaseDetected: false, isMonorepo: false, hasRemote: true,
      },
    });
    await db.insert(userDeepSessions).values([
      { userId: u!.id, machineId: "m1", windowDays: 30, sessions: [mkSession(600, 100)] },
      { userId: u!.id, machineId: "m2", windowDays: 30, sessions: [mkSession(400, 0)] },
    ]);
    const dist = await loadCohortDistributions(db, Date.UTC(2026, 5, 15));
    // Combined across machines: added=1000, reverted=100 => revert 0.1; surviving=900; cost=100 => ~0.111.
    expect(dist.revertRatio).toEqual([0.1]);
    expect(dist.dollarPerSurvivingLine.length).toBe(1);
    expect(dist.dollarPerSurvivingLine[0]).toBeCloseTo(0.111, 2);
  });
});
