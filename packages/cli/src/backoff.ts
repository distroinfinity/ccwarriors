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
