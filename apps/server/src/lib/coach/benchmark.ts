import { and, eq, gte } from "drizzle-orm";
import type { DB } from "../../db/index.js";
import { users, usageDays } from "../../db/schema.js";
import type { Benchmarks } from "./types.js";

// Reuses the value of PERCENTILE_MIN_POPULATION (craft-score.ts:42) so the two
// systems flip to cohort percentiles at the same population.
export const COHORT_MIN_POPULATION = 30;

const WINDOW_DAYS = 30;
const TTL_MS = 60 * 60 * 1000; // 1h lazy materialization

/** Percentile of `value` within `population` — count strictly below, / (n-1). */
export function percentileRank(value: number, population: number[]): number {
  const below = population.filter((p) => p < value).length;
  return Math.round((below / Math.max(1, population.length - 1)) * 100);
}

/** Wrap precomputed distributions in the Benchmarks interface (pop-gated). */
export function makeBenchmarks(distributions: Record<string, number[]>): Benchmarks {
  const primary = distributions["cacheReadRatio"]?.length ?? 0;
  return {
    population: primary,
    rank(metric, value) {
      const pop = distributions[metric];
      if (!pop || pop.length < COHORT_MIN_POPULATION) return null;
      return { percentile: percentileRank(value, pop), population: pop.length };
    },
  };
}

/**
 * Per-consenting-public-user window cache-read ratio across the cohort.
 * cacheReadRatio = cacheRead / (input + cacheCreation + cacheRead) over the window.
 */
export async function loadCohortDistributions(db: DB, now: number): Promise<Record<string, number[]>> {
  const cutoff = new Date(now - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  const rows = await db
    .select({
      userId: usageDays.userId,
      input: usageDays.inputTokens,
      cacheCreate: usageDays.cacheCreationTokens,
      cacheRead: usageDays.cacheReadTokens,
    })
    .from(usageDays)
    .innerJoin(users, eq(users.id, usageDays.userId))
    .where(and(
      gte(usageDays.day, cutoff),
      eq(users.insightsConsent, true),
      eq(users.insightsVisibility, "public"),
    ));
  const sums = new Map<string, { read: number; denom: number }>();
  for (const r of rows) {
    const prev = sums.get(r.userId) ?? { read: 0, denom: 0 };
    prev.read += r.cacheRead;
    prev.denom += r.input + r.cacheCreate + r.cacheRead;
    sums.set(r.userId, prev);
  }
  const cacheReadRatio: number[] = [];
  for (const { read, denom } of sums.values()) {
    if (denom > 0) cacheReadRatio.push(Math.round((read / denom) * 1000) / 1000);
  }
  return { cacheReadRatio };
}

let cache: { at: number; benchmarks: Benchmarks } | null = null;

/** TTL-cached Benchmarks. Recomputes the cohort at most once per TTL_MS. */
export async function loadBenchmarks(db: DB, now: number): Promise<Benchmarks> {
  if (!cache || now - cache.at > TTL_MS) {
    cache = { at: now, benchmarks: makeBenchmarks(await loadCohortDistributions(db, now)) };
  }
  return cache.benchmarks;
}

/** Test seam: drop the cached cohort so the next loadBenchmarks recomputes. */
export function clearBenchmarkCache(): void {
  cache = null;
}
