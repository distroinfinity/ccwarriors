// Tiny in-memory sliding-window rate limiter for anonymous endpoints.
// Authenticated ingest limits per-user via lastSyncedAt; this covers routes
// with no identity (donate orders) keyed by client IP. Per-process state is
// fine — we run a single Railway instance.

export function createRateLimiter(max: number, windowMs: number) {
  const hits = new Map<string, number[]>();

  return function allow(key: string, now: number = Date.now()): boolean {
    // Opportunistic sweep so abandoned keys can't grow the map forever.
    if (hits.size > 10_000) {
      const cutoff = now - windowMs;
      for (const [k, list] of hits) {
        if (list.every((t) => t <= cutoff)) hits.delete(k);
      }
    }
    const cutoff = now - windowMs;
    const recent = (hits.get(key) ?? []).filter((t) => t > cutoff);
    if (recent.length >= max) {
      hits.set(key, recent);
      return false;
    }
    recent.push(now);
    hits.set(key, recent);
    return true;
  };
}
