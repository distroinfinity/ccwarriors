import { describe, expect, it } from "vitest";
import { computeSpark } from "../src/lib/spark.js";

// Anchor: 2026-06-04T12:00Z (noon UTC, ensures day strings don't cross midnight boundaries)
const NOW = new Date("2026-06-04T12:00:00Z");

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 86_400_000).toISOString().slice(0, 10);
}

describe("computeSpark", () => {
  it("returns undefined for empty input", () => {
    expect(computeSpark([], NOW)).toBeUndefined();
  });

  it("returns undefined when all costs are zero", () => {
    const rows = [{ day: daysAgo(1), cost: 0 }, { day: daysAgo(5), cost: 0 }];
    expect(computeSpark(rows, NOW)).toBeUndefined();
  });

  it("returns undefined when all rows are outside the 30d window", () => {
    // 31 days ago — ISO midnight (T00:00:00Z) is before windowStart
    // Use 35 days to be safely outside.
    const rows = [{ day: daysAgo(35), cost: 100 }];
    expect(computeSpark(rows, NOW)).toBeUndefined();
  });

  it("returns an array of length 8", () => {
    const rows = [{ day: daysAgo(1), cost: 10 }];
    const spark = computeSpark(rows, NOW);
    expect(spark).toHaveLength(8);
  });

  it("max bucket normalizes to 7", () => {
    // Single day with all cost → one bucket = max → normalized to 7
    const rows = [{ day: daysAgo(1), cost: 100 }];
    const spark = computeSpark(rows, NOW)!;
    expect(Math.max(...spark)).toBe(7);
  });

  it("zero buckets stay 0, nonzero bucket is 7 (sole spend = max)", () => {
    // Day in bucket 7 (1 day ago) only
    const rows = [{ day: daysAgo(1), cost: 5 }];
    const spark = computeSpark(rows, NOW)!;
    // Last bucket (idx 7) should be 7 (sole nonzero = max)
    expect(spark[7]).toBe(7);
    // All other buckets should be 0
    expect(spark.slice(0, 7).every((v) => v === 0)).toBe(true);
  });

  it("small-but-nonzero bucket is at least 1", () => {
    // Use a day in bucket 0 (far edge of the window, ~29 days ago) and a big one near the end.
    // 29 days ago: ISO day is 2026-05-06, midnight is 2026-05-06T00:00:00Z.
    // windowStart = 2026-05-05T12:00:00Z, so 2026-05-06T00:00:00Z is after windowStart → in window.
    const rows = [
      { day: daysAgo(29), cost: 0.001 },  // tiny cost, bucket 0
      { day: daysAgo(1), cost: 1000 },    // large cost, bucket 7
    ];
    const spark = computeSpark(rows, NOW)!;
    expect(spark).toBeDefined();
    // The tiny bucket must still be at least 1
    const bucket0 = spark[0];
    expect(bucket0).toBeGreaterThanOrEqual(1);
    expect(spark[7]).toBe(7);
  });

  it("day in bucket 0 (29 days ago) is correctly included", () => {
    // 2026-05-06 midnight UTC vs windowStart 2026-05-05T12:00Z → in window
    const rows = [{ day: daysAgo(29), cost: 50 }];
    const spark = computeSpark(rows, NOW);
    expect(spark).toBeDefined();
    expect(spark!.some((v) => v > 0)).toBe(true);
    // Should land in bucket 0 or 1 (early window)
    expect((spark![0] ?? 0) > 0 || (spark![1] ?? 0) > 0).toBe(true);
  });

  it("costs for the same day across multiple rows are summed", () => {
    const day = daysAgo(1);
    const rowsSplit = [{ day, cost: 30 }, { day, cost: 70 }];
    const rowsCombined = [{ day, cost: 100 }];
    const sparkSplit = computeSpark(rowsSplit, NOW);
    const sparkCombined = computeSpark(rowsCombined, NOW);
    expect(sparkSplit).toEqual(sparkCombined);
  });

  it("future days are excluded", () => {
    // A day string for tomorrow (after NOW) must be excluded
    const tomorrow = new Date(NOW.getTime() + 86_400_000).toISOString().slice(0, 10);
    const rows = [{ day: tomorrow, cost: 100 }];
    expect(computeSpark(rows, NOW)).toBeUndefined();
  });

  it("bucketing: a recent day lands in bucket 7 (the latest bucket)", () => {
    // 1 day ago is well within the last bucket of an 8-bucket 30d window
    const rows = [{ day: daysAgo(1), cost: 10 }];
    const spark = computeSpark(rows, NOW)!;
    // bucket 7 covers days [30 - 1*3.75, 30)d ago = [26.25d, 30d) from window start
    // 1 day ago = 29 days from window start → bucket 7 (offset 29d, width 3.75d → idx 7)
    expect(spark[7]).toBeGreaterThan(0);
  });

  it("bucketing: a day 15 days ago lands in bucket 3 (middle)", () => {
    // NOW = 2026-06-04T12:00Z; 15 days ago = 2026-05-20; UTC midnight = 2026-05-20T00:00Z
    // windowStart = 2026-05-05T12:00Z; offset = 14.5d; bucket = floor(14.5 / 3.75) = 3
    const rows = [{ day: daysAgo(15), cost: 10 }];
    const spark = computeSpark(rows, NOW)!;
    expect(spark[3]).toBeGreaterThan(0);
  });
});
