import { describe, it, expect } from "vitest";
import {
  PILLARS,
  PILLAR_WEIGHTS,
  computePillars,
  pillarDirection,
  pillarVerification,
  pillarAutonomy,
  pillarYield,
  pillarOrchestration,
  pillarThroughput,
  craftScore,
  pillarPercentiles,
  trustTierOf,
  outcomeEconomics,
  shipped,
  survivingLoc,
  verifiedTestSession,
  type CraftInput,
  type Pillars,
} from "../src/lib/craft-score.js";
import type { SessionRecord, SessionGitOutcome } from "../src/db/schema.js";

function git(over: Partial<SessionGitOutcome> = {}): SessionGitOutcome {
  return {
    repoIdHash: "abc",
    branchHash: "def",
    commitsInWindow: 2,
    linesAdded: 100,
    linesDeleted: 10,
    filesChanged: 5,
    testFilesTouched: 1,
    aiLinkedCommits: 2,
    revertedLinesWithin14d: 0,
    squashMergeDetected: false,
    rebaseDetected: false,
    isMonorepo: false,
    hasRemote: true,
    ...over,
  };
}

function record(over: Partial<SessionRecord> = {}): SessionRecord {
  return {
    startHour: 10,
    durationMinutes: 30,
    prompts: 4,
    interrupts: 0,
    usedPlanMode: false,
    exploreBeforeFirstEdit: false,
    hadEdits: false,
    subagentSpawns: 0,
    maxParallel: 0,
    editCalls: 0,
    assistantTurns: 8,
    wordBuckets: { "1-5": 1, "6-10": 1, "11-25": 1, "26+": 1 },
    model: "claude-opus-4-8",
    timing: { events: 9, medianGapMs: 1200, p10GapMs: 200, subSecondFraction: 0.1 },
    git: null,
    ...over,
  };
}

function input(over: Partial<CraftInput> = {}): CraftInput {
  return {
    sessions: [],
    windowCostUsd: 100,
    windowTokens: 1_000_000,
    cacheReadRatio: 0.5,
    opusShare: 0.35,
    ...over,
  };
}

describe("session helpers", () => {
  it("shipped requires git with commits", () => {
    expect(shipped(record({ git: null }))).toBe(false);
    expect(shipped(record({ git: git({ commitsInWindow: 0 }) }))).toBe(false);
    expect(shipped(record({ git: git({ commitsInWindow: 1 }) }))).toBe(true);
  });

  it("survivingLoc floors at 0 after reverts", () => {
    expect(survivingLoc(record({ git: git({ linesAdded: 100, revertedLinesWithin14d: 30 }) }))).toBe(70);
    expect(survivingLoc(record({ git: git({ linesAdded: 20, revertedLinesWithin14d: 50 }) }))).toBe(0);
    expect(survivingLoc(record({ git: null }))).toBe(0);
  });

  it("verifiedTestSession needs shipped + test files", () => {
    expect(verifiedTestSession(record({ git: git({ commitsInWindow: 1, testFilesTouched: 1 }) }))).toBe(true);
    expect(verifiedTestSession(record({ git: git({ commitsInWindow: 1, testFilesTouched: 0 }) }))).toBe(false);
    expect(verifiedTestSession(record({ git: git({ commitsInWindow: 0, testFilesTouched: 5 }) }))).toBe(false);
  });
});

describe("P1 Direction", () => {
  it("rewards mid-length prompts that explore then ship", () => {
    const sessions = [
      record({
        hadEdits: true,
        exploreBeforeFirstEdit: true,
        git: git({ commitsInWindow: 1 }),
        wordBuckets: { "1-5": 0, "6-10": 5, "11-25": 5, "26+": 0 }, // 100% mid
      }),
    ];
    // specDensity=1, exploreThenShip=1 → 100
    expect(pillarDirection(sessions)).toBe(100);
  });

  it("one-word spam and essays score the spec density low", () => {
    const sessions = [
      record({ hadEdits: false, wordBuckets: { "1-5": 8, "6-10": 0, "11-25": 0, "26+": 2 } }),
    ];
    // specDensity=0 (no mid), no edit sessions → exploreThenShip=0 → 0
    expect(pillarDirection(sessions)).toBe(0);
  });

  it("explored but did not ship gets no exploreThenShip credit", () => {
    const sessions = [
      record({
        hadEdits: true,
        exploreBeforeFirstEdit: true,
        git: null, // not shipped
        wordBuckets: { "1-5": 0, "6-10": 0, "11-25": 0, "26+": 0 },
      }),
    ];
    expect(pillarDirection(sessions)).toBe(0);
  });
});

