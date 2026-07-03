import type { Advisor } from "../types.js";
import { withGit, survivingLocPerDollar, MIN_GROUP_SESSIONS } from "../deep.js";
import { pct } from "../format.js";

const MATERIAL_MULT = 1.3; // plan-mode yield must beat non-plan by >=30% to recommend

export const behaviorCoachAdvisor: Advisor = (ctx) => {
  if (!ctx.deepMode) return null;
  const g = withGit(ctx.deepSessions);
  if (g.length < MIN_GROUP_SESSIONS * 2) return null;

  const plan = g.filter((s) => s.usedPlanMode);
  const noPlan = g.filter((s) => !s.usedPlanMode);
  if (plan.length < MIN_GROUP_SESSIONS || noPlan.length < MIN_GROUP_SESSIONS) return null;

  const yPlan = survivingLocPerDollar(plan), yNo = survivingLocPerDollar(noPlan);
  if (yPlan === null || yNo === null || yNo <= 0) return null;
  if (yPlan < yNo * MATERIAL_MULT) return null;

  const mult = Math.round((yPlan / yNo) * 10) / 10;
  const usage = plan.length / g.length;
  return {
    id: "behavior-coach", tier: 2, category: "behavior", visibility: "owner",
    title: "A habit that ships more per dollar",
    evidenceLine: `Your plan-mode sessions ship ~${mult}× the surviving LOC/$ of your non-plan sessions; you use plan mode ${pct(usage)} of the time (your own sessions).`,
    action: "Use plan mode on more of your larger changes.",
    dollarImpact: null,
    outcomeImpact: `~${mult}× surviving LOC/$ with plan mode`,
    confidence: mult >= 2 ? "solid" : "early",
    severity: "improve", locked: false, themeKey: "behavior-coach", whyHref: "/help/coach#behavior",
  };
};

export default behaviorCoachAdvisor;
