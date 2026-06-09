import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { deriveAggregate } from "../src/lib/deep.js";
import { insightsRoute } from "../src/routes/insights.js";
import { profileRoute } from "../src/routes/profile.js";
import { InsightsStore } from "../src/lib/insights-store.js";
import { LeaderboardStore } from "../src/lib/leaderboard-store.js";
import { makeDb, seedUser } from "./helpers/db.js";
import { users, userInsights, userDeepSessions, type SessionRecord } from "../src/db/schema.js";

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
    wordBuckets: { "1-5": 2, "6-10": 1, "11-25": 1, "26+": 0 },
    model: "claude-opus-4-8",
    timing: { events: 9, medianGapMs: 1200, p10GapMs: 200, subSecondFraction: 0.1 },
    git: null,
    ...over,
  };
}

describe("deriveAggregate", () => {
  it("rolls per-session records into the aggregate payload", () => {
    const sessions: SessionRecord[] = [
      record({
        startHour: 9,
        durationMinutes: 60,
        prompts: 10,
        interrupts: 2,
        usedPlanMode: true,
        hadEdits: true,
        exploreBeforeFirstEdit: true,
        subagentSpawns: 2,
        maxParallel: 2,
        editCalls: 5,
        assistantTurns: 20,
        wordBuckets: { "1-5": 3, "6-10": 2, "11-25": 1, "26+": 0 },
      }),
      record({
        startHour: 23,
        durationMinutes: 120,
        prompts: 5,
        interrupts: 0,
        usedPlanMode: false,
        hadEdits: true,
        exploreBeforeFirstEdit: false,
        subagentSpawns: 0,
        maxParallel: 4,
        editCalls: 3,
        assistantTurns: 10,
        wordBuckets: { "1-5": 1, "6-10": 1, "11-25": 2, "26+": 1 },
      }),
      record({
        startHour: 9,
        durationMinutes: 10,
        prompts: 3,
        interrupts: 1,
        hadEdits: false,
        assistantTurns: 6,
        editCalls: 0,
        wordBuckets: { "1-5": 2, "6-10": 0, "11-25": 0, "26+": 0 },
      }),
    ];
    const agg = deriveAggregate(sessions, 40);

    expect(agg.windowDays).toBe(40);
    expect(agg.sessions).toBe(3);
    // histogram summed across all 3
    expect(agg.promptWordHistogram).toEqual({ "1-5": 6, "6-10": 3, "11-25": 3, "26+": 1 });
    // 1 of 3 used plan mode
    expect(agg.planModeSessionsPct).toBeCloseTo(33.3);
    // 2 sessions had edits; 1 of those explored first → 0.5
    expect(agg.exploreBeforeEditRatio).toBe(0.5);
    // totalTurns 36 / totalPrompts 18 = 2.0
    expect(agg.avgTurnsBetweenUserMsgs).toBe(2);
    // interrupts 3 / turns 36 * 100 = 8.3
    expect(agg.interruptsPer100Turns).toBeCloseTo(8.3);
    // spawns 2 / 3 sessions = 0.7
    expect(agg.subagentSpawnsPerSession).toBeCloseTo(0.7);
    expect(agg.maxParallelAgents).toBe(4);
    // two sessions start at 9, one at 23
    expect(agg.hourHistogram[9]).toBe(2);
    expect(agg.hourHistogram[23]).toBe(1);
    expect(agg.hourHistogram).toHaveLength(24);
    // editCalls 8 / 3 = 2.7
    expect(agg.editToolCallsPerSession).toBeCloseTo(2.7);
    expect(agg.longestSessionMinutes).toBe(120);
  });

  it("zero-edit population yields a 0 explore ratio (no NaN)", () => {
    const agg = deriveAggregate([record({ hadEdits: false }), record({ hadEdits: false })], 40);
    expect(agg.exploreBeforeEditRatio).toBe(0);
    expect(Number.isFinite(agg.avgTurnsBetweenUserMsgs)).toBe(true);
  });

  it("empty session list does not divide by zero", () => {
    const agg = deriveAggregate([], 40);
    expect(agg.sessions).toBe(0);
    expect(agg.maxParallelAgents).toBe(0);
    expect(agg.longestSessionMinutes).toBe(0);
    expect(Number.isFinite(agg.avgTurnsBetweenUserMsgs)).toBe(true);
  });
});