describe("P2 Verification Rigor", () => {
  it("testCoupling = verified-test-sessions / shipped-sessions", () => {
    const sessions = [
      record({ git: git({ commitsInWindow: 1, testFilesTouched: 1, linesAdded: 0, revertedLinesWithin14d: 0 }) }),
      record({ git: git({ commitsInWindow: 1, testFilesTouched: 0, linesAdded: 0, revertedLinesWithin14d: 0 }) }),
    ];
    // testCoupling = 1/2 = 0.5, revertRate = 0 → 0.6*0.5 + 0.4*1 = 0.7 → 70
    expect(pillarVerification(sessions)).toBe(70);
  });

  it("reverts drag the score down via revertRate", () => {
    const sessions = [
      record({ git: git({ commitsInWindow: 1, testFilesTouched: 1, linesAdded: 100, revertedLinesWithin14d: 100 }) }),
    ];
    // testCoupling=1, revertRate=1 → 0.6*1 + 0.4*0 = 0.6 → 60
    expect(pillarVerification(sessions)).toBe(60);
  });

  it("no shipped sessions → testCoupling 0", () => {
    const sessions = [record({ git: null })];
    // testCoupling=0, no added → revertRate=0 → 0.4*1 = 0.4 → 40
    expect(pillarVerification(sessions)).toBe(40);
  });
});

describe("P3 Autonomy Calibration", () => {
  it("low floor when nothing shipped", () => {
    expect(pillarAutonomy([record({ git: null })])).toBe(20);
  });

  it("long surviving runs score high", () => {
    // assistantTurns/prompts = 50/2 = 25 → raw 100, no reverts → 100
    const sessions = [
      record({ prompts: 2, assistantTurns: 50, git: git({ commitsInWindow: 1, linesAdded: 100, revertedLinesWithin14d: 0 }) }),
    ];
    expect(pillarAutonomy(sessions)).toBe(100);
  });

  it("long runs that revert are penalized", () => {
    // raw 100, but high-autonomy revertRate = 1 → 100 * 0 = 0
    const sessions = [
      record({ prompts: 2, assistantTurns: 50, git: git({ commitsInWindow: 1, linesAdded: 100, revertedLinesWithin14d: 100 }) }),
    ];
    expect(pillarAutonomy(sessions)).toBe(0);
  });
});

describe("P4 Yield / Efficiency", () => {
  it("CRITICAL INVARIANT: raising tokens with fixed outcomes never raises P4", () => {
    const sessions = [
      record({ git: git({ commitsInWindow: 5, linesAdded: 500, revertedLinesWithin14d: 0 }) }),
    ];
    const base = input({ sessions, windowTokens: 1_000_000, windowCostUsd: 100 });
    const scores = [
      pillarYield(base),
      pillarYield({ ...base, windowTokens: 2_000_000 }),
      pillarYield({ ...base, windowTokens: 5_000_000 }),
      pillarYield({ ...base, windowTokens: 20_000_000 }),
    ];
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]!).toBeLessThanOrEqual(scores[i - 1]!);
    }
  });

  it("CRITICAL INVARIANT: raising cost with fixed outcomes never raises P4", () => {
    const sessions = [
      record({ git: git({ commitsInWindow: 5, linesAdded: 500, revertedLinesWithin14d: 0 }) }),
    ];
    const base = input({ sessions, windowCostUsd: 10, windowTokens: 100_000 });
    const scores = [10, 50, 200, 1000].map((c) => pillarYield({ ...base, windowCostUsd: c }));
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]!).toBeLessThanOrEqual(scores[i - 1]!);
    }
  });

  it("anchor: 4 survivingLOC/$ and 0.5 commits/$ blend to ~50 (dollar-denominated)", () => {
    // 400 surviving LOC over $100 = 4 LOC/$ → locYield 50.
    // 50 commits over $100 = 0.5 commits/$ → commitYield 50.
    // yield = 0.6*50 + 0.4*50 = 50. Opus/cache no longer affect Yield (prod-tuned).
    const sessions = [record({ git: git({ commitsInWindow: 50, linesAdded: 400, revertedLinesWithin14d: 0, testFilesTouched: 0 }) })];
    const y = pillarYield(input({ sessions, windowCostUsd: 100, opusShare: 1.0, cacheReadRatio: 0 }));
    expect(y).toBeCloseTo(50, 0);
  });

  it("Yield ignores Opus share (prod: ~90% Opus is the population norm, not waste)", () => {
    const sessions = [record({ git: git({ commitsInWindow: 10, linesAdded: 400, revertedLinesWithin14d: 0 }) })];
    const allOpus = pillarYield(input({ sessions, windowCostUsd: 100, opusShare: 1.0 }));
    const allSonnet = pillarYield(input({ sessions, windowCostUsd: 100, opusShare: 0.0 }));
    expect(allOpus).toBe(allSonnet);
  });
});

