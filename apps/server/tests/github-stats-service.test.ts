import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { makeDb, seedUser } from "./helpers/db.js";
import { users, githubStats, type GithubStats } from "../src/db/schema.js";
import {
  getGithubStatsCached,
  refreshGithubStats,
  FRESH_TTL_MS,
  ERROR_RETRY_MS,
} from "../src/lib/github-stats-service.js";

// The profile request path does ONE indexed SELECT and serves stale forever;
// the GitHub network call is always fire-and-forget in the background. A dead
// GitHub API degrades to "no/old github block", never a slow profile.

function stats(over: Partial<GithubStats> = {}): GithubStats {
  return {
    login: "x",
    accountCreatedAt: "2018-03-01T00:00:00Z",
    followers: 1,
    publicRepos: 2,
    totalStars: 3,
    topLanguages: [{ name: "TypeScript", repos: 2 }],
    mergedPublicPrs: 4,
    reviewsLastYear: 5,
    commitsLastYear: 6,
    contributionsLastYear: 7,
    currentStreakDays: 1,
    longestStreakDays: 2,
    reposContributedTo: 8,
    windowCommits: 9,
    ...over,
  };
}

function okFetcher(s: GithubStats): { fetcher: typeof fetch; calls: () => number } {
  let n = 0;
  const fetcher = (async () => {
    n++;
    return new Response(
      JSON.stringify({
        data: {
          user: {
            createdAt: s.accountCreatedAt,
            followers: { totalCount: s.followers },
            repositories: {
              totalCount: s.publicRepos,
              nodes: [{ stargazerCount: s.totalStars, primaryLanguage: { name: "TypeScript" } }],
            },
            pullRequests: { totalCount: s.mergedPublicPrs },
            repositoriesContributedTo: { totalCount: s.reposContributedTo },
            contributionsCollection: {
              totalCommitContributions: s.commitsLastYear,
              totalPullRequestReviewContributions: s.reviewsLastYear,
              contributionCalendar: { totalContributions: s.contributionsLastYear, weeks: [] },
            },
            windowContrib: { totalCommitContributions: s.windowCommits },
          },
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as unknown as typeof fetch;
  return { fetcher, calls: () => n };
}

function countingFetcher(status: number, headers: Record<string, string> = {}): { fetcher: typeof fetch; calls: () => number } {
  let n = 0;
  const fetcher = (async () => {
    n++;
    return new Response("{}", { status, headers });
  }) as unknown as typeof fetch;
  return { fetcher, calls: () => n };
}

describe("github-stats service", () => {
  let db: Awaited<ReturnType<typeof makeDb>>;

  beforeEach(async () => {
    db = await makeDb();
  });

  async function seed(login: string, token: string | null) {
    const u = (await seedUser(db, { login, token: `tok_${login}` }))!;
    if (token) await db.update(users).set({ githubAccessToken: token }).where(eq(users.id, u.id));
    const [row] = await db.select().from(users).where(eq(users.id, u.id));
    return row!;
  }

  it("fresh row: returns stored stats without any fetch", async () => {
    const u = await seed("fresh", "ghtok");
    await db.insert(githubStats).values({ userId: u.id, status: "ok", data: stats(), fetchedAt: new Date() });
    const { fetcher, calls } = okFetcher(stats());

    const got = await getGithubStatsCached({ db, serverToken: null, fetcher, now: () => Date.now() }, u);
    expect(got?.followers).toBe(1);
    expect(calls()).toBe(0);
  });

  it("stale row: serves stale immediately and refreshes in the background", async () => {
    const u = await seed("stale", "ghtok");
    const old = new Date(Date.now() - FRESH_TTL_MS - 60_000);
    await db.insert(githubStats).values({ userId: u.id, status: "ok", data: stats({ followers: 1 }), fetchedAt: old });
    const { fetcher, calls } = okFetcher(stats({ followers: 99 }));

    const got = await getGithubStatsCached({ db, serverToken: null, fetcher, now: () => Date.now() }, u);
    expect(got?.followers).toBe(1); // stale served, not the fresh fetch

    await vi.waitFor(async () => {
      const [row] = await db.select().from(githubStats).where(eq(githubStats.userId, u.id));
      expect(row?.data?.followers).toBe(99);
    });
    expect(calls()).toBe(1);
  });

  it("no row yet: returns null and kicks the first fetch", async () => {
    const u = await seed("first", "ghtok");
    const { fetcher } = okFetcher(stats({ followers: 7 }));

    const got = await getGithubStatsCached({ db, serverToken: null, fetcher, now: () => Date.now() }, u);
    expect(got).toBeNull();

    await vi.waitFor(async () => {
      const [row] = await db.select().from(githubStats).where(eq(githubStats.userId, u.id));
      expect(row?.data?.followers).toBe(7);
      expect(row?.status).toBe("ok");
    });
  });

  it("no tokens anywhere: no fetch, null result", async () => {
    const u = await seed("tokenless", null);
    const { fetcher, calls } = okFetcher(stats());

    const got = await getGithubStatsCached({ db, serverToken: null, fetcher, now: () => Date.now() }, u);
    expect(got).toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    expect(calls()).toBe(0);
  });

  it("failed fetch: keeps prior data, marks error, and backs off", async () => {
    const u = await seed("flaky", "ghtok");
    const old = new Date(Date.now() - FRESH_TTL_MS - 60_000);
    await db.insert(githubStats).values({ userId: u.id, status: "ok", data: stats({ followers: 5 }), fetchedAt: old });
    const { fetcher, calls } = countingFetcher(500);
    const deps = { db, serverToken: null, fetcher, now: () => Date.now() };

    await refreshGithubStats(deps, u);
    const [row] = await db.select().from(githubStats).where(eq(githubStats.userId, u.id));
    expect(row?.status).toBe("error");
    expect(row?.data?.followers).toBe(5); // prior data survives

    // Within the error backoff the cached read does NOT re-kick a fetch.
    const got = await getGithubStatsCached(deps, u);
    expect(got?.followers).toBe(5);
    await new Promise((r) => setTimeout(r, 20));
    expect(calls()).toBe(1);
    expect(ERROR_RETRY_MS).toBeGreaterThan(0);
  });

  it("auth_error: nulls the stored user token and retries once with the PAT", async () => {
    const u = await seed("revoked", "dead-token");
    let authCalls = 0;
    const good = okFetcher(stats({ followers: 42 }));
    const fetcher = (async (url: unknown, init?: { headers?: Record<string, string> }) => {
      const auth = init?.headers?.["Authorization"] ?? "";
      if (auth.includes("dead-token")) {
        authCalls++;
        return new Response("{}", { status: 401 });
      }
      return (good.fetcher as unknown as (u: unknown, i?: unknown) => Promise<Response>)(url, init);
    }) as unknown as typeof fetch;

    await refreshGithubStats({ db, serverToken: "server-pat", fetcher, now: () => Date.now() }, u);

    const [userRow] = await db.select().from(users).where(eq(users.id, u.id));
    expect(userRow?.githubAccessToken).toBeNull();
    expect(authCalls).toBe(1);
    const [row] = await db.select().from(githubStats).where(eq(githubStats.userId, u.id));
    expect(row?.data?.followers).toBe(42); // PAT retry succeeded
    expect(row?.status).toBe("ok");
  });
});
