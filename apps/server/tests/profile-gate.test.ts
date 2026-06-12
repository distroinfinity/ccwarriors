import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { profileRoute } from "../src/routes/profile.js";
import { InsightsStore } from "../src/lib/insights-store.js";
import { LeaderboardStore } from "../src/lib/leaderboard-store.js";
import { createSessionToken } from "../src/lib/session.js";
import { mergeInsights, percentilePool, MIN_SESSIONS } from "../src/lib/insights.js";
import { makeDb, seedUser } from "./helpers/db.js";
import { users, type InsightsPayload } from "../src/db/schema.js";

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

    const res = await app().request("/rookie");
    const body = (await res.json()) as {
      insights: {
        locked: boolean;
        archetype?: string;
        provisional?: boolean;
        sampleSessions?: number;
        windowDays?: number;
        scoresArePercentiles?: boolean;
        axes?: Record<string, number>;
      };
    };
    expect(body.insights.locked).toBe(false);
    expect(body.insights.archetype).toBeTruthy();
    expect(body.insights.provisional).toBe(true);
    expect(body.insights.sampleSessions).toBe(1);
    expect(body.insights.windowDays).toBe(40);
    // A 1-session user never gets rank-normalized scores.
    expect(body.insights.scoresArePercentiles).toBe(false);
    expect(Object.values(body.insights.axes!).every((v) => v >= 0 && v <= 100)).toBe(true);
  });

  it("locked insights do not include windowDays", async () => {
    await seedUser(db, { login: "anon", token: "tok_a" });
    // No consent, no store upsert.

    const res = await app().request("/anon");
    const body = (await res.json()) as { insights: { locked: boolean; windowDays?: number } };
    expect(body.insights.locked).toBe(true);
    expect(body.insights.windowDays).toBeUndefined();
  });

  it("consented-but-nothing-uploaded shows forging to the owner only", async () => {
    const u = (await seedUser(db, { login: "fresh", token: "tok_f", githubId: "gid-fresh" }))!;
    await consent("fresh");
    // No store.upsert — consent given, no payload has landed yet.

    // Visitor: must look exactly like never-consented.
    const anon = await app().request("/fresh");
    const anonBody = (await anon.json()) as { insights: { locked: boolean; reason?: string } };
    expect(anonBody.insights.locked).toBe(true);
    expect(anonBody.insights.reason).toBe("no_consent");

    // Owner: sees the honest forging state, plus their consent version (v1
    // default) so the web can offer the v2 story upgrade.
    const cookie = `ccw_session=${createSessionToken({ login: "fresh", avatarUrl: "", githubId: u.githubId }, SECRET)}`;
    const owner = await app().request("/fresh", { headers: { Cookie: cookie } });
    const ownerBody = (await owner.json()) as {
      insights: { locked: boolean; reason?: string };
      owner?: { consentVersion?: number };
    };
    expect(ownerBody.insights.locked).toBe(true);
    expect(ownerBody.insights.reason).toBe("forging");
    expect(ownerBody.owner?.consentVersion).toBe(1);
  });

  it("never emits forging based on session count", async () => {
    const u = (await seedUser(db, { login: "nine", token: "tok_n" }))!;
    await consent("nine");
    store.upsert(u.id, "m1", payload({ sessions: 9 })); // below the old gate

    const res = await app().request("/nine");
    const body = (await res.json()) as { insights: { locked: boolean } };
    expect(body.insights.locked).toBe(false);
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
