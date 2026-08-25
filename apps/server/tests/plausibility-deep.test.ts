import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import {
  checkOutcomeImplausibility,
  checkTimingRegularity,
  GATES,
} from "../src/lib/plausibility.js";
import { insightsRoute } from "../src/routes/insights.js";
import { InsightsStore } from "../src/lib/insights-store.js";
import { LeaderboardStore } from "../src/lib/leaderboard-store.js";
import { makeDb, seedUser } from "./helpers/db.js";
import { users, usageDays, type SessionRecord, type SessionGitOutcome } from "../src/db/schema.js";

// ── Pure gates ───────────────────────────────────────────────────────────────

describe("checkOutcomeImplausibility", () => {
  it("normal AI-assisted ratios → null", () => {
    // 500 surviving LOC from 2M tokens, 5 commits across 2M tokens.
    expect(checkOutcomeImplausibility(500, 5, 2_000_000)).toBeNull();
  });

  it("surviving LOC exceeding total tokens → flag", () => {
    const sig = checkOutcomeImplausibility(5_000, 3, 1_000);
    expect(sig?.reason).toBe("outcome_implausible");
    expect(sig?.detail).toContain("loc/token");
  });

  it("absurd commits per million tokens → flag", () => {
    const sig = checkOutcomeImplausibility(10, 10_000, 5_000_000);
    expect(sig?.reason).toBe("outcome_implausible");
    expect(sig?.detail).toContain("commits/Mtok");
  });

  it("zero tokens with any surviving LOC trips the loc/token gate (no div-by-zero)", () => {
    const sig = checkOutcomeImplausibility(2, 0, 0);
    expect(sig?.reason).toBe("outcome_implausible");
  });

  it("exactly at the loc/token boundary does not flag (strict >)", () => {
    // locPerToken === maxLocPerToken (1.0) → not a violation.
    expect(checkOutcomeImplausibility(1_000, 0, 1_000)).toBeNull();
  });
});

function timed(events: number, subSecondFraction: number, medianGapMs: number) {
  return { timing: { events, subSecondFraction, medianGapMs } };
}

describe("checkTimingRegularity", () => {
  it("human-like spread timing → null", () => {
    const sessions = Array.from({ length: 5 }, () => timed(40, 0.2, 1500));
    expect(checkTimingRegularity(sessions)).toBeNull();
  });

  it("fewer than 3 substantial sessions → null even if machine-regular", () => {
    const sessions = [timed(50, 0.99, 30), timed(50, 0.99, 30)];
    expect(checkTimingRegularity(sessions)).toBeNull();
  });

  it("machine-regular short-gap sessions but too few long ones → null", () => {
    // Two long machine-regular + many tiny (below the events threshold) → < 3 substantial.
    const sessions = [
      timed(50, 0.99, 30),
      timed(50, 0.99, 30),
      timed(5, 0.99, 30),
      timed(5, 0.99, 30),
    ];
    expect(checkTimingRegularity(sessions)).toBeNull();
  });

  it("3+ long sessions all subSecond 0.99 + tiny medianGap → flag", () => {
    const sessions = Array.from({ length: 4 }, () => timed(50, 0.99, 30));
    const sig = checkTimingRegularity(sessions);
    expect(sig?.reason).toBe("timing_regular");
    expect(sig?.detail).toContain("long sessions");
  });

  it("high subSecond but medianGap above threshold → null", () => {
    // 95% sub-second but the median gap is a human-plausible 500ms.
    const sessions = Array.from({ length: 5 }, () => timed(40, 0.95, 500));
    expect(checkTimingRegularity(sessions)).toBeNull();
  });

  it("only counts sessions at/above the events threshold", () => {
    expect(GATES.timingMinEvents()).toBe(20);
    // Exactly at the threshold counts as substantial.
    const sessions = Array.from({ length: 3 }, () => timed(20, 0.99, 50));
    expect(checkTimingRegularity(sessions)?.reason).toBe("timing_regular");
  });
});

describe("GATES deep-ingest defaults", () => {
  it("documents the conservative defaults", () => {
    expect(GATES.maxLocPerToken()).toBe(1.0);
    expect(GATES.maxCommitsPerMTok()).toBe(200);
    expect(GATES.timingMinEvents()).toBe(20);
    expect(GATES.maxSubSecondFraction()).toBe(0.9);
    expect(GATES.minMedianGapMs()).toBe(300);
  });
});

// ── Route-level: flag-not-reject (shadow quarantine) ─────────────────────────

const TOKEN = "tok_deep_gate";
const MID = "f0f0f0f0f0f0";

function record(over: Partial<SessionRecord> = {}): SessionRecord {
  return {
    startHour: 10,
    durationMinutes: 30,
    prompts: 4,
    interrupts: 0,
    usedPlanMode: false,
    exploreBeforeFirstEdit: false,
    hadEdits: true,
    subagentSpawns: 0,
    maxParallel: 0,
    editCalls: 4,
    assistantTurns: 8,
    wordBuckets: { "1-5": 2, "6-10": 1, "11-25": 1, "26+": 0 },
    model: "claude-opus-4-8",
    timing: { events: 9, medianGapMs: 1200, p10GapMs: 200, subSecondFraction: 0.1 },
    git: null,
    ...over,
  };
}

