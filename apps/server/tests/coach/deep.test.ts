import { describe, it, expect } from "vitest";
import { revertRatio, survivingLoc, dollarPerSurvivingLine, survivingLocPerDollar, dominantKind, groupBy } from "../../src/lib/coach/deep.js";
import { sess, git } from "./deep-fixtures.js";

describe("deep.ts aggregation", () => {
  it("revertRatio = reverted/added, null when no added lines", () => {
    expect(revertRatio([sess({ git: git({ linesAdded: 100, revertedLinesWithin14d: 20 }) })])).toBeCloseTo(0.2, 5);
    expect(revertRatio([sess({ git: null })])).toBeNull();
  });

  it("survivingLoc floors per-session at 0 and sums", () => {
    expect(survivingLoc([
      sess({ git: git({ linesAdded: 100, revertedLinesWithin14d: 30 }) }),
      sess({ git: git({ linesAdded: 10, revertedLinesWithin14d: 40 }) }), // floored to 0, not -30
    ])).toBe(70);
  });

  it("dollarPerSurvivingLine and survivingLocPerDollar", () => {
    const s = [sess({ estimatedCost: 50, git: git({ linesAdded: 100, revertedLinesWithin14d: 0 }) })];
    expect(dollarPerSurvivingLine(s)).toBeCloseTo(0.5, 5);
    expect(survivingLocPerDollar(s)).toBeCloseTo(2, 5);
    expect(dollarPerSurvivingLine([sess({ estimatedCost: 5, git: git({ linesAdded: 0 }) })])).toBeNull();
  });

  it("dominantKind picks the max commit kind, null when all zero or absent", () => {
    expect(dominantKind(git({ commitKinds: { fixes: 1, features: 4, refactors: 2, other: 0 } }))).toBe("features");
    expect(dominantKind(git({ commitKinds: { fixes: 0, features: 0, refactors: 0, other: 0 } }))).toBeNull();
    expect(dominantKind(git())).toBeNull(); // commitKinds absent
  });

  it("groupBy buckets by key", () => {
    const g = groupBy([sess({ tool: "claude" }), sess({ tool: "codex" }), sess({ tool: "claude" })], (s) => s.tool);
    expect(g.get("claude")!.length).toBe(2);
    expect(g.get("codex")!.length).toBe(1);
  });
});