describe("P5 Orchestration", () => {
  it("credits parallelism only when it ships", () => {
    // 3 spawns mean on shipped → spawnYield 100; 1 model → diversity 33
    const sessions = [record({ subagentSpawns: 3, model: "claude-opus-4-8", git: git({ commitsInWindow: 1 }) })];
    // 0.6*100 + 0.4*33.3 = 60 + 13.3 = 73.3
    expect(pillarOrchestration(sessions)).toBeCloseTo(73.3, 0);
  });

  it("spawns with nothing shipped score ~0 on spawnYield", () => {
    const sessions = [record({ subagentSpawns: 10, model: null, git: null })];
    // no shipped → spawnYield 0, no models → diversity 0 → 0
    expect(pillarOrchestration(sessions)).toBe(0);
  });

  it("model diversity caps at the anchor", () => {
    const sessions = [
      record({ model: "a", subagentSpawns: 0, git: null }),
      record({ model: "b", subagentSpawns: 0, git: null }),
      record({ model: "c", subagentSpawns: 0, git: null }),
      record({ model: "d", subagentSpawns: 0, git: null }),
    ];
    // 4 distinct → capped at 100 diversity, 0 spawnYield → 0.4*100 = 40
    expect(pillarOrchestration(sessions)).toBe(40);
  });
});

describe("P6 Throughput", () => {
  it("counts only surviving LOC per active day", () => {
    // 1 session, activeDays=1: 200 surviving LOC → locScore 50; 3 commits → commitScore 50
    const sessions = [
      record({ git: git({ commitsInWindow: 3, linesAdded: 300, revertedLinesWithin14d: 100 }) }),
    ];
    // surviving = 200, per day = 200 → 50; commits/day = 3 → 50 → 0.5*50+0.5*50 = 50
    expect(pillarThroughput(sessions)).toBe(50);
  });

  it("reverted lines do not count toward throughput", () => {
    const allReverted = [record({ git: git({ commitsInWindow: 0, linesAdded: 400, revertedLinesWithin14d: 400 }) })];
    // surviving = 0, commits = 0 → 0
    expect(pillarThroughput(allReverted)).toBe(0);
  });
});

describe("craftScore composite", () => {
  it("all-zero → 0, all-100 → 100", () => {
    const zero = Object.fromEntries(PILLARS.map((p) => [p, 0])) as Pillars;
    const hundred = Object.fromEntries(PILLARS.map((p) => [p, 100])) as Pillars;
    expect(craftScore(zero)).toBe(0);
    expect(craftScore(hundred)).toBe(100);
  });

  it("PROPERTY: balanced beats spiky at the same arithmetic mean", () => {
    // Both have arithmetic mean 60.
    const balanced = Object.fromEntries(PILLARS.map((p) => [p, 60])) as Pillars;
    // Spiky: one pillar 100, two at ~30 to hold the mean near 60.
    // mean of [100, 100, 100, 20, 20, 20] = 60.
    const spiky: Pillars = {
      verification: 100,
      yield: 100,
      direction: 100,
      autonomy: 20,
      orchestration: 20,
      throughput: 20,
    };
    const meanSpiky = PILLARS.reduce((s, p) => s + spiky[p], 0) / 6;
    expect(meanSpiky).toBe(60);
    expect(craftScore(balanced)).toBeGreaterThan(craftScore(spiky));
  });

  it("weights sum to 1", () => {
    const total = PILLARS.reduce((s, p) => s + PILLAR_WEIGHTS[p], 0);
    expect(total).toBeCloseTo(1, 10);
  });
});

