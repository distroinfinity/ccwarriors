import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { profileRoute } from "../src/routes/profile.js";
import { InsightsStore } from "../src/lib/insights-store.js";
import { LeaderboardStore } from "../src/lib/leaderboard-store.js";
import { createSessionToken } from "../src/lib/session.js";
import { mergeInsights, percentilePool, MIN_SESSIONS } from "../src/lib/insights.js";
import { makeDb, seedUser } from "./helpers/db.js";
import { users, userDeepSessions, usageDays, userStories, type InsightsPayload, type SessionRecord, type StoryDoc } from "../src/db/schema.js";

// The 10-session "forging" gate is gone: every stat we can compute renders
// from session #1 (marked provisional). "forging" survives only for the
// genuine consented-but-nothing-uploaded-yet case, and only for the owner —
// visitors must not learn the consent bit (privacy oracle).

const SECRET = "test-secret";

function payload(over: Partial<InsightsPayload> = {}): InsightsPayload {
  return {
    windowDays: 40,
    sessions: 1,
    promptWordHistogram: { "1-5": 2, "6-10": 1, "11-25": 1, "26+": 0 },
    planModeSessionsPct: 0,
    exploreBeforeEditRatio: 0,
    avgTurnsBetweenUserMsgs: 4,
    interruptsPer100Turns: 0,
    subagentSpawnsPerSession: 0,
    maxParallelAgents: 0,
    hourHistogram: Array(24).fill(0).map((_, h) => (h === 10 ? 1 : 0)),
    editToolCallsPerSession: 2,
    longestSessionMinutes: 30,
    ...over,
  };
}

describe("profile gate removal", () => {
  let db: Awaited<ReturnType<typeof makeDb>>;
  let store: InsightsStore;

  beforeEach(async () => {
    db = await makeDb();
    store = new InsightsStore();
  });

  function app() {
    return profileRoute({ db, store: new LeaderboardStore(), insightsStore: store, sessionSecret: SECRET });
  }

  async function consent(login: string) {
    await db.update(users).set({ insightsConsent: true, insightsMode: "deep" }).where(eq(users.githubLogin, login));
  }

  it("unlocks the full insights block from a single session", async () => {
    const u = (await seedUser(db, { login: "rookie", token: "tok_r" }))!;
    await consent("rookie");
    store.upsert(u.id, "m1", payload({ sessions: 1, windowDays: 40 }));

    const res = await app().request("/rookie/insights");
    const body = (await res.json()) as {
      locked: boolean;
      archetype?: string;
      provisional?: boolean;
      sampleSessions?: number;
      windowDays?: number;
      scoresArePercentiles?: boolean;
      axes?: Record<string, number>;
    };
    expect(body.locked).toBe(false);
    expect(body.archetype).toBeTruthy();
    expect(body.provisional).toBe(true);
    expect(body.sampleSessions).toBe(1);
    expect(body.windowDays).toBe(40);
    // A 1-session user never gets rank-normalized scores.
    expect(body.scoresArePercentiles).toBe(false);
    expect(Object.values(body.axes!).every((v) => v >= 0 && v <= 100)).toBe(true);
  });

  it("locked insights do not include windowDays", async () => {
    await seedUser(db, { login: "anon", token: "tok_a" });
    // No consent, no store upsert.

    const res = await app().request("/anon/insights");
    const body = (await res.json()) as { locked: boolean; windowDays?: number };
    expect(body.locked).toBe(true);
    expect(body.windowDays).toBeUndefined();
  });

  it("consented-but-nothing-uploaded shows forging to the owner only", async () => {
    const u = (await seedUser(db, { login: "fresh", token: "tok_f", githubId: "gid-fresh" }))!;
    await consent("fresh");
    // No store.upsert — consent given, no payload has landed yet.

    // Visitor: must look exactly like never-consented.
    const anon = await app().request("/fresh/insights");
    const anonBody = (await anon.json()) as { locked: boolean; reason?: string };
    expect(anonBody.locked).toBe(true);
    expect(anonBody.reason).toBe("no_consent");

    // Owner: sees the honest forging state, plus their consent version (v1
    // default) so the web can offer the v2 story upgrade — consentVersion lives
    // on the CORE response (owner block), not on insights.
    const cookie = `ccw_session=${createSessionToken({ login: "fresh", avatarUrl: "", githubId: u.githubId }, SECRET)}`;
    const coreOwner = await app().request("/fresh", { headers: { Cookie: cookie } });
    const coreOwnerBody = (await coreOwner.json()) as { owner?: { consentVersion?: number } };
    expect(coreOwnerBody.owner?.consentVersion).toBe(1);

    const insightsOwner = await app().request("/fresh/insights", { headers: { Cookie: cookie } });
    const insightsOwnerBody = (await insightsOwner.json()) as { locked: boolean; reason?: string };
    expect(insightsOwnerBody.locked).toBe(true);
    expect(insightsOwnerBody.reason).toBe("forging");
  });

  it("never emits forging based on session count", async () => {
    const u = (await seedUser(db, { login: "nine", token: "tok_n" }))!;
    await consent("nine");
    store.upsert(u.id, "m1", payload({ sessions: 9 })); // below the old gate

    const res = await app().request("/nine/insights");
    const body = (await res.json()) as { locked: boolean };
    expect(body.locked).toBe(false);
  });
});