function git(over: Partial<SessionGitOutcome> = {}): SessionGitOutcome {
  return {
    repoIdHash: "abc123",
    branchHash: "def456",
    commitsInWindow: 1,
    linesAdded: 10,
    linesDeleted: 1,
    filesChanged: 2,
    testFilesTouched: 0,
    aiLinkedCommits: 1,
    revertedLinesWithin14d: 0,
    squashMergeDetected: false,
    rebaseDetected: false,
    isMonorepo: false,
    hasRemote: true,
    ...over,
  };
}

describe("/insights/deep anti-gaming gates (flag, never reject)", () => {
  let db: Awaited<ReturnType<typeof makeDb>>;
  let store: InsightsStore;
  let board: LeaderboardStore;

  beforeEach(async () => {
    db = await makeDb();
    store = new InsightsStore();
    board = new LeaderboardStore();
    await seedUser(db, { login: "gamer", token: TOKEN });
    await db.update(users).set({ insightsMode: "deep", insightsConsent: true }).where(eq(users.githubLogin, "gamer"));
  });

  afterEach(() => {
    delete process.env.GATE_MAX_LOC_PER_TOKEN;
  });

  const auth = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
  const app = () => insightsRoute({ db, insightsStore: store, store: board });

  it("fabricated payload (huge LOC, ~0 tokens) → 200 AND user flagged", async () => {
    // No usage_days rows → windowTokens 0; sessions claim thousands of surviving LOC.
    const sessions = Array.from({ length: 10 }, () =>
      record({ git: git({ linesAdded: 5000, commitsInWindow: 3, revertedLinesWithin14d: 0 }) }),
    );
    const res = await app().request("/deep", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ machineId: MID, windowDays: 40, sessions }),
    });
    // Shadow quarantine: still 200, data stored, but flagged.
    expect(res.status).toBe(200);
    const [u] = await db.select().from(users).where(eq(users.githubLogin, "gamer"));
    expect(u!.flaggedAt).not.toBeNull();
    expect(u!.flagReason).toContain("outcome_implausible");
  });

  it("normal payload with backing token spend → not flagged", async () => {
    const [u0] = await db.select().from(users).where(eq(users.githubLogin, "gamer"));
    const today = new Date().toISOString().slice(0, 10);
    // Real spend: ~3M tokens, $40 priced. Modest LOC/commit outcome.
    await db.insert(usageDays).values({
      userId: u0!.id,
      machineId: MID,
      tool: "claude",
      day: today,
      inputTokens: 500_000,
      outputTokens: 500_000,
      cacheCreationTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      modelBreakdown: [
        {
          modelName: "claude-opus-4-8",
          inputTokens: 500_000,
          outputTokens: 500_000,
          cacheCreationTokens: 1_000_000,
          cacheReadTokens: 1_000_000,
        },
      ],
      cost: "40",
    });
    const sessions = Array.from({ length: 10 }, () =>
      record({
        timing: { events: 40, medianGapMs: 1500, p10GapMs: 300, subSecondFraction: 0.2 },
        git: git({ linesAdded: 60, commitsInWindow: 1, revertedLinesWithin14d: 5 }),
      }),
    );
    const res = await app().request("/deep", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ machineId: MID, windowDays: 40, sessions }),
    });
    expect(res.status).toBe(200);
    const [u] = await db.select().from(users).where(eq(users.githubLogin, "gamer"));
    expect(u!.flaggedAt).toBeNull();
  });

  it("machine-regular timing across long sessions → 200 AND flagged", async () => {
    const [u0] = await db.select().from(users).where(eq(users.githubLogin, "gamer"));
    const today = new Date().toISOString().slice(0, 10);
    // Plenty of token spend so the outcome gate stays quiet — only timing trips.
    await db.insert(usageDays).values({
      userId: u0!.id,
      machineId: MID,
      tool: "claude",
      day: today,
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheCreationTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      modelBreakdown: [
        {
          modelName: "claude-opus-4-8",
          inputTokens: 1_000_000,
          outputTokens: 1_000_000,
          cacheCreationTokens: 1_000_000,
          cacheReadTokens: 1_000_000,
        },
      ],
      cost: "60",
    });
    const sessions = Array.from({ length: 5 }, () =>
      record({
        timing: { events: 50, medianGapMs: 30, p10GapMs: 5, subSecondFraction: 0.99 },
        git: git({ linesAdded: 20, commitsInWindow: 1 }),
      }),
    );
    const res = await app().request("/deep", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ machineId: MID, windowDays: 40, sessions }),
    });
    expect(res.status).toBe(200);
    const [u] = await db.select().from(users).where(eq(users.githubLogin, "gamer"));
    expect(u!.flaggedAt).not.toBeNull();
    expect(u!.flagReason).toContain("timing_regular");
  });
});
