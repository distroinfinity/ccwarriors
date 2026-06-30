import type { Recommendation } from "./types.js";

const CONFIDENCE_WEIGHT: Record<Recommendation["confidence"], number> = { solid: 1.0, early: 0.5 };
const SEVERITY_SCALAR: Record<Recommendation["severity"], number> = { save: 20, improve: 10, good: 0 };

/** Conservative expected impact: dollar low-end, or a severity scalar for outcome-only recs. */
export function expectedImpact(rec: Recommendation): number {
  return rec.dollarImpact ? rec.dollarImpact.low : SEVERITY_SCALAR[rec.severity];
}

function score(rec: Recommendation): number {
  return expectedImpact(rec) * CONFIDENCE_WEIGHT[rec.confidence];
}

/**
 * Rank fired recommendations by score (desc), collapsing near-twins that share a
 * themeKey: keep the higher-scored, append the dropped rec's action to it.
 */
export function rankRecommendations(recs: Recommendation[]): Recommendation[] {
  const sorted = [...recs].sort((a, b) => score(b) - score(a));
  const byTheme = new Map<string, Recommendation>();
  const out: Recommendation[] = [];
  for (const rec of sorted) {
    if (!rec.themeKey) { out.push(rec); continue; }
    const winner = byTheme.get(rec.themeKey);
    if (!winner) {
      const copy = { ...rec };
      byTheme.set(rec.themeKey, copy);
      out.push(copy);
    } else if (!winner.action.includes(rec.action)) {
      winner.action = `${winner.action} ${rec.action}`;
    }
  }
  return out;
}