describe("pillarPercentiles", () => {
  it("returns provisional raw values below the population floor", () => {
    const me = input({ sessions: [record({ git: git() })] });
    const res = pillarPercentiles(me, [me, me]);
    expect(res.provisional).toBe(true);
    expect(res.pillars).toEqual(computePillars(me));
  });

  it("computes percentiles at/above the population floor", () => {
    // 30 inputs: 29 weak, 1 strong (me). My yield should percentile near top.
    const weak = input({ sessions: [record({ git: git({ commitsInWindow: 0, linesAdded: 0, testFilesTouched: 0 }) })], windowTokens: 50_000_000 });
    const strong = input({
      sessions: [record({ git: git({ commitsInWindow: 10, linesAdded: 1000, testFilesTouched: 1, revertedLinesWithin14d: 0 }) })],
      windowTokens: 100_000,
      windowCostUsd: 1,
    });
    const pop = [strong, ...Array.from({ length: 29 }, () => weak)];
    const res = pillarPercentiles(strong, pop);
    expect(res.provisional).toBe(false);
    expect(res.pillars.yield).toBeGreaterThan(80);
  });
});

describe("trustTierOf", () => {
  it("1 when a session shipped with a remote", () => {
    expect(trustTierOf([record({ git: git({ commitsInWindow: 1, hasRemote: true }) })])).toBe(1);
  });
  it("0 without a remote", () => {
    expect(trustTierOf([record({ git: git({ commitsInWindow: 5, hasRemote: false }) })])).toBe(0);
  });
  it("0 when shipped count is zero even with a remote", () => {
    expect(trustTierOf([record({ git: git({ commitsInWindow: 0, hasRemote: true }) })])).toBe(0);
  });
  it("0 for purely behavioral (no git)", () => {
    expect(trustTierOf([record({ git: null })])).toBe(0);
  });
});

describe("derive-from-real-shaped SessionRecords (integration)", () => {
  it("computes a full pillar set + craft score from a realistic window", () => {
    const sessions: SessionRecord[] = [
      record({
        prompts: 6,
        assistantTurns: 40,
        hadEdits: true,
        exploreBeforeFirstEdit: true,
        subagentSpawns: 2,
        model: "claude-opus-4-8",
        wordBuckets: { "1-5": 1, "6-10": 3, "11-25": 4, "26+": 0 },
        git: git({ commitsInWindow: 3, linesAdded: 240, revertedLinesWithin14d: 20, testFilesTouched: 2, hasRemote: true }),
      }),
      record({
        prompts: 4,
        assistantTurns: 12,
        hadEdits: true,
        exploreBeforeFirstEdit: false,
        subagentSpawns: 0,
        model: "claude-sonnet-4-5",
        wordBuckets: { "1-5": 2, "6-10": 1, "11-25": 1, "26+": 0 },
        git: git({ commitsInWindow: 1, linesAdded: 80, revertedLinesWithin14d: 0, testFilesTouched: 0, hasRemote: true }),
      }),
      record({
        prompts: 3,
        assistantTurns: 6,
        hadEdits: false,
        model: "claude-sonnet-4-5",
        wordBuckets: { "1-5": 3, "6-10": 0, "11-25": 0, "26+": 0 },
        git: null,
      }),
    ];
    const inp = input({ sessions, windowTokens: 2_000_000, windowCostUsd: 60, opusShare: 0.4, cacheReadRatio: 0.7 });
    const pillars = computePillars(inp);
    for (const p of PILLARS) {
      expect(pillars[p]).toBeGreaterThanOrEqual(0);
      expect(pillars[p]).toBeLessThanOrEqual(100);
    }
    const score = craftScore(pillars);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
    expect(trustTierOf(sessions)).toBe(1);
  });
});

