import { describe, it, expect } from "vitest";
import { fetchGithubStats, streaksFromCalendar } from "../src/lib/github-stats.js";

// One GraphQL POST covers the whole public footprint. The parser never
// fabricates: a missing block is an error, not a zero.

function gqlUser(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    createdAt: "2018-03-01T00:00:00Z",
    followers: { totalCount: 42 },
    repositories: {
      totalCount: 30,
      nodes: [
        { stargazerCount: 100, primaryLanguage: { name: "TypeScript" } },
        { stargazerCount: 25, primaryLanguage: { name: "TypeScript" } },
        { stargazerCount: 5, primaryLanguage: { name: "Rust" } },
        { stargazerCount: 0, primaryLanguage: null },
      ],
    },
    pullRequests: { totalCount: 87 },
    repositoriesContributedTo: { totalCount: 12 },
    contributionsCollection: {
      totalCommitContributions: 900,
      totalPullRequestReviewContributions: 55,
      contributionCalendar: {
        totalContributions: 1200,
        weeks: [
          {
            contributionDays: [
              { date: "2026-06-07", contributionCount: 0 },
              { date: "2026-06-08", contributionCount: 2 },
              { date: "2026-06-09", contributionCount: 1 },
              { date: "2026-06-10", contributionCount: 3 },
            ],
          },
        ],
      },
    },
    windowContrib: { totalCommitContributions: 60 },
    ...over,
  };
}

function fetcherReturning(body: unknown, status = 200, headers: Record<string, string> = {}): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...headers },
    })) as unknown as typeof fetch;
}

const NOW = Date.parse("2026-06-10T12:00:00Z");

describe("fetchGithubStats", () => {
  it("parses the full GraphQL payload into GithubStats", async () => {
    const result = await fetchGithubStats("distro", "tok", {
      fetcher: fetcherReturning({ data: { user: gqlUser() } }),
      now: NOW,
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");
    const s = result.stats;
    expect(s.login).toBe("distro");
    expect(s.accountCreatedAt).toBe("2018-03-01T00:00:00Z");
    expect(s.followers).toBe(42);
    expect(s.publicRepos).toBe(30);
    expect(s.totalStars).toBe(130);
    expect(s.topLanguages).toEqual([
      { name: "TypeScript", repos: 2 },
      { name: "Rust", repos: 1 },
    ]);
    expect(s.mergedPublicPrs).toBe(87);
    expect(s.reposContributedTo).toBe(12);
    expect(s.commitsLastYear).toBe(900);
    expect(s.reviewsLastYear).toBe(55);
    expect(s.contributionsLastYear).toBe(1200);
    expect(s.windowCommits).toBe(60);
    expect(s.currentStreakDays).toBe(3); // 8th, 9th, 10th
    expect(s.longestStreakDays).toBe(3);
  });

  it("treats 401 as auth_error (caller clears the stored token)", async () => {
    const result = await fetchGithubStats("x", "bad", {
      fetcher: fetcherReturning({ message: "Bad credentials" }, 401),
      now: NOW,
    });
    expect(result.status).toBe("auth_error");
  });

  it("treats an exhausted rate limit as rate_limited", async () => {
    const result = await fetchGithubStats("x", "tok", {
      fetcher: fetcherReturning({}, 403, { "x-ratelimit-remaining": "0" }),
      now: NOW,
    });
    expect(result.status).toBe("rate_limited");
  });

  it("a missing user block is an error, never zeros", async () => {
    const result = await fetchGithubStats("ghost", "tok", {
      fetcher: fetcherReturning({ data: { user: null } }),
      now: NOW,
    });
    expect(result.status).toBe("error");
  });

  it("a network throw is an error", async () => {
    const fetcher = (async () => {
      throw new Error("boom");
    }) as unknown as typeof fetch;
    const result = await fetchGithubStats("x", "tok", { fetcher, now: NOW });
    expect(result.status).toBe("error");
  });
});

describe("streaksFromCalendar", () => {
  const day = (date: string, n: number) => ({ date, contributionCount: n });

  it("counts a run ending today", () => {
    const days = [day("2026-06-08", 1), day("2026-06-09", 2), day("2026-06-10", 1)];
    expect(streaksFromCalendar(days, "2026-06-10")).toEqual({ current: 3, longest: 3 });
  });

  it("a zero today does not break a streak that ended yesterday", () => {
    const days = [day("2026-06-08", 1), day("2026-06-09", 2), day("2026-06-10", 0)];
    expect(streaksFromCalendar(days, "2026-06-10")).toEqual({ current: 2, longest: 2 });
  });

  it("a gap before yesterday zeroes the current streak but keeps the longest", () => {
    const days = [
      day("2026-06-05", 1),
      day("2026-06-06", 1),
      day("2026-06-07", 1),
      day("2026-06-08", 0),
      day("2026-06-09", 0),
      day("2026-06-10", 0),
    ];
    expect(streaksFromCalendar(days, "2026-06-10")).toEqual({ current: 0, longest: 3 });
  });

  it("empty calendar", () => {
    expect(streaksFromCalendar([], "2026-06-10")).toEqual({ current: 0, longest: 0 });
  });
});
