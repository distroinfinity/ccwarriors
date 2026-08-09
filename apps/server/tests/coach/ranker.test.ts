import { describe, it, expect } from "vitest";
import { expectedImpact, rankRecommendations } from "../../src/lib/coach/ranker.js";
import type { Recommendation } from "../../src/lib/coach/types.js";

function rec(over: Partial<Recommendation>): Recommendation {
  return {
    id: "x", tier: 1, category: "spend", visibility: "owner", title: "t", evidenceLine: "e",
    action: "a", dollarImpact: null, outcomeImpact: null, confidence: "solid", severity: "improve",
    locked: false, ...over,
  };
}

describe("expectedImpact", () => {
  it("uses the conservative low end of a dollar range", () => {
    expect(expectedImpact(rec({ dollarImpact: { low: 20, high: 80 } }))).toBe(20);
  });
  it("maps severity to a scalar for outcome-only recs", () => {
    expect(expectedImpact(rec({ dollarImpact: null, severity: "save" }))).toBe(20);
    expect(expectedImpact(rec({ dollarImpact: null, severity: "improve" }))).toBe(10);
    expect(expectedImpact(rec({ dollarImpact: null, severity: "good" }))).toBe(0);
  });
});

describe("rankRecommendations", () => {
  it("orders by expectedImpact * confidenceWeight, descending", () => {
    const a = rec({ id: "a", dollarImpact: { low: 50, high: 50 }, confidence: "early" }); // 25
    const b = rec({ id: "b", dollarImpact: { low: 30, high: 30 }, confidence: "solid" }); // 30
    const out = rankRecommendations([a, b]);
    expect(out.map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("collapses near-twins sharing a themeKey, keeping the higher score and merging the action", () => {
    const strong = rec({ id: "strong", themeKey: "switch", dollarImpact: { low: 40, high: 40 }, action: "Do strong thing." });
    const weak = rec({ id: "weak", themeKey: "switch", dollarImpact: { low: 10, high: 10 }, action: "Do weak thing." });
    const out = rankRecommendations([weak, strong]);
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe("strong");
    expect(out[0]!.action).toContain("Do strong thing.");
    expect(out[0]!.action).toContain("Do weak thing.");
  });

  it("never dedupes recs that have no themeKey", () => {
    const out = rankRecommendations([rec({ id: "a" }), rec({ id: "b" })]);
    expect(out).toHaveLength(2);
  });
});