const TOKEN = "tok_deep";
const MID = "a1b2c3d4e5f6";

function deepRoute(db: Awaited<ReturnType<typeof makeDb>>, store: InsightsStore) {
  return insightsRoute({ db, insightsStore: store });
}

describe("/insights/mode + /insights/deep", () => {
  let db: Awaited<ReturnType<typeof makeDb>>;
  let store: InsightsStore;

  beforeEach(async () => {
    db = await makeDb();
    store = new InsightsStore();
    await seedUser(db, { login: "deeper", token: TOKEN });
  });

  const auth = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

  it("deep upload is rejected while mode is off (403)", async () => {
    const app = deepRoute(db, store);
    const res = await app.request("/deep", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ machineId: MID, windowDays: 40, sessions: [record()] }),
    });
    expect(res.status).toBe(403);
  });

  it("set mode deep, upload deep, derive aggregate; set off purges everything", async () => {
    const app = deepRoute(db, store);

    // GET defaults to off
    let res = await app.request("/mode", { headers: auth });
    expect(await res.json()).toMatchObject({ mode: "off" });

    // POST mode deep → consent boolean flips too
    res = await app.request("/mode", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ mode: "deep" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ mode: "deep" });
    let [u] = await db.select().from(users).where(eq(users.githubLogin, "deeper"));
    expect(u!.insightsMode).toBe("deep");
    expect(u!.insightsConsent).toBe(true);

    // Upload enough sessions to clear MIN_SESSIONS (10) so an archetype derives.
    const sessions = Array.from({ length: 12 }, (_, i) =>
      record({ startHour: 9 + (i % 5), usedPlanMode: i % 2 === 0, hadEdits: true, editCalls: 4 }),
    );
    res = await app.request("/deep", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ machineId: MID, windowDays: 40, sessions }),
    });
    expect(res.status).toBe(200);
    const deepBody = (await res.json()) as { ok: boolean; archetype: string | null };
    expect(deepBody.ok).toBe(true);
    expect(deepBody.archetype).toBeTruthy();

    // Raw deep rows + derived aggregate both persisted; store has the merge.
    const deepRows = await db.select().from(userDeepSessions).where(eq(userDeepSessions.userId, u!.id));
    expect(deepRows).toHaveLength(1);
    expect(deepRows[0]!.sessions).toHaveLength(12);
    const aggRows = await db.select().from(userInsights).where(eq(userInsights.userId, u!.id));
    expect(aggRows).toHaveLength(1);
    expect(aggRows[0]!.payload.sessions).toBe(12);
    expect(store.merged(u!.id)!.sessions).toBe(12);
    [u] = await db.select().from(users).where(eq(users.githubLogin, "deeper"));
    expect(u!.archetype).toBeTruthy();

    // Profile reflects the derived archetype for the owner block + insights.
    const pApp = profileRoute({ db, store: new LeaderboardStore(), insightsStore: store });
    const pRes = await pApp.request("/deeper");
    const profile = (await pRes.json()) as { insights: { locked: boolean; archetype?: string } };
    expect(profile.insights.locked).toBe(false);
    expect(profile.insights.archetype).toBeTruthy();

    // Switch to off → aggregate + deep purged, archetype nulled, store evicted.
    res = await app.request("/mode", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ mode: "off" }),
    });
    expect(res.status).toBe(200);
    expect(await db.select().from(userDeepSessions).where(eq(userDeepSessions.userId, u!.id))).toHaveLength(0);
    expect(await db.select().from(userInsights).where(eq(userInsights.userId, u!.id))).toHaveLength(0);
    [u] = await db.select().from(users).where(eq(users.githubLogin, "deeper"));
    expect(u!.archetype).toBeNull();
    expect(u!.insightsMode).toBe("off");
    expect(u!.insightsConsent).toBe(false);
    expect(store.merged(u!.id)).toBeNull();
  });

  it("rejects payloads over the session cap", async () => {
    await db.update(users).set({ insightsMode: "deep", insightsConsent: true }).where(eq(users.githubLogin, "deeper"));
    const app = deepRoute(db, store);
    const res = await app.request("/deep", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ machineId: MID, windowDays: 40, sessions: Array.from({ length: 2001 }, () => record()) }),
    });
    expect(res.status).toBe(400);
  });
});
