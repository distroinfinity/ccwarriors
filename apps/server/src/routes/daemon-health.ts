import { Hono } from "hono";
import { and, eq, gte, isNotNull, isNull, sql } from "drizzle-orm";
import type { DB } from "../db/index.js";
import { users, snapshots } from "../db/schema.js";
import { findStaleDaemons, type DaemonSyncRow, type StaleDaemonReport } from "../lib/daemon-health.js";

// GET /telemetry/stale-daemons — server-side detection of silently-dead autosync
// daemons (issue #91). Public + unauthenticated like /telemetry/failures (the
// scheduled health workflow polls it without a secret); github_logins are public
// board data anyway.
//
// The report is computed on a TIMER, never on the request path. It used to be a
// 30-min request-path cache, but the health workflow polls hourly — so the cache
// had always expired and every single poll paid for a full 7-day aggregate over
// `snapshots` (a parallel seq scan; ~57MB of buffers). On a memory-capped
// container that intermittently blew the workflow's 10s budget and opened a
// "prod health check failing" issue: 8 false alarms in Aug 2026 (#110–#117),
// every one of them auto-closed within two hours. Serving the last computed
// value makes the endpoint O(1) and the alert trustworthy.
const REFRESH_MS = 15 * 60_000;

async function computeReport(db: DB, now: number): Promise<StaleDaemonReport> {
  const sevenDaysAgo = new Date(now - 7 * 86_400_000);
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

  return findStaleDaemons(daemonRows, now);
}

export interface DaemonHealth {
  route: Hono;
  /** Recompute every REFRESH_MS, off the request path. Same in-process timer
   *  pattern as startRetention / startPricingRefresh. */
  start: () => NodeJS.Timeout;
}

/**
 * Owns one stale-daemon report and the timer that refreshes it. State lives in
 * this closure, not at module scope, so each app (and each test) gets its own.
 */
export function createDaemonHealth(db: DB, now: () => number = Date.now): DaemonHealth {
  let latest: { at: number; report: StaleDaemonReport } | null = null;

  const refresh = async () => {
    const t = now();
    latest = { at: t, report: await computeReport(db, t) };
  };

  const route = new Hono();
  route.get("/stale-daemons", async (c) => {
    // Cold start only: the timer hasn't produced a report yet (the first
    // seconds after boot, or a test that never started it).
    if (!latest) await refresh();
    return c.json({ ...latest!.report, computedAt: new Date(latest!.at).toISOString() });
  });

  const start = () => {
    const run = async () => {
      try {
        await refresh();
      } catch (err) {
        // Keep serving the previous report — a transient DB hiccup must not
        // become a health-check failure, which is the whole point of this move.
        console.warn("daemon-health: refresh failed:", (err as Error).message);
      }
    };
    void run();
    const t = setInterval(() => void run(), REFRESH_MS);
    t.unref();
    return t;
  };

  return { route, start };
}

/** Convenience for callers that only need the route (app.ts default, tests). */
export function daemonHealthRoute(db: DB, now: () => number = Date.now): Hono {
  return createDaemonHealth(db, now).route;
}