describe("outcomeEconomics", () => {
  it("zero sessions → zero counts, both ratios null", () => {
    const e = outcomeEconomics([], 50);
    expect(e.survivingLoc).toBe(0);
    expect(e.shippedCommits).toBe(0);
    expect(e.costPerSurvivingLoc).toBeNull();
    expect(e.commitsPer100Usd).toBeNull();
  });

  it("zero cost → costPerSurvivingLoc null (no $0/line display)", () => {
    // survivingLoc >= 50 but windowCostUsd = 0 → null, not 0
    const sessions = [record({ git: git({ linesAdded: 200, revertedLinesWithin14d: 0, commitsInWindow: 5 }) })];
    const e = outcomeEconomics(sessions, 0);
    expect(e.survivingLoc).toBe(200);
    expect(e.costPerSurvivingLoc).toBeNull();
    // commitsPer100Usd also null: cost < $1
    expect(e.commitsPer100Usd).toBeNull();
  });

  it("below survivingLoc threshold (< 50) → costPerSurvivingLoc null", () => {
    const sessions = [record({ git: git({ linesAdded: 30, revertedLinesWithin14d: 0, commitsInWindow: 5 }) })];
    const e = outcomeEconomics(sessions, 10);
    expect(e.survivingLoc).toBe(30);
    expect(e.costPerSurvivingLoc).toBeNull();
    // commits >= 3 and cost >= 1 → commitsPer100Usd present
    expect(e.commitsPer100Usd).toBe(50.0);
  });

  it("below commits threshold (< 3) → commitsPer100Usd null", () => {
    const sessions = [record({ git: git({ linesAdded: 200, revertedLinesWithin14d: 0, commitsInWindow: 2 }) })];
    const e = outcomeEconomics(sessions, 10);
    expect(e.commitsPer100Usd).toBeNull();
    expect(e.costPerSurvivingLoc).toBeCloseTo(0.05, 2);
  });

  it("below cost threshold (< $1) → commitsPer100Usd null", () => {
    const sessions = [record({ git: git({ linesAdded: 100, revertedLinesWithin14d: 0, commitsInWindow: 5 }) })];
    const e = outcomeEconomics(sessions, 0.5);
    expect(e.commitsPer100Usd).toBeNull();
  });

  it("normal case: correct math, reverted lines subtracted", () => {
    // surviving = 100 - 20 = 80; cost = 40; costPerLoc = 40/80 = 0.50
    // commits = 10; commitsPer100 = 10/40*100 = 25.0
    const sessions = [
      record({ git: git({ linesAdded: 100, revertedLinesWithin14d: 20, commitsInWindow: 10 }) }),
    ];
    const e = outcomeEconomics(sessions, 40);
    expect(e.survivingLoc).toBe(80);
    expect(e.shippedCommits).toBe(10);
    expect(e.windowCostUsd).toBe(40);
    expect(e.costPerSurvivingLoc).toBe(0.50);
    expect(e.commitsPer100Usd).toBe(25.0);
  });

  it("reverted lines clamped at 0 (no negative surviving LOC)", () => {
    const sessions = [record({ git: git({ linesAdded: 10, revertedLinesWithin14d: 200, commitsInWindow: 5 }) })];
    const e = outcomeEconomics(sessions, 50);
    expect(e.survivingLoc).toBe(0);
    expect(e.costPerSurvivingLoc).toBeNull(); // 0 < 50 threshold
  });

  it("rounding: costPerSurvivingLoc rounds to 2 decimals when >= $0.01", () => {
    // cost=10, surviving=333 → 10/333 = 0.030030... → rounds to 0.03
    const sessions = [record({ git: git({ linesAdded: 333, revertedLinesWithin14d: 0, commitsInWindow: 5 }) })];
    const e = outcomeEconomics(sessions, 10);
    expect(e.costPerSurvivingLoc).toBe(0.03);
  });

  it("rounding: costPerSurvivingLoc keeps 4 decimals when < $0.01", () => {
    // cost=1, surviving=200 → 1/200 = 0.005 → 4 decimals → 0.005
    const sessions = [record({ git: git({ linesAdded: 200, revertedLinesWithin14d: 0, commitsInWindow: 5 }) })];
    const e = outcomeEconomics(sessions, 1);
    expect(e.costPerSurvivingLoc).toBe(0.005);
  });

  it("rounding: commitsPer100Usd rounds to 1 decimal", () => {
    // 7 commits / 30 * 100 = 23.333... → 23.3
    const sessions = [record({ git: git({ linesAdded: 100, revertedLinesWithin14d: 0, commitsInWindow: 7 }) })];
    const e = outcomeEconomics(sessions, 30);
    expect(e.commitsPer100Usd).toBe(23.3);
  });

  it("multi-session: sums correctly across sessions", () => {
    const sessions = [
      record({ git: git({ linesAdded: 60, revertedLinesWithin14d: 10, commitsInWindow: 4 }) }),
      record({ git: git({ linesAdded: 80, revertedLinesWithin14d: 0, commitsInWindow: 3 }) }),
      record({ git: null }), // no git → contributes nothing
    ];
    // surviving = 50 + 80 = 130; commits = 7; cost = 20
    // costPerLoc = 20/130 ≈ 0.15; commitsPer100 = 7/20*100 = 35.0
    const e = outcomeEconomics(sessions, 20);
    expect(e.survivingLoc).toBe(130);
    expect(e.shippedCommits).toBe(7);
    expect(e.costPerSurvivingLoc).toBe(0.15);
    expect(e.commitsPer100Usd).toBe(35.0);
  });
});
