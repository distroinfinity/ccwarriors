import { describe, it, expect } from "vitest";
import { computeEfficiency, computeRhythm } from "../src/lib/efficiency.js";

const day = (d: string, cost: number, opus = false, cacheRead = 0, input = 1000): {
  day: string; cost: number; modelBreakdown: { modelName: string; inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number }[] | null;
} => ({
  day: d,
  cost,
  modelBreakdown: [
    {
      modelName: opus ? "claude-opus-4-20250805" : "claude-sonnet-4-5",
      inputTokens: input,
      outputTokens: 200,
      cacheCreationTokens: 0,
      cacheReadTokens: cacheRead,
    },
  ],
});

describe("computeEfficiency", () => {
  it("grades a sonnet-heavy, cache-warm mix highly", () => {
    const rows = [day("2026-06-01", 10, false, 9000), day("2026-06-02", 10, false, 9000)];
    const e = computeEfficiency(rows, "2026-05-08");
    expect(e.opusShare).toBe(0);
    expect(e.cacheReadRatio).toBeGreaterThan(0.8);
    expect(e.grade).toBe("A+");
  });
  it("flags an opus-heavy mix with savings", () => {
    const rows = [day("2026-06-01", 100, true, 0)];
    const e = computeEfficiency(rows, "2026-05-08");
    expect(e.opusShare).toBe(1);
    expect(e.estSavingsPerMonth).toBeGreaterThan(0);
    expect(["C", "D"]).toContain(e.grade);
  });
});

describe("computeRhythm", () => {
  it("computes streaks over contiguous days", () => {
    const rows = [day("2026-06-05", 1), day("2026-06-06", 1), day("2026-06-07", 1), day("2026-06-01", 1)];
    const r = computeRhythm(rows, "2026-06-07");
    expect(r.currentStreak).toBe(3);
    expect(r.longestStreak).toBe(3);
    expect(r.days.length).toBe(4);
  });
});
