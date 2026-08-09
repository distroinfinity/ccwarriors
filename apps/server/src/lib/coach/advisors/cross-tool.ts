import type { Advisor } from "../types.js";
import { formatUsd, effectiveCostPerMtok } from "../format.js";
import { toolLabel } from "../../tools.js";

/** Compare effective $/Mtok across the user's own tools (token-cost only, no outcome claim). */
export const crossToolAdvisor: Advisor = (ctx) => {
  const priced = ctx.usageByTool
    .map((t) => {
      const totalTokens = t.inputTokens + t.outputTokens + t.cacheCreationTokens + t.cacheReadTokens;
      const perMtok = effectiveCostPerMtok(t.cost, totalTokens);
      return perMtok === null ? null : { tool: t.tool, perMtok };
    })
    .filter((x): x is { tool: string; perMtok: number } => x !== null);
  if (priced.length < 2) return null;

  priced.sort((a, b) => a.perMtok - b.perMtok);
  const cheapest = priced[0]!;
  const dearest = priced[priced.length - 1]!;
  if (cheapest.tool === dearest.tool || dearest.perMtok <= cheapest.perMtok) return null;

  return {
    id: "cross-tool", tier: 1, category: "spend", visibility: "owner",
    title: "Tokens are cheaper on one of your tools",
    evidenceLine: `${toolLabel(cheapest.tool)} runs ${formatUsd(cheapest.perMtok)}/Mtok vs ${toolLabel(dearest.tool)} ${formatUsd(dearest.perMtok)}/Mtok for you.`,
    action: `Consider routing token-heavy work to ${toolLabel(cheapest.tool)}, where your tokens are cheaper.`,
    dollarImpact: null, outcomeImpact: null, confidence: "solid", severity: "improve", locked: false,
  };
};

export default crossToolAdvisor;
