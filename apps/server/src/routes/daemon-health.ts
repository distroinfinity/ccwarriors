import { Hono } from "hono";
import { and, eq, gte, isNotNull, isNull, sql } from "drizzle-orm";
import type { DB } from "../db/index.js";
import { users, snapshots } from "../db/schema.js";
import { findStaleDaemons, type DaemonSyncRow } from "../lib/daemon-health.js";

// GET /telemetry/stale-daemons — server-side detection of silently-dead autosync
// daemons (issue #91). Public + unauthenticated like /telemetry/failures (the
// scheduled health workflow polls it without a secret); github_logins are public
// board data anyway. The underlying query groups 7 days of snapshots — 30 min
// of staleness is acceptable (the health workflow polls hourly) and keeps the
// scan from running on every poll.
const CACHE_TTL_MS = 30 * 60_000;

export function daemonHealthRoute(db: DB, now: () => number = Date.now): Hono {
  const app = new Hono();
  let cache: { at: number; body: unknown } | null = null;

  app.get("/stale-daemons", async (c) => {
    const t = now();
    if (cache && t - cache.at < CACHE_TTL_MS) return c.json(cache.body as object);

    const sevenDaysAgo = new Date(t - 7 * 86_400_000);
    // lastBuild comes straight off users.client_build_id (ingest updates it on
    // every sync) — the previous array_agg(... order by captured_at) sorted a
    // user's entire 7-day snapshot history just to recover the same value.
    const rows = await db
      .select({
        githubLogin: users.githubLogin,
        lastSyncedAt: users.lastSyncedAt,
        syncs7d: sql<number>`count(${snapshots.id})::int`,
        lastBuild: users.clientBuildId,
      })
      .from(users)
      .innerJoin(
        snapshots,
        and(eq(snapshots.userId, users.id), gte(snapshots.capturedAt, sevenDaysAgo)),
      )
      .where(and(isNull(users.flaggedAt), isNotNull(users.lastSyncedAt)))
      .groupBy(users.id, users.githubLogin, users.lastSyncedAt);

    // lastSyncedAt is non-null by the WHERE clause above; the cast is just for TS.
    const daemonRows: DaemonSyncRow[] = rows.map((r) => ({
      githubLogin: r.githubLogin,
      lastSyncedAt: r.lastSyncedAt as Date,
      syncs7d: Number(r.syncs7d),
      lastBuild: r.lastBuild,
    }));

    const report = findStaleDaemons(daemonRows, t);
    cache = { at: t, body: report };
    return c.json(report);
  });

  return app;
}
