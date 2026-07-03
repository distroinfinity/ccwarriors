import { describe, it, expect } from "vitest";
import { wasteDetectorAdvisor } from "../../src/lib/coach/advisors/waste-detector.js";
import { costPerOutcomeAdvisor } from "../../src/lib/coach/advisors/cost-per-outcome.js";
import { taskFitAdvisor } from "../../src/lib/coach/advisors/task-fit.js";
import { skillFitAdvisor } from "../../src/lib/coach/advisors/skill-fit.js";
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

describe("costPerOutcomeAdvisor", () => {
  it("is public, reports $/surviving-line + a labeled PR proxy", () => {
    const sessions = Array.from({ length: 6 }, () => sess({
      estimatedCost: 50, git: git({ linesAdded: 100, revertedLinesWithin14d: 0, commitsInWindow: 2, hasRemote: true }),
    }));
    const rec = costPerOutcomeAdvisor(ctx({ deepSessions: sessions }))!;
    expect(rec.visibility).toBe("public");
    expect(rec.severity).toBe("good");
    expect(rec.dollarImpact).toBeNull();
    expect(rec.evidenceLine).toContain("surviving line");
    expect(rec.evidenceLine.toLowerCase()).toContain("proxy");
    expect(rec.outcomeImpact).not.toBeNull();
  });

  it("returns null in deep mode with no surviving lines", () => {
    const sessions = Array.from({ length: 6 }, () => sess({ estimatedCost: 5, git: git({ linesAdded: 0 }) }));
    expect(costPerOutcomeAdvisor(ctx({ deepSessions: sessions }))).toBeNull();
  });
});

describe("taskFitAdvisor", () => {
  const refactor = (over: Parameters<typeof git>[0]) => git({ commitKinds: { fixes: 0, features: 0, refactors: 3, other: 0 }, ...over });

  it("returns null with only one tool/model group in a kind", () => {
    const sessions = Array.from({ length: 6 }, () => sess({ tool: "claude", estimatedCost: 10, git: refactor({ linesAdded: 100 }) }));
    expect(taskFitAdvisor(ctx({ deepSessions: sessions }))).toBeNull();
  });

  it("recommends the higher-yield agent for a comparable kind, within-user", () => {
    const claude = Array.from({ length: 5 }, () => sess({ tool: "claude", model: "claude-opus-4-7", estimatedCost: 100, git: refactor({ linesAdded: 100, revertedLinesWithin14d: 0 }) })); // 1 LOC/$
    const codex = Array.from({ length: 5 }, () => sess({ tool: "codex", model: "gpt-5-codex", estimatedCost: 100, git: refactor({ linesAdded: 300, revertedLinesWithin14d: 0 }) }));   // 3 LOC/$
    const rec = taskFitAdvisor(ctx({ deepSessions: [...claude, ...codex] }))!;
    expect(rec.id).toBe("task-fit");
    expect(rec.visibility).toBe("owner");
    expect(rec.evidenceLine).toContain("refactors");
    expect(rec.evidenceLine.toLowerCase()).toContain("codex");
    expect(rec.outcomeImpact).toContain("×");
  });

  it("excludes a sub-floor group so a kind with one qualifying group stays silent", () => {
    const claude = Array.from({ length: 5 }, () => sess({ tool: "claude", model: "claude-opus-4-7", estimatedCost: 100, git: refactor({ linesAdded: 100 }) }));
    const codex = Array.from({ length: 4 }, () => sess({ tool: "codex", model: "gpt-5-codex", estimatedCost: 100, git: refactor({ linesAdded: 300 }) })); // 4 < MIN_KIND_SESSIONS → excluded
    // Only the claude group clears the 5-session floor → one comparable group → not comparable → null.
    expect(taskFitAdvisor(ctx({ deepSessions: [...claude, ...codex] }))).toBeNull();
  });
});

describe("skillFitAdvisor", () => {
  it("data branch: fires when skill sessions revert materially less (own-data)", () => {
    const withSkill = Array.from({ length: 5 }, () => sess({
      skillsUsed: { "test-driven-development": 1 }, git: git({ linesAdded: 100, revertedLinesWithin14d: 5 }),
    }));
    const without = Array.from({ length: 5 }, () => sess({ git: git({ linesAdded: 100, revertedLinesWithin14d: 40 }) }));
    const rec = skillFitAdvisor(ctx({ deepSessions: [...withSkill, ...without] }))!;
    expect(rec.id).toBe("skill-fit");
    expect(rec.visibility).toBe("owner");
    expect(rec.evidenceLine).toContain("test-driven-development");
    expect(rec.confidence).toBe("solid");
    expect(rec.action).toContain("test-driven-development");
  });

  it("catalog branch: high revert + no systematic-debugging → early suggestion", () => {
    const sessions = Array.from({ length: 6 }, () => sess({ git: git({ linesAdded: 100, revertedLinesWithin14d: 30 }) }));
    const rec = skillFitAdvisor(ctx({ deepSessions: sessions }))!;
    expect(rec.confidence).toBe("early");
    expect(rec.action.toLowerCase()).toContain("systematic-debugging");
  });

  it("returns null in deep mode with low revert and no skill split", () => {
    const sessions = Array.from({ length: 6 }, () => sess({ git: git({ linesAdded: 100, revertedLinesWithin14d: 2 }) }));
    expect(skillFitAdvisor(ctx({ deepSessions: sessions }))).toBeNull();
  });
});
