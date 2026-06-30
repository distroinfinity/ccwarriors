import type { Advisor } from "../types.js";
import { pct } from "../format.js";

const TARGET_FLOOR = 0.9;       // a healthy cache-read ratio to aim for
const NEAR_BEST = 0.05;         // within 5 points of target => positive reinforcement
const CACHE_DISCOUNT = 0.9;     // cache reads cost ~10% of fresh input
const LOW_BAND = 0.5;           // conservative low end of the opportunity range

export const cacheEfficiencyAdvisor: Advisor = (ctx) => {
  const ratio = ctx.efficiency?.cacheReadRatio;
  if (ratio === null || ratio === undefined) return null;

  // Self-best is the user's real historical best — the evidence leads with it.
  // The gap is measured against the better of self-best and a healthy floor, so
  // a steadily-mediocre user is nudged rather than congratulated.
  const selfBest = Math.max(ratio, ...ctx.monthlyCacheRatios.map((m) => m.ratio));
  const target = Math.max(selfBest, TARGET_FLOOR);
  const gap = target - ratio;

  const cohort = ctx.benchmarks.rank("cacheReadRatio", ratio);
  const cohortNote = cohort ? ` Cohort percentile ${cohort.percentile} (n=${cohort.population}).` : "";
  const base = `Cache-read ratio ${pct(ratio)} this window; your best ${pct(selfBest)}.${cohortNote}`;

  if (gap < NEAR_BEST) {
    return {
      id: "cache-efficiency", tier: 1, category: "spend", visibility: "owner",
      title: "Your cache hygiene is strong",
      evidenceLine: base,
      action: "Keep long, continuous sessions — your context stays warm.",
      dollarImpact: null, outcomeImpact: null, confidence: "solid", severity: "good", locked: false,
      themeKey: "mid-session-switch",
    };
  }

  const totalTokens = ctx.usageByTool.reduce((s, t) => s + t.inputTokens + t.cacheCreationTokens + t.cacheReadTokens, 0);
  const freshShare = totalTokens > 0
    ? ctx.usageByTool.reduce((s, t) => s + t.inputTokens + t.cacheCreationTokens, 0) / totalTokens
    : 0;
  const monthlyFreshSpend = ctx.windowCostUsd * freshShare * (30 / ctx.windowDays);
  const high = Math.round(gap * monthlyFreshSpend * CACHE_DISCOUNT * 100) / 100;
  const low = Math.round(high * LOW_BAND * 100) / 100;

  return {
    id: "cache-efficiency", tier: 1, category: "spend", visibility: "owner",
    title: "Tighten your cache reuse",
    evidenceLine: base,
    action: "Avoid mid-session model switches; use /resume to continue prior work; keep your system prompt stable.",
    dollarImpact: high > 0 ? { low, high } : null,
    outcomeImpact: null, confidence: ctx.windowCostUsd > 0 ? "solid" : "early",
    severity: high > 0 ? "save" : "improve", locked: false,
    themeKey: "mid-session-switch",
    whyHref: "/help/coach#cache",
  };
};

export default cacheEfficiencyAdvisor;
