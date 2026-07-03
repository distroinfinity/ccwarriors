import { describe, it, expect } from "vitest";
import { wasteDetectorAdvisor } from "../../src/lib/coach/advisors/waste-detector.js";
import type { CoachContext } from "../../src/lib/coach/types.js";
import { makeBenchmarks } from "../../src/lib/coach/benchmark.js";
import { sess, git } from "./deep-fixtures.js";

// Minimal deep-mode context; override deepSessions / benchmarks per test.
function ctx(over: Partial<CoachContext> = {}): CoachContext {
  return {
    now: Date.UTC(2026, 5, 15), windowDays: 30, isOwner: true, deepMode: true,
    windowCostUsd: 100, usageByTool: [], efficiency: null, monthlyCacheRatios: [],
    burn: { projectedMonthUsd: 0, priorMonthUsd: null, runRatePerDay: 0 },
    deepSessions: [], benchmarks: makeBenchmarks({}), ...over,
  };
}

describe("wasteDetectorAdvisor", () => {
  it("returns null when not in deep mode", () => {
    expect(wasteDetectorAdvisor(ctx({ deepMode: false }))).toBeNull();
  });

  it("returns null below the session floor", () => {
    expect(wasteDetectorAdvisor(ctx({ deepSessions: [sess({ git: git({ linesAdded: 100, revertedLinesWithin14d: 50 }) })] }))).toBeNull();
  });

  it("leads with the user's own revert ratio and hides a peer number below n=30", () => {
    const sessions = Array.from({ length: 6 }, () => sess({ estimatedCost: 10, git: git({ linesAdded: 100, revertedLinesWithin14d: 20 }) }));
    const rec = wasteDetectorAdvisor(ctx({ deepSessions: sessions }))!;
    expect(rec.id).toBe("waste-detector");
    expect(rec.visibility).toBe("owner");
    expect(rec.evidenceLine).toContain("20%");        // own ratio, provenance = own-data
    expect(rec.evidenceLine).not.toContain("cohort"); // n<30 → no fabricated peer
    expect(rec.severity).toBe("save");
    expect(rec.dollarImpact).not.toBeNull();
  });

  it("appends a cohort median when population >= 30", () => {
    const sessions = Array.from({ length: 6 }, () => sess({ estimatedCost: 10, git: git({ linesAdded: 100, revertedLinesWithin14d: 20 }) }));
    const benchmarks = makeBenchmarks({ revertRatio: Array.from({ length: 30 }, () => 0.05) });
    const rec = wasteDetectorAdvisor(ctx({ deepSessions: sessions, benchmarks }))!;
    expect(rec.evidenceLine).toContain("cohort");
    expect(rec.evidenceLine).toContain("n=30");
  });
});
