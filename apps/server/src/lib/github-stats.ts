// GitHub public-footprint fetcher (issue #48, public-only subset). One GraphQL
// POST per refresh covers everything — single rate-limit point, no pagination.
// Card doctrine applies: a missing block parses as an ERROR, never as zeros we
// didn't actually observe.
import type { GithubStats } from "../db/schema.js";

export interface GithubFetchDeps {
  fetcher?: typeof fetch;
  now?: number;
}

export type GithubFetchResult =
  | { status: "ok"; stats: GithubStats }
  | { status: "auth_error" } // 401 — caller clears the stored user token
  | { status: "rate_limited" } // 403/429 with the limit exhausted
  | { status: "error"; message: string };

const WINDOW_DAYS = 40; // matches the CLI's deep-insights window
const TIMEOUT_MS = 8000;

const QUERY = `
query($login: String!, $from: DateTime!) {
  user(login: $login) {
    createdAt
    followers { totalCount }
    repositories(first: 100, ownerAffiliations: OWNER, privacy: PUBLIC,
                 orderBy: {field: STARGAZERS, direction: DESC}) {
      totalCount
      nodes { stargazerCount primaryLanguage { name } }
    }
    pullRequests(states: MERGED) { totalCount }
    repositoriesContributedTo(includeUserRepositories: false,
      contributionTypes: [COMMIT, PULL_REQUEST, PULL_REQUEST_REVIEW]) { totalCount }
    contributionsCollection {
      totalCommitContributions
      totalPullRequestReviewContributions
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount } }
      }
    }
    windowContrib: contributionsCollection(from: $from) {
      totalCommitContributions
      totalPullRequestContributions
    }
  }
}`;

interface CalendarDay {
  date: string;
  contributionCount: number;
}

/**
 * Current/longest contribution streaks from the (chronological) calendar days.
 * A zero TODAY doesn't break the current streak — the day isn't over yet.
 */
export function streaksFromCalendar(days: CalendarDay[], today: string): { current: number; longest: number } {
  let longest = 0;
  let run = 0;
  for (const d of days) {
    if (d.contributionCount > 0) {
      run++;
      if (run > longest) longest = run;
    } else {
      run = 0;
    }
  }
  // Current streak: walk back from the end, forgiving a zero on today only.
  let current = 0;
  let i = days.length - 1;
  if (i >= 0 && days[i]!.contributionCount === 0 && days[i]!.date === today) i--;
  for (; i >= 0; i--) {
    if (days[i]!.contributionCount > 0) current++;
    else break;
  }
  return { current, longest };
}

/**
 * Tier-2-LITE cross-check: local-git verified (trustTier 1) AND public GitHub
 * commits exist in the same 40-day window. A weak but honest corroboration —
 * full Tier-2 (commit authorship verification) stays issue #48.
 */
export function githubVerified(trustTier: number | null, stats: GithubStats | null): boolean {
  return trustTier === 1 && (stats?.windowCommits ?? 0) > 0;
}

const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);

export async function fetchGithubStats(
  login: string,
  token: string,
  deps: GithubFetchDeps = {},
): Promise<GithubFetchResult> {
  const fetcher = deps.fetcher ?? fetch;
  const now = deps.now ?? Date.now();
  try {
    const from = new Date(now - WINDOW_DAYS * 86_400_000).toISOString();
    const res = await fetcher("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "ccwarriors",
      },
      body: JSON.stringify({ query: QUERY, variables: { login, from } }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (res.status === 401) return { status: "auth_error" };
    if (res.status === 403 || res.status === 429) {
      const remaining = res.headers.get("x-ratelimit-remaining");
      if (remaining === "0" || res.headers.get("retry-after")) return { status: "rate_limited" };
      return { status: "error", message: `github ${res.status}` };
    }
    if (!res.ok) return { status: "error", message: `github ${res.status}` };

    const body = (await res.json()) as { data?: { user?: Record<string, unknown> | null }; errors?: unknown[] };
    const u = body.data?.user;
    if (!u) {
      return { status: "error", message: body.errors ? "graphql errors" : "no user block" };
    }

    // Every field must be REAL. A malformed block fails the whole parse —
    // we never serve a stats object with invented zeros.
    const createdAt = u["createdAt"];
    const followers = num((u["followers"] as Record<string, unknown> | undefined)?.["totalCount"]);
    const repos = u["repositories"] as { totalCount?: unknown; nodes?: unknown[] } | undefined;
    const publicRepos = num(repos?.totalCount);
    const prs = num((u["pullRequests"] as Record<string, unknown> | undefined)?.["totalCount"]);
    const contributedTo = num(
      (u["repositoriesContributedTo"] as Record<string, unknown> | undefined)?.["totalCount"],
    );
    const cc = u["contributionsCollection"] as Record<string, unknown> | undefined;
    const commitsLastYear = num(cc?.["totalCommitContributions"]);
    const reviewsLastYear = num(cc?.["totalPullRequestReviewContributions"]);
    const calendar = cc?.["contributionCalendar"] as
      | { totalContributions?: unknown; weeks?: Array<{ contributionDays?: CalendarDay[] }> }
      | undefined;
    const contributionsLastYear = num(calendar?.totalContributions);
    const windowBlock = u["windowContrib"] as Record<string, unknown> | undefined;
    const windowCommits = num(windowBlock?.["totalCommitContributions"]);
    // Older fixtures/rows may lack PR contributions — degrade to 0-or-absent,
    // never fail the whole parse over the newest field.
    const windowPrs = num(windowBlock?.["totalPullRequestContributions"]);

    if (
      typeof createdAt !== "string" ||
      followers === null ||
      publicRepos === null ||
      !Array.isArray(repos?.nodes) ||
      prs === null ||
      contributedTo === null ||
      commitsLastYear === null ||
      reviewsLastYear === null ||
      contributionsLastYear === null ||
      windowCommits === null ||
      !Array.isArray(calendar?.weeks)
    ) {
      return { status: "error", message: "malformed user block" };
    }

    let totalStars = 0;
    const langCounts = new Map<string, number>();
    for (const node of repos.nodes) {
      const n = node as { stargazerCount?: unknown; primaryLanguage?: { name?: unknown } | null };
      totalStars += num(n.stargazerCount) ?? 0;
      const lang = n.primaryLanguage?.name;
      if (typeof lang === "string" && lang) langCounts.set(lang, (langCounts.get(lang) ?? 0) + 1);
    }
    const topLanguages = [...langCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, repos: count }));

    const days = calendar.weeks
      .flatMap((w) => w.contributionDays ?? [])
      .filter((d): d is CalendarDay => typeof d?.date === "string" && typeof d?.contributionCount === "number")
      .sort((a, b) => a.date.localeCompare(b.date));
    const today = new Date(now).toISOString().slice(0, 10);
    const streaks = streaksFromCalendar(days, today);

    return {
      status: "ok",
      stats: {
        login,
        accountCreatedAt: createdAt,
        followers,
        publicRepos,
        totalStars,
        topLanguages,
        mergedPublicPrs: prs,
        reviewsLastYear,
        commitsLastYear,
        contributionsLastYear,
        currentStreakDays: streaks.current,
        longestStreakDays: streaks.longest,
        reposContributedTo: contributedTo,
        windowCommits,
        ...(windowPrs !== null ? { windowPrs } : {}),
      },
    };
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : String(err) };
  }
}