// ── depth block ──────────────────────────────────────────────────────────────

function deepRecord(over: Partial<SessionRecord> = {}): SessionRecord {
  return {
    startHour: 10,
    durationMinutes: 60,
    prompts: 4,
    interrupts: 0,
    usedPlanMode: true,
    exploreBeforeFirstEdit: false,
    hadEdits: true,
    subagentSpawns: 2,
    maxParallel: 3,
    editCalls: 5,
    assistantTurns: 10,
    wordBuckets: { "1-5": 2, "6-10": 1, "11-25": 1, "26+": 0 },
    model: "claude-opus-4-8",
    timing: { events: 11, medianGapMs: 1000, p10GapMs: 150, subSecondFraction: 0.1 },
    git: null,
    ...over,
  };
}

describe("depth block", () => {
  let db: Awaited<ReturnType<typeof makeDb>>;
  let store: InsightsStore;

  beforeEach(async () => {
    db = await makeDb();
    store = new InsightsStore();
  });

  function app() {
    return profileRoute({ db, store: new LeaderboardStore(), insightsStore: store, sessionSecret: SECRET });
  }

  it("depth is present and correct when deep sessions exist", async () => {
    const u = (await seedUser(db, { login: "deepuser", token: "tok_deep" }))!;
    await db.update(users).set({ insightsConsent: true, insightsMode: "deep" }).where(eq(users.id, u.id));
    // Two sessions: 60m plan-mode with subagents, 120m no-plan no-subagents.
    const sessions: SessionRecord[] = [
      deepRecord({ durationMinutes: 60, usedPlanMode: true, subagentSpawns: 2, maxParallel: 3 }),
      deepRecord({ durationMinutes: 120, usedPlanMode: false, subagentSpawns: 0, maxParallel: 1 }),
    ];
    await db.insert(userDeepSessions).values({ userId: u.id, machineId: "m1", sessions, windowDays: 40 });
    // Seed aggregate so insights unlock (longestSessionMinutes matches the deep sessions max).
    store.upsert(u.id, "m1", payload({ sessions: 2, windowDays: 40, planModeSessionsPct: 50, subagentSpawnsPerSession: 1, maxParallelAgents: 3, longestSessionMinutes: 120 }));

    const res = await app().request("/deepuser/insights");
    const body = (await res.json()) as {
      locked: boolean;
      depth?: {
        sessions: number;
        windowDays: number;
        totalHours: number | null;
        planModeSessionsPct: number;
        subagentSessionsPct: number | null;
        subagentSpawnsPerSession: number;
        maxParallelAgents: number;
        avgSessionMinutes: number | null;
        longestSessionMinutes: number;
      };
    };
    expect(body.locked).toBe(false);
    const d = body.depth!;
    expect(d).toBeDefined();
    // sessions and window from merged aggregate
    expect(d.sessions).toBe(2);
    expect(d.windowDays).toBe(40);
    // totalHours: (60 + 120) / 60 = 3.0
    expect(d.totalHours).toBe(3.0);
    // avgSessionMinutes: (60 + 120) / 2 = 90
    expect(d.avgSessionMinutes).toBe(90);
    // longestSessionMinutes comes from the merged AGGREGATE (seeded as 120),
    // not recomputed from deep sessions.
    expect(d.longestSessionMinutes).toBe(120);
    // subagentSessionsPct: 1 of 2 sessions had spawns → 50%
    expect(d.subagentSessionsPct).toBe(50);
    // planModeSessionsPct from merged aggregate
    expect(d.planModeSessionsPct).toBe(50);
    // maxParallelAgents from merged
    expect(d.maxParallelAgents).toBe(3);
  });

  it("depth has null deep-derived fields when no deep sessions exist (aggregate-only user)", async () => {
    const u = (await seedUser(db, { login: "aggonly", token: "tok_agg" }))!;
    await db.update(users).set({ insightsConsent: true, insightsMode: "deep" }).where(eq(users.id, u.id));
    // Only aggregate, no deep rows.
    store.upsert(u.id, "m1", payload({ sessions: 5, windowDays: 30, planModeSessionsPct: 20 }));

    const res = await app().request("/aggonly/insights");
    const body = (await res.json()) as { locked: boolean; depth?: { totalHours: unknown; avgSessionMinutes: unknown; subagentSessionsPct: unknown } };
    expect(body.locked).toBe(false);
    const d = body.depth!;
    expect(d).toBeDefined();
    // Deep-derived fields are null when no deep rows.
    expect(d.totalHours).toBeNull();
    expect(d.avgSessionMinutes).toBeNull();
    expect(d.subagentSessionsPct).toBeNull();
  });

  it("depth is absent on locked (non-consented) responses", async () => {
    await seedUser(db, { login: "noconsent", token: "tok_nc" });
    // No consent, no store upsert.

    const res = await app().request("/noconsent/insights");
    const body = (await res.json()) as { locked: boolean; depth?: unknown };
    expect(body.locked).toBe(true);
    expect(body.depth).toBeUndefined();
  });

  it("surfaces tagline, deckMonth, and featuredCardKeys on unlocked insights", async () => {
    const u = (await seedUser(db, { login: "storyteller", token: "tok_story2" }))!;
    await db.update(users).set({ insightsConsent: true, insightsMode: "deep" }).where(eq(users.id, u.id));
    const sessions: SessionRecord[] = [
      deepRecord({ durationMinutes: 60, usedPlanMode: true, subagentSpawns: 2, maxParallel: 3 }),
      deepRecord({ durationMinutes: 120, usedPlanMode: false, subagentSpawns: 0, maxParallel: 1 }),
    ];
    await db.insert(userDeepSessions).values({ userId: u.id, machineId: "m1", sessions, windowDays: 40 });
    // Seed aggregate so insights unlock (mirrors the existing depth test setup).
    store.upsert(u.id, "m1", payload({ sessions: 2, windowDays: 40, planModeSessionsPct: 50, subagentSpawnsPerSession: 1, maxParallelAgents: 3, longestSessionMinutes: 120 }));
    const storyDoc: StoryDoc = {
      tagline: "Plans first, ships behind a test.",
      narrative: "You steer with conviction.",
      arc: "You moved from one-shot to plan-first.",
      whatYouBuilt: "A leaderboard.",
      decisionPatterns: [],
      strengths: [],
      growthAreas: [],
      aiArchetypes: [],
      crypticPrompt: null,
      sessionsAnalyzed: 2,
    };
    await db.insert(userStories).values({ userId: u.id, doc: storyDoc, model: "test", generatedAt: new Date() });

    const res = await app().request("/storyteller/insights");
    const body = (await res.json()) as { locked: boolean; tagline: string | null; deckMonth: string; featuredCardKeys: string[] };
    expect(body.locked).toBe(false);
    expect(body.tagline).toBe("Plans first, ships behind a test.");
    expect(body.deckMonth).toMatch(/^\d{4}-\d{2}$/);
    expect(Array.isArray(body.featuredCardKeys)).toBe(true);
    expect(body.featuredCardKeys.length).toBeLessThanOrEqual(6);
    expect(body.featuredCardKeys).toContain("story");
  });
});

