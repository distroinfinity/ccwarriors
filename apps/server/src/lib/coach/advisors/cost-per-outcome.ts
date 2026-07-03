import type { Advisor } from "../types.js";
import { withGit, dollarPerSurvivingLine, totalCost, MIN_GROUP_SESSIONS } from "../deep.js";
import { formatUsd } from "../format.js";

export const costPerOutcomeAdvisor: Advisor = (ctx) => {
  if (!ctx.deepMode) return null;
  const g = withGit(ctx.deepSessions);
  if (g.length < MIN_GROUP_SESSIONS) return null;

  const dpsl = dollarPerSurvivingLine(ctx.deepSessions);
  if (dpsl === null) return null;

  // $/merged-PR proxy: commits landed on a remote branch (labeled proxy, not true merge state).
  const remoteCommits = g.filter((s) => s.git.hasRemote).reduce((s, x) => s + x.git.commitsInWindow, 0);
  const perPr = remoteCommits > 0 ? totalCost(g) / remoteCommits : null;
  const prNote = perPr !== null ? ` ~${formatUsd(Math.round(perPr * 100) / 100)}/merged-PR (proxy, estimated).` : "";

  const cohort = ctx.benchmarks.rank("dollarPerSurvivingLine", dpsl);
  const cohortNote = cohort ? ` Cohort percentile ${cohort.percentile} (n=${cohort.population}).` : "";

  return {
    id: "cost-per-outcome", tier: 2, category: "outcome", visibility: "public",
    title: "What your spend actually ships",
    evidenceLine: `~${formatUsd(Math.round(dpsl * 100) / 100)} per surviving line this window.${prNote}${cohortNote}`,
    action: "",
    dollarImpact: null,
    outcomeImpact: `${formatUsd(Math.round(dpsl * 100) / 100)}/surviving line`,
    confidence: g.length >= 12 ? "solid" : "early",
    severity: "good", locked: false, themeKey: "cost-per-outcome", whyHref: "/help/coach#roi",
  };
};

export default costPerOutcomeAdvisor;
