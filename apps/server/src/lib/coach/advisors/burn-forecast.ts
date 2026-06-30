import type { Advisor } from "../types.js";
import { formatUsd } from "../format.js";

const ACCELERATION = 1.2; // projected >= 1.2x prior month => pacing warning

export const burnForecastAdvisor: Advisor = (ctx) => {
  if (ctx.windowCostUsd <= 0) return null;
  const { projectedMonthUsd, priorMonthUsd } = ctx.burn;
  const accelerating = priorMonthUsd !== null && projectedMonthUsd >= priorMonthUsd * ACCELERATION;
  const priorNote = priorMonthUsd !== null ? ` (last month ${formatUsd(Math.round(priorMonthUsd))})` : "";
  return {
    id: "burn-forecast", tier: 1, category: "spend", visibility: "owner",
    title: accelerating ? "Spend is accelerating" : "Spend is on a steady pace",
    evidenceLine: `On pace for ~${formatUsd(Math.round(projectedMonthUsd))}/mo${priorNote}.`,
    action: accelerating
      ? "Pace the rest of the month, or pre-empt a plan switch before you hit your limit."
      : "No action needed — your run-rate is in line with last month.",
    dollarImpact: null, outcomeImpact: null, confidence: "solid",
    severity: accelerating ? "improve" : "good", locked: false,
  };
};

export default burnForecastAdvisor;
