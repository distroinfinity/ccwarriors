// 8-bucket activity spark over the last 30 days.
// Bucket i covers [now-30d + i*3.75d, now-30d + (i+1)*3.75d).
// Costs are summed per bucket (rows may repeat a day across machines/tools).
// Normalized 0-7 against the user's own max bucket; all-zero → undefined.

const BUCKETS = 8;
const WINDOW_DAYS = 30;
const BUCKET_WIDTH_MS = (WINDOW_DAYS / BUCKETS) * 86_400_000; // 3.75d

export function computeSpark(
  dayRows: Array<{ day: string; cost: number }>,
  now: Date = new Date(),
): number[] | undefined {
  if (dayRows.length === 0) return undefined;

  const windowStart = now.getTime() - WINDOW_DAYS * 86_400_000;
  const buckets = new Array<number>(BUCKETS).fill(0);

  for (const { day, cost } of dayRows) {
    // Parse YYYY-MM-DD as UTC midnight (matches usage_days.day semantics).
    const dayMs = new Date(`${day}T00:00:00Z`).getTime();
    if (!Number.isFinite(dayMs) || dayMs < windowStart || dayMs >= now.getTime()) continue;
    const offset = dayMs - windowStart;
    const idx = Math.min(Math.floor(offset / BUCKET_WIDTH_MS), BUCKETS - 1);
    buckets[idx] = (buckets[idx] ?? 0) + cost;
  }

  const max = Math.max(...buckets);
  if (max === 0) return undefined;

  return buckets.map((c) => {
    if (c === 0) return 0;
    // nonzero bucket: ceil to 1..7, scale against max.
    return Math.max(1, Math.min(7, Math.ceil((c / max) * 7)));
  });
}