describe("economics in profile response", () => {
  let db: Awaited<ReturnType<typeof makeDb>>;
  let store: InsightsStore;

  beforeEach(async () => {
    db = await makeDb();
    store = new InsightsStore();
  });

  function app() {
    return profileRoute({ db, store: new LeaderboardStore(), insightsStore: store, sessionSecret: SECRET });
  }

  it("economics is present in unlocked response for a deep user with git outcomes", async () => {
    const u = (await seedUser(db, { login: "econuser", token: "tok_econ" }))!;
    await db.update(users).set({ insightsConsent: true, insightsMode: "deep" }).where(eq(users.id, u.id));
    const sessions: SessionRecord[] = [
      deepRecord({
        git: {
          repoIdHash: "r1",
          branchHash: "b1",
          commitsInWindow: 5,
          linesAdded: 200,
          linesDeleted: 10,
          filesChanged: 8,
          testFilesTouched: 2,
          aiLinkedCommits: 4,
          revertedLinesWithin14d: 20,
          squashMergeDetected: false,
          rebaseDetected: false,
          isMonorepo: false,
          hasRemote: true,
        },
      }),
      deepRecord({
        git: {
          repoIdHash: "r1",
          branchHash: "b1",
          commitsInWindow: 3,
          linesAdded: 100,
          linesDeleted: 5,
          filesChanged: 4,
          testFilesTouched: 1,
          aiLinkedCommits: 2,
          revertedLinesWithin14d: 0,
          squashMergeDetected: false,
          rebaseDetected: false,
          isMonorepo: false,
          hasRemote: true,
        },
      }),
    ];
    await db.insert(userDeepSessions).values({ userId: u.id, machineId: "m1", sessions, windowDays: 40 });
    store.upsert(u.id, "m1", payload({ sessions: 2, windowDays: 40 }));

    const res = await app().request("/econuser/insights");
    const body = (await res.json()) as {
      locked: boolean;
      economics?: {
        survivingLoc: number;
        shippedCommits: number;
        windowCostUsd: number;
        costPerSurvivingLoc: number | null;
        commitsPer100Usd: number | null;
      } | null;
    };
    expect(body.locked).toBe(false);
    const econ = body.economics!;
    expect(econ).toBeDefined();
    // surviving = (200-20) + (100-0) = 180+100 = 280; commits = 8
    expect(econ.survivingLoc).toBe(280);
    expect(econ.shippedCommits).toBe(8);
    // windowCostUsd = 0 (no usage_days seeded for this user)
    expect(typeof econ.windowCostUsd).toBe("number");
    // survivingLoc >= 50 but windowCostUsd = 0 → costPerSurvivingLoc must be null (not "$0 per line")
    expect(econ.costPerSurvivingLoc).toBeNull();
  });

  it("economics is null for aggregate-only user (no deep sessions)", async () => {
    const u = (await seedUser(db, { login: "aggonlyecon", token: "tok_ae" }))!;
    await db.update(users).set({ insightsConsent: true, insightsMode: "deep" }).where(eq(users.id, u.id));
    store.upsert(u.id, "m1", payload({ sessions: 5, windowDays: 30 }));

    const res = await app().request("/aggonlyecon/insights");
    const body = (await res.json()) as { locked: boolean; economics?: unknown };
    expect(body.locked).toBe(false);
    expect(body.economics).toBeNull();
  });

  it("economics is absent on locked (non-consented) responses", async () => {
    await seedUser(db, { login: "lockeduser", token: "tok_lu" });

    const res = await app().request("/lockeduser/insights");
    const body = (await res.json()) as { locked: boolean; economics?: unknown };
    expect(body.locked).toBe(true);
    expect(body.economics).toBeUndefined();
  });
});

