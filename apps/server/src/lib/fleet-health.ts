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
    const active = (e.spark ?? []).reduce((a, b) => a + b, 0) > 0;
    if (active && now - e.lastSyncedAt > thresholdMs) n++;
  }
  return n;
}
