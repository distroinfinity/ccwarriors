import { describe, it, expect } from "vitest";
import { cacheEfficiencyAdvisor } from "../../src/lib/coach/advisors/cache-efficiency.js";
import { burnForecastAdvisor } from "../../src/lib/coach/advisors/burn-forecast.js";
import type { CoachContext } from "../../src/lib/coach/types.js";
import { makeBenchmarks } from "../../src/lib/coach/benchmark.js";

function ctx(over: Partial<CoachContext> = {}): CoachContext {
  return {
    now: Date.UTC(2026, 5, 15), windowDays: 30, isOwner: true, deepMode: false, windowCostUsd: 100,
    usageByTool: [{ tool: "claude", cost: 100, inputTokens: 1_000_000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 1_000_000 }],
    efficiency: { cacheReadRatio: 0.5, opusShare: 0.9, modelMix: [{ family: "opus", share: 0.9 }], grade: "D", estSavingsPerMonth: null, tokensPerActiveDay: null },
    monthlyCacheRatios: [{ month: "2026-04", ratio: 0.85 }, { month: "2026-05", ratio: 0.5 }],
    burn: { projectedMonthUsd: 120, priorMonthUsd: 80, runRatePerDay: 4 },
    deepSessions: [], benchmarks: makeBenchmarks({}), ...over,
  };
}

describe("cacheEfficiencyAdvisor", () => {
  it("fires a save rec with a dollar range when below self-best", () => {
    const rec = cacheEfficiencyAdvisor(ctx())!;
    expect(rec).not.toBeNull();
    expect(rec.id).toBe("cache-efficiency");
    expect(rec.severity).toBe("save");
    expect(rec.visibility).toBe("owner");
    expect(rec.dollarImpact).not.toBeNull();
    expect(rec.dollarImpact!.low).toBeLessThanOrEqual(rec.dollarImpact!.high);
    expect(rec.evidenceLine).toContain("50%"); // current ratio, real number leads
    expect(rec.evidenceLine).toContain("85%"); // self-best
    expect(rec.themeKey).toBe("mid-session-switch");
  });

  it("emits a positive 'good' rec (no dollar) when within 5 points of self-best", () => {
    const rec = cacheEfficiencyAdvisor(ctx({
      efficiency: { cacheReadRatio: 0.96, opusShare: 0.9, modelMix: [], grade: "A+", estSavingsPerMonth: null, tokensPerActiveDay: null },
      monthlyCacheRatios: [{ month: "2026-05", ratio: 0.95 }],
    }))!;
    expect(rec.severity).toBe("good");
    expect(rec.dollarImpact).toBeNull();
    expect(rec.themeKey).toBe("mid-session-switch");
  });

  it("returns null when cacheReadRatio is unavailable", () => {
    expect(cacheEfficiencyAdvisor(ctx({
      efficiency: { cacheReadRatio: null, opusShare: 0, modelMix: [], grade: null, estSavingsPerMonth: null, tokensPerActiveDay: null },
    }))).toBeNull();
    expect(cacheEfficiencyAdvisor(ctx({ efficiency: null }))).toBeNull();
  });
});

describe("burnForecastAdvisor", () => {
  it("warns (improve) when projected spend outpaces prior month by >=20%", () => {
    const rec = burnForecastAdvisor(ctx({ burn: { projectedMonthUsd: 120, priorMonthUsd: 80, runRatePerDay: 4 } }))!;
    expect(rec.id).toBe("burn-forecast");
    expect(rec.severity).toBe("improve");
    expect(rec.dollarImpact).toBeNull(); // pacing only, no $ opportunity
    expect(rec.evidenceLine).toContain("$120");
  });

  it("is reassuring (good) when on or below prior pace", () => {
    expect(burnForecastAdvisor(ctx({ burn: { projectedMonthUsd: 70, priorMonthUsd: 80, runRatePerDay: 2 } }))!.severity).toBe("good");
  });

  it("returns null when there is no spend at all", () => {
    expect(burnForecastAdvisor(ctx({ windowCostUsd: 0, burn: { projectedMonthUsd: 0, priorMonthUsd: null, runRatePerDay: 0 } }))).toBeNull();
  });
});
