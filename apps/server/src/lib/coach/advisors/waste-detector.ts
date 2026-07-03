import type { Advisor } from "../types.js";
import { withGit, revertRatio, totalCost, MIN_GROUP_SESSIONS } from "../deep.js";
import { pct, formatUsd } from "../format.js";

const LOW_BAND = 0.5; // conservative low end of the reverted-spend range

export const wasteDetectorAdvisor: Advisor = (ctx) => {
  if (!ctx.deepMode) return null;
  const g = withGit(ctx.deepSessions);
  if (g.length < MIN_GROUP_SESSIONS) return null;

  const ratio = revertRatio(ctx.deepSessions);
  if (ratio === null) return null;

  const cohort = ctx.benchmarks.rank("revertRatio", ratio);
  const cohortNote = cohort ? ` cohort median tier: percentile ${cohort.percentile} (n=${cohort.population}).` : "";
  const evidenceLine = `Reverted-within-14d lines are ${pct(ratio)} of what you added this window.${cohortNote}`;

  // Reverted share of deep spend, hedged as a range, labeled estimate downstream.
  const revertedSpend = totalCost(g) * ratio;
  const high = Math.round(revertedSpend * 100) / 100;
  const low = Math.round(high * LOW_BAND * 100) / 100;

  return {
    id: "waste-detector", tier: 2, category: "outcome", visibility: "owner",
    title: "Cut the churn on your changes",
    evidenceLine,
    action: "Tighten verification before committing on the session types that revert most (tests, self-review, smaller diffs).",
    dollarImpact: high > 0 ? { low, high } : null,
    outcomeImpact: null,
    confidence: g.length >= 12 ? "solid" : "early",
    severity: high > 0 ? "save" : "good",
    locked: false, themeKey: "revert-waste", whyHref: "/help/coach#waste",
  };
};

export default wasteDetectorAdvisor;
