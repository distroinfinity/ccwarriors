import { sql } from "drizzle-orm";
import type { DB } from "../db/index.js";
import { snapshots } from "../db/schema.js";
import { captureEvent } from "../routes/telemetry.js";

// Snapshots are one row per daemon sync (~100/user/day) and were append-only
// forever — unbounded table growth is unbounded Postgres working-set growth on
// a memory-billed host. Only the trailing 7 days are ever read (the
// stale-daemons report in routes/daemon-health.ts), so 14 days keeps a full
// safety margin. If you tighten RETENTION_DAYS, keep it ABOVE that 7-day
// query window or daemon detection silently degrades.
const RETENTION_DAYS = 14;
const BATCH_SIZE = 10_000;
const BATCH_PAUSE_MS = 500;
const RUN_EVERY_MS = 24 * 3_600_000;
// Delay the first run past boot so it never competes with store hydration.
const BOOT_DELAY_MS = 5 * 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Delete snapshots older than the retention window, in batches. The first run
 *  after deploy may face weeks of backlog — an unbatched DELETE of that would
 *  spike WAL and Postgres memory, which is exactly what this exists to lower. */
export async function pruneSnapshots(db: DB): Promise<number> {
  // ISO string + ::timestamptz cast, not a Date param: drizzle's db.execute()
  // on the postgres-js driver failed to serialize a Date here in production
  // ("Received an instance of Date"), which silently disabled pruning. The
  // PGlite test driver accepts both, so only prod caught it.
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString();
  let total = 0;
  for (;;) {
    const rows = await db.execute(sql`
      DELETE FROM ${snapshots}
      WHERE id IN (
        SELECT id FROM ${snapshots}
        WHERE captured_at < ${cutoff}::timestamptz
        LIMIT ${BATCH_SIZE}
      )
      RETURNING id
    `);
    // postgres-js returns an array-like RowList; the PGlite driver (tests)
    // returns { rows: [...] }.
    const deleted = Array.isArray(rows)
      ? rows.length
      : ((rows as { rows?: unknown[] }).rows?.length ?? 0);
    total += deleted;
    if (deleted < BATCH_SIZE) return total;
    await sleep(BATCH_PAUSE_MS);
  }
}

/** Daily snapshot pruning (same in-process timer pattern as startPricingRefresh). */
export function startRetention(db: DB): NodeJS.Timeout {
  const run = async () => {
    try {
      const deleted = await pruneSnapshots(db);
      if (deleted > 0) {
        console.log(`retention: pruned ${deleted} snapshots older than ${RETENTION_DAYS}d`);
        captureEvent("snapshots_pruned", "system", { deleted, retentionDays: RETENTION_DAYS });
      }
    } catch (err) {
      console.warn("retention: prune failed:", (err as Error).message);
    }
  };
  const boot = setTimeout(() => void run(), BOOT_DELAY_MS);
  boot.unref();
  const t = setInterval(() => void run(), RUN_EVERY_MS);
  t.unref();
  return t;
}
