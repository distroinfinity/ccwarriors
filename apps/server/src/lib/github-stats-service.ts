// Cache + background-refresh layer over the GitHub fetcher. Hard rule: the
// profile request path only ever does one indexed SELECT on github_stats —
// the network call is always fire-and-forget. Serve stale forever; a dead
// GitHub API degrades to a missing/old block, never a slow or broken profile.
import { eq } from "drizzle-orm";
import type { DB } from "../db/index.js";
import { githubStats, users, type GithubStats, type User } from "../db/schema.js";
import { fetchGithubStats } from "./github-stats.js";

export const FRESH_TTL_MS = 6 * 60 * 60 * 1000; // refresh in background after 6h
export const ERROR_RETRY_MS = 30 * 60 * 1000; // backoff after a failed fetch

// Per-process refresh dedup: a hot profile getting hammered kicks one fetch.
const inFlight = new Set<string>();

export interface GithubStatsDeps {
  db: DB;
  serverToken: string | null;
  fetcher?: typeof fetch;
  now?: () => number;
}

/**
 * Non-blocking read: returns the stored stats (stale OK, null if never
 * fetched) and, when due and a token exists, kicks a fire-and-forget refresh.
 */
export async function getGithubStatsCached(deps: GithubStatsDeps, user: User): Promise<GithubStats | null> {
  const now = deps.now?.() ?? Date.now();
  const [row] = await deps.db.select().from(githubStats).where(eq(githubStats.userId, user.id));

  const ttl = row?.status === "error" ? ERROR_RETRY_MS : FRESH_TTL_MS;
  const due = !row || now - row.fetchedAt.getTime() > ttl;
  const hasToken = !!user.githubAccessToken || !!deps.serverToken;
  if (due && hasToken && !inFlight.has(user.id)) {
    inFlight.add(user.id);
    void refreshGithubStats(deps, user)
      .catch(() => {})
      .finally(() => inFlight.delete(user.id));
  }

  return row?.data ?? null;
}

/**
 * The background unit (exported for tests): pick token (user → PAT), fetch,
 * upsert github_stats. On auth_error the stored user token is nulled and the
 * PAT gets one retry. On rate_limited/error we write status='error' +
 * fetchedAt (the backoff clock) and KEEP prior data. Never throws.
 */
export async function refreshGithubStats(deps: GithubStatsDeps, user: User): Promise<void> {
  try {
    const now = deps.now?.() ?? Date.now();
    const login = user.githubLogin;
    let token = user.githubAccessToken ?? deps.serverToken;
    if (!token) return;

    let result = await fetchGithubStats(login, token, { fetcher: deps.fetcher, now });
    if (result.status === "auth_error" && user.githubAccessToken) {
      // Revoked user token: forget it, then give the server PAT one shot.
      await deps.db.update(users).set({ githubAccessToken: null }).where(eq(users.id, user.id));
      if (deps.serverToken && deps.serverToken !== token) {
        token = deps.serverToken;
        result = await fetchGithubStats(login, token, { fetcher: deps.fetcher, now });
      }
    }

    if (result.status === "ok") {
      await deps.db
        .insert(githubStats)
        .values({ userId: user.id, status: "ok", data: result.stats, fetchedAt: new Date(now) })
        .onConflictDoUpdate({
          target: githubStats.userId,
          set: { status: "ok", data: result.stats, fetchedAt: new Date(now) },
        });
      return;
    }

    // Any failure: stamp the backoff clock, keep whatever data we had.
    await deps.db
      .insert(githubStats)
      .values({ userId: user.id, status: "error", data: null, fetchedAt: new Date(now) })
      .onConflictDoUpdate({
        target: githubStats.userId,
        set: { status: "error", fetchedAt: new Date(now) }, // data intentionally untouched
      });
  } catch {
    // Background work must never propagate.
  }
}
