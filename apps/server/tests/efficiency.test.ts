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
  it("grades a cache-warm mix highly", () => {
    const rows = [day("2026-06-01", 10, false, 9000), day("2026-06-02", 10, false, 9000)];
    const e = computeEfficiency(rows, "2026-05-08");
    expect(e.cacheReadRatio).toBeCloseTo(0.9, 1); // 9000 / (1000+9000)
    expect(e.grade).toBe("A");
  });
  it("does NOT penalize Opus — grade is cache-based (prod: ~90% Opus is the norm)", () => {
    // Heavy Opus but warm cache → still graded well; no 'move to Sonnet' nudge.
    const opusWarm = computeEfficiency([day("2026-06-01", 100, true, 9000)], "2026-05-08");
    expect(opusWarm.opusShare).toBe(1);
    expect(opusWarm.grade).toBe("A");
    expect(opusWarm.estSavingsPerMonth).toBeNull();
    // Poor cache hygiene is what grades down, regardless of model.
    const opusCold = computeEfficiency([day("2026-06-01", 100, true, 0)], "2026-05-08");
    expect(opusCold.grade).toBe("D");
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

describe("edge cases", () => {
  it("returns nulls on an empty window", () => {
    const e = computeEfficiency([], "2026-05-08");
    expect(e.grade).toBeNull();
    expect(e.cacheReadRatio).toBeNull();
    expect(e.tokensPerActiveDay).toBeNull();
  });
  it("tolerates null modelBreakdown rows", () => {
    const e = computeEfficiency([{ day: "2026-06-01", cost: 5, modelBreakdown: null }], "2026-05-08");
    expect(Number.isNaN(e.opusShare)).toBe(false);
    expect(e.tokensPerActiveDay).toBeNull();
  });
  it("current streak is 0 when today is inactive", () => {
    const r = computeRhythm([day("2026-06-01", 1), day("2026-06-02", 1)], "2026-06-07");
    expect(r.currentStreak).toBe(0);
    expect(r.longestStreak).toBe(2);
  });
});
