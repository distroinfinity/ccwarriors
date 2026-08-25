// Exponential backoff for the sync daemon: when ccusage or the network is hard
// down, stop hammering (and stop spamming telemetry). Reset on first success.
const BASE_MS = 60_000; // first cooldown: 1 minute
const FACTOR = 5; // 1m → 5m → 25m → capped
const CAP_MS = 30 * 60_000; // never wait more than 30 minutes

/** Cooldown after `failStreak` consecutive hard failures (0 ⇒ no wait). */
export function nextBackoffMs(failStreak: number): number {
  if (failStreak <= 0) return 0;
  const ms = BASE_MS * Math.pow(FACTOR, failStreak - 1);
  return Math.min(ms, CAP_MS);
}

/** Whether a sync is allowed now, given the next-allowed timestamp. */
export function shouldSync(now: number, nextAllowedSyncAt: number): boolean {
  return now >= nextAllowedSyncAt;
}

// ── Watch-driven sync floor ─────────────────────────────────────────────────
// The daemon syncs on fs.watch with a 12s debounce, so the 15-minute heartbeat
// floor bounds nothing while you're actually coding: prod daemons were syncing
// 400-900 times a day (one per 1.6-3 min). Every one is a full ingest
// transaction on a memory-billed host, and memory is ~90% of the hosting bill.
// A floor between watch-driven syncs coalesces a burst into one sync without
// losing anything — ccusage totals are cumulative, so the next sync carries
// everything the skipped ones would have.
const DEFAULT_MIN_SYNC_GAP_MS = 5 * 60_000;

/** The floor, in ms. `CCWARRIORS_MIN_SYNC_GAP_MIN` overrides for debugging. */
export function minSyncGapMs(env: NodeJS.ProcessEnv = process.env): number {
  const m = Number(env["CCWARRIORS_MIN_SYNC_GAP_MIN"]);
  return Number.isFinite(m) && m > 0 ? m * 60_000 : DEFAULT_MIN_SYNC_GAP_MS;
}

/**
 * Delay before the next watch-driven sync may run: `debounceMs` normally, or
 * long enough to clear the floor when the last sync was recent. Never negative.
 * `lastSyncAt === 0` (no sync yet this process) takes the plain debounce.
 */
export function syncDelayMs(
  now: number,
  lastSyncAt: number,
  debounceMs: number,
  gapMs: number = minSyncGapMs(),
): number {
  if (lastSyncAt <= 0) return debounceMs;
  return Math.max(debounceMs, lastSyncAt + gapMs - now);
}