describe("percentilePool", () => {
  it("excludes sub-MIN_SESSIONS users so tiny samples never shred the ranks", () => {
    const tiny = mergeInsights([payload({ sessions: 1 })]);
    const small = mergeInsights([payload({ sessions: MIN_SESSIONS - 1 })]);
    const ok = mergeInsights([payload({ sessions: MIN_SESSIONS })]);
    const big = mergeInsights([payload({ sessions: 50 })]);
    const pool = percentilePool([tiny, small, ok, big]);
    expect(pool).toHaveLength(2);
    expect(pool.every((m) => m.sessions >= MIN_SESSIONS)).toBe(true);
  });
});

// ── stack block ───────────────────────────────────────────────────────────────

describe("stack in profile response", () => {
  let db: Awaited<ReturnType<typeof makeDb>>;
  let store: InsightsStore;

  beforeEach(async () => {
    db = await makeDb();
    store = new InsightsStore();
  });

  function app() {
    return profileRoute({ db, store: new LeaderboardStore(), insightsStore: store, sessionSecret: SECRET });
  }

  it("stack is present for a deep user with extensions seeded", async () => {
    const u = (await seedUser(db, { login: "stackuser", token: "tok_stack" }))!;
    await db.update(users).set({ insightsConsent: true, insightsMode: "deep" }).where(eq(users.id, u.id));
    const sessions: SessionRecord[] = [
      deepRecord({ extensions: { ts: 150, py: 50 } }),
      deepRecord({ extensions: { ts: 100, rs: 75 } }),
    ];
    await db.insert(userDeepSessions).values({ userId: u.id, machineId: "m1", sessions, windowDays: 40 });
    store.upsert(u.id, "m1", payload({ sessions: 2, windowDays: 40 }));

    const res = await app().request("/stackuser/insights");
    const body = (await res.json()) as {
      locked: boolean;
      stack?: {
        languages: Array<{ name: string; share: number }>;
        models: Array<{ family: string; share: number }>;
        ghLanguages: string[];
      } | null;
    };
    expect(body.locked).toBe(false);
    const s = body.stack!;
    expect(s).not.toBeNull();
    // ts: 250, py: 50, rs: 75 → total 375. TypeScript is top.
    expect(s.languages.at(0)?.name).toBe("TypeScript");
    expect(s.languages.find((l) => l.name === "Rust")).toBeTruthy();
    expect(s.languages.find((l) => l.name === "Python")).toBeTruthy();
    // ghLanguages: no github data seeded → empty array
    expect(Array.isArray(s.ghLanguages)).toBe(true);
  });

  it("stack is null for aggregate-only user (no deep sessions)", async () => {
    const u = (await seedUser(db, { login: "aggstack", token: "tok_as" }))!;
    await db.update(users).set({ insightsConsent: true, insightsMode: "deep" }).where(eq(users.id, u.id));
    store.upsert(u.id, "m1", payload({ sessions: 3, windowDays: 30 }));

    const res = await app().request("/aggstack/insights");
    const body = (await res.json()) as { locked: boolean; stack?: unknown };
    expect(body.locked).toBe(false);
    // no deep sessions → craft is null → sessions null → stack null
    expect(body.stack).toBeNull();
  });

  it("stack is absent on locked (non-consented) responses", async () => {
    await seedUser(db, { login: "lockstack", token: "tok_ls" });

    const res = await app().request("/lockstack/insights");
    const body = (await res.json()) as { locked: boolean; stack?: unknown };
    expect(body.locked).toBe(true);
    expect(body.stack).toBeUndefined();
  });
});

