import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { profileRoute } from "../src/routes/profile.js";
import { InsightsStore } from "../src/lib/insights-store.js";
import { LeaderboardStore } from "../src/lib/leaderboard-store.js";
import { githubVerified } from "../src/lib/github-stats.js";
import { makeDb, seedUser } from "./helpers/db.js";
import { users, githubStats, type GithubStats, type InsightsPayload } from "../src/db/schema.js";

function ghStats(over: Partial<GithubStats> = {}): GithubStats {
  return {
    login: "x",
    accountCreatedAt: "2018-03-01T00:00:00Z",
    followers: 10,
    publicRepos: 20,
    totalStars: 300,
    topLanguages: [{ name: "TypeScript", repos: 9 }],
    mergedPublicPrs: 40,
    reviewsLastYear: 12,
    commitsLastYear: 500,
    contributionsLastYear: 800,
    currentStreakDays: 4,
    longestStreakDays: 30,
    reposContributedTo: 6,
    windowCommits: 25,
    ...over,
  };
}

function payload(over: Partial<InsightsPayload> = {}): InsightsPayload {
  return {
    windowDays: 40,
    sessions: 3,
    promptWordHistogram: { "1-5": 2, "6-10": 1, "11-25": 1, "26+": 0 },
    planModeSessionsPct: 0,
    exploreBeforeEditRatio: 0,
    avgTurnsBetweenUserMsgs: 4,
    interruptsPer100Turns: 0,
    subagentSpawnsPerSession: 0,
    maxParallelAgents: 0,
    hourHistogram: Array(24).fill(0).map((_, h) => (h === 10 ? 3 : 0)),
    editToolCallsPerSession: 2,
    longestSessionMinutes: 30,
    ...over,
  };
}

describe("profile github block", () => {
  let db: Awaited<ReturnType<typeof makeDb>>;
  let store: InsightsStore;

  beforeEach(async () => {
    db = await makeDb();
    store = new InsightsStore();
  });

  it("serves stored github stats publicly, without consent", async () => {
    const u = (await seedUser(db, { login: "pubgh", token: "tok_g" }))!;
    await db.insert(githubStats).values({ userId: u.id, status: "ok", data: ghStats(), fetchedAt: new Date() });

    const app = profileRoute({ db, store: new LeaderboardStore(), insightsStore: store, githubToken: null });
    const res = await app.request("/pubgh");
    const body = (await res.json()) as { github: GithubStats | null; insights: { locked: boolean } };
    expect(body.insights.locked).toBe(true); // no consent — behavioral stays locked
    expect(body.github?.totalStars).toBe(300); // public footprint still renders
  });

  it("a hanging GitHub fetch never blocks the profile response", async () => {
    const u = (await seedUser(db, { login: "hangs", token: "tok_h" }))!;
    await db.update(users).set({ githubAccessToken: "gh" }).where(eq(users.id, u.id));
    // Stale row → a refresh WILL be kicked; the fetcher never resolves.
    await db.insert(githubStats).values({
      userId: u.id,
      status: "ok",
      data: ghStats({ followers: 77 }),
      fetchedAt: new Date(Date.now() - 9 * 60 * 60 * 1000),
    });
    const never = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;

    const app = profileRoute({
      db,
      store: new LeaderboardStore(),
      insightsStore: store,
      githubToken: null,
      githubFetcher: never,
    });
    const body = (await (await app.request("/hangs")).json()) as { github: GithubStats | null };
    expect(body.github?.followers).toBe(77); // stale served instantly
  }, 3000);

  it("github is null when nothing has been fetched", async () => {
    await seedUser(db, { login: "nogh", token: "tok_n" });
    const app = profileRoute({ db, store: new LeaderboardStore(), insightsStore: store, githubToken: null });
    const body = (await (await app.request("/nogh")).json()) as { github: GithubStats | null };
    expect(body.github).toBeNull();
  });

  it("unlocked insights carry githubVerified", async () => {
    const u = (await seedUser(db, { login: "verif", token: "tok_v" }))!;
    await db.update(users).set({ insightsConsent: true, insightsMode: "deep" }).where(eq(users.id, u.id));
    store.upsert(u.id, "m1", payload());
    await db.insert(githubStats).values({ userId: u.id, status: "ok", data: ghStats(), fetchedAt: new Date() });

    const app = profileRoute({ db, store: new LeaderboardStore(), insightsStore: store, githubToken: null });
    const body = (await (await app.request("/verif")).json()) as {
      insights: { locked: boolean; githubVerified?: boolean };
    };
    expect(body.insights.locked).toBe(false);
    // No deep sessions → trustTier null → not cross-verified. Field present, honest false.
    expect(body.insights.githubVerified).toBe(false);
  });
});

describe("githubVerified", () => {
  it("requires local-git trust AND public commits in the same window", () => {
    expect(githubVerified(1, ghStats({ windowCommits: 5 }))).toBe(true);
    expect(githubVerified(1, ghStats({ windowCommits: 0 }))).toBe(false);
    expect(githubVerified(0, ghStats({ windowCommits: 5 }))).toBe(false);
    expect(githubVerified(null, ghStats({ windowCommits: 5 }))).toBe(false);
    expect(githubVerified(1, null)).toBe(false);
  });
});
