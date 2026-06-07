import { describe, it, expect } from "vitest";
import {
  mergeInsights,
  calibratedAxes,
  percentileAxes,
  archetypeOf,
  traitOf,
  growthEdgeOf,
  habitStats,
  MIN_SESSIONS,
  PERCENTILE_MIN_POPULATION,
  AXES,
  type MergedInsights,
} from "../src/lib/insights.js";
import type { InsightsPayload } from "../src/db/schema.js";

function payload(over: Partial<InsightsPayload> = {}): InsightsPayload {
  return {
    windowDays: 40,
    sessions: 50,
    promptWordHistogram: { "1-5": 100, "6-10": 60, "11-25": 30, "26+": 10 },
    planModeSessionsPct: 20,
    exploreBeforeEditRatio: 0.5,
    avgTurnsBetweenUserMsgs: 8,
    interruptsPer100Turns: 5,
    subagentSpawnsPerSession: 1.0,
    maxParallelAgents: 3,
    hourHistogram: Array(24).fill(0).map((_, h) => (h >= 9 && h <= 18 ? 5 : 0)),
    editToolCallsPerSession: 15,
    longestSessionMinutes: 90,
    ...over,
  };
}

describe("mergeInsights", () => {
  it("weights rates by sessions, sums histograms, maxes parallel", () => {
    const a = payload({ sessions: 10, planModeSessionsPct: 0, maxParallelAgents: 2 });
    const b = payload({ sessions: 30, planModeSessionsPct: 40, maxParallelAgents: 6 });
    const m = mergeInsights([a, b]);
    expect(m.sessions).toBe(40);
    expect(m.planModeSessionsPct).toBeCloseTo(30); // (0*10 + 40*30) / 40
    expect(m.maxParallelAgents).toBe(6);
    expect(m.promptWordHistogram["1-5"]).toBe(200);
  });
});

describe("calibratedAxes", () => {
  it("returns 0-100 for all five axes", () => {
    const axes = calibratedAxes(mergeInsights([payload()]));
    expect(Object.keys(axes).sort()).toEqual([...AXES].sort());
    for (const v of Object.values(axes)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });
  it("heavy summoner scores summoning highest", () => {
    const axes = calibratedAxes(
      mergeInsights([payload({ subagentSpawnsPerSession: 4, maxParallelAgents: 8, planModeSessionsPct: 5 })]),
    );
    const top = Object.entries(axes).sort((x, y) => y[1] - x[1])[0]![0];
    expect(top).toBe("summoning");
  });
});

describe("percentileAxes", () => {
  it("ranks within the population", () => {
    const pop: MergedInsights[] = [
      mergeInsights([payload({ planModeSessionsPct: 5 })]),
      mergeInsights([payload({ planModeSessionsPct: 20 })]),
      mergeInsights([payload({ planModeSessionsPct: 60 })]),
    ];
    const scores = percentileAxes(pop[2]!, pop);
    expect(scores.planning).toBeGreaterThan(percentileAxes(pop[0]!, pop).planning);
  });
});

describe("archetypeOf", () => {
  it("maps dominant axis to class", () => {
    expect(archetypeOf({ planning: 90, autonomy: 10, steering: 10, summoning: 10, velocity: 10 })).toBe(
      "The Tactician",
    );
    expect(archetypeOf({ planning: 10, autonomy: 10, steering: 10, summoning: 95, velocity: 50 })).toBe(
      "The Summoner",
    );
  });
});

describe("traitOf", () => {
  it("detects night stalker from hour histogram", () => {
    const hours = Array(24).fill(0);
    hours[23] = 20;
    hours[0] = 20;
    hours[13] = 10;
    const m = mergeInsights([payload({ hourHistogram: hours })]);
    expect(traitOf(m, { weekendShare: 0.1, currentStreak: 2 })).toBe("Night Stalker");
  });
  it("falls back to daily grinder on long streaks", () => {
    const m = mergeInsights([payload()]); // daytime hours
    expect(traitOf(m, { weekendShare: 0.1, currentStreak: 20 })).toBe("Daily Grinder");
  });
});

describe("growthEdgeOf", () => {
  it("low planning + high interrupts suggests plan mode", () => {
    const m = mergeInsights([payload({ interruptsPer100Turns: 12 })]);
    const edge = growthEdgeOf({ planning: 20, autonomy: 50, steering: 50, summoning: 50, velocity: 50 }, m, null);
    expect(edge).toContain("plan mode");
  });
});

describe("habitStats", () => {
  it("computes short prompt percentage", () => {
    const h = habitStats(mergeInsights([payload()]));
    expect(h.shortPromptPct).toBe(80); // (100+60)/200
  });
});

describe("constants", () => {
  it("documents the gates", () => {
    expect(MIN_SESSIONS).toBe(10);
    expect(PERCENTILE_MIN_POPULATION).toBe(30);
  });
});
