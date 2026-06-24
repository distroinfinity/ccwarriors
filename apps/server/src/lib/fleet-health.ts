/** A user with any recent spend in the window — a live daemon, not an idle account. */
export function isActive(entry: { spark?: number[] }): boolean {
  return (entry.spark ?? []).reduce((a, b) => a + b, 0) > 0;
}

// Silent-daemon detector: an "active" user (nonzero recent spark) whose last
// sync has gone stale is very likely a dead daemon (#91), not an idle laptop.
export function countSilentActive(
  entries: { lastSyncedAt?: number; spark?: number[] }[],
  now: number,
  thresholdMs: number,
): number {
  let n = 0;
  for (const e of entries) {
    if (e.lastSyncedAt == null) continue;
    if (isActive(e) && now - e.lastSyncedAt > thresholdMs) n++;
  }
  return n;
}