// ── tokensAllTime ─────────────────────────────────────────────────────────────

describe("tokensAllTime in profile response", () => {
  let db: Awaited<ReturnType<typeof makeDb>>;
  let store: InsightsStore;

  beforeEach(async () => {
    db = await makeDb();
    store = new InsightsStore();
  });

  function app() {
    return profileRoute({ db, store: new LeaderboardStore(), insightsStore: store, sessionSecret: SECRET });
  }

  it("sums all four token columns across all usage_days rows", async () => {
    const u = (await seedUser(db, { login: "tokenuser", token: "tok_tu" }))!;
    // Row 1: 100 input + 50 output + 10 cacheCreation + 5 cacheRead = 165
    await db.insert(usageDays).values({
      userId: u.id, machineId: "m1", tool: "claude", day: "2025-01-01",
      inputTokens: 100, outputTokens: 50, cacheCreationTokens: 10, cacheReadTokens: 5, cost: "1.00",
    });
    // Row 2: 200 input + 80 output + 0 + 0 = 280
    await db.insert(usageDays).values({
      userId: u.id, machineId: "m1", tool: "claude", day: "2025-01-02",
      inputTokens: 200, outputTokens: 80, cacheCreationTokens: 0, cacheReadTokens: 0, cost: "2.00",
    });

    const res = await app().request("/tokenuser");
    const body = (await res.json()) as { tokensAllTime: number | null };
    // 165 + 280 = 445
    expect(body.tokensAllTime).toBe(445);
  });

  it("returns null for a user with no usage_days rows", async () => {
    await seedUser(db, { login: "notokenuser", token: "tok_ntu" });

    const res = await app().request("/notokenuser");
    const body = (await res.json()) as { tokensAllTime: number | null };
    expect(body.tokensAllTime).toBeNull();
  });

  it("counts rows older than the 53-week rhythm window in the all-time total", async () => {
    const u = (await seedUser(db, { login: "olduser", token: "tok_old" }))!;
    // 2 years ago — well outside the 53-week scan window used for rhythm.
    await db.insert(usageDays).values({
      userId: u.id, machineId: "m1", tool: "claude", day: "2024-01-01",
      inputTokens: 1000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, cost: "1.00",
    });

    const res = await app().request("/olduser");
    const body = (await res.json()) as { tokensAllTime: number | null };
    expect(body.tokensAllTime).toBe(1000);
  });
});

describe("GET /:login/insights endpoint", () => {
  let db: Awaited<ReturnType<typeof makeDb>>;
  let store: InsightsStore;
  beforeEach(async () => {
    db = await makeDb();
    store = new InsightsStore();
  });
  function app() {
    return profileRoute({ db, store: new LeaderboardStore(), insightsStore: store, sessionSecret: SECRET });
  }

  it("returns the unlocked insights union at the top level", async () => {
    const u = (await seedUser(db, { login: "deck", token: "tok_deck" }))!;
    await db.update(users).set({ insightsConsent: true, insightsMode: "deep" }).where(eq(users.id, u.id));
    store.upsert(u.id, "m1", payload({ sessions: 3, windowDays: 40 }));

    const res = await app().request("/deck/insights");
    const body = (await res.json()) as { locked: boolean; archetype?: string; axes?: Record<string, number> };
    expect(res.status).toBe(200);
    expect(body.locked).toBe(false);
    expect(body.archetype).toBeTruthy();
    expect(Object.values(body.axes!).every((v) => v >= 0 && v <= 100)).toBe(true);
  });

  it("hides forging from visitors but shows it to the owner", async () => {
    const u = (await seedUser(db, { login: "frg", token: "tok_frg", githubId: "gid-frg" }))!;
    await db.update(users).set({ insightsConsent: true, insightsMode: "deep" }).where(eq(users.id, u.id));

    const anon = await app().request("/frg/insights");
    expect((await anon.json() as { reason?: string }).reason).toBe("no_consent");

    const cookie = `ccw_session=${createSessionToken({ login: "frg", avatarUrl: "", githubId: u.githubId }, SECRET)}`;
    const owner = await app().request("/frg/insights", { headers: { Cookie: cookie } });
    expect((await owner.json() as { reason?: string }).reason).toBe("forging");
  });

  it("404s an unknown login", async () => {
    const res = await app().request("/ghost/insights");
    expect(res.status).toBe(404);
  });
});
