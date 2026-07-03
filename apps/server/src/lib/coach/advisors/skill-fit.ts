import type { Advisor, Recommendation } from "../types.js";
import type { CoachSession } from "../types.js";
import { withGit, revertRatio, MIN_GROUP_SESSIONS } from "../deep.js";
import { pct } from "../format.js";

const MATERIAL_DROP = 0.3;        // skill side must revert >=30% relatively less to claim a win
const CATALOG_REVERT_FLOOR = 0.15; // catalog branch trigger

function usedSkill(s: CoachSession, skill: string): boolean {
  return !!s.skillsUsed && (s.skillsUsed[skill] ?? 0) > 0;
}

/** Skill keys that appear in at least one session, most-used first. */
function candidateSkills(sessions: CoachSession[]): string[] {
  const totals = new Map<string, number>();
  for (const s of sessions) for (const [k, n] of Object.entries(s.skillsUsed ?? {})) totals.set(k, (totals.get(k) ?? 0) + n);
  return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
}

export const skillFitAdvisor: Advisor = (ctx) => {
  if (!ctx.deepMode) return null;
  const g = withGit(ctx.deepSessions);
  if (g.length < MIN_GROUP_SESSIONS) return null;

  // Data branch: a real with/without split on the same outcome.
  for (const skill of candidateSkills(g)) {
    const withS = g.filter((s) => usedSkill(s, skill));
    const withoutS = g.filter((s) => !usedSkill(s, skill));
    if (withS.length < MIN_GROUP_SESSIONS || withoutS.length < MIN_GROUP_SESSIONS) continue;
    const rw = revertRatio(withS), ro = revertRatio(withoutS);
    if (rw === null || ro === null || ro <= 0) continue;
    if (rw <= ro * (1 - MATERIAL_DROP)) {
      const drop = Math.round((1 - rw / ro) * 100);
      const rec: Recommendation = {
        id: "skill-fit", tier: 2, category: "fit", visibility: "owner",
        title: "A skill that measurably cuts your reverts",
        evidenceLine: `Your \`${skill}\` sessions revert ${pct(rw)} vs ${pct(ro)} without it — ${drop}% fewer (your own sessions).`,
        action: `Keep using \`${skill}\` on this work.`,
        dollarImpact: null, outcomeImpact: `${drop}% fewer reverts with ${skill}`,
        confidence: "solid", severity: "improve", locked: false,
        themeKey: "skill-fit", whyHref: "/help/coach#skill-fit",
      };
      return rec;
    }
  }

  // Catalog branch (early, documented-purpose grounded).
  const overall = revertRatio(g);
  const anyDebug = g.some((s) => usedSkill(s, "systematic-debugging"));
  if (overall !== null && overall >= CATALOG_REVERT_FLOOR && !anyDebug) {
    return {
      id: "skill-fit", tier: 2, category: "fit", visibility: "owner",
      title: "A skill worth trying for your churn",
      evidenceLine: `Your reverts are ${pct(overall)} of added lines and none of your sessions used \`systematic-debugging\` (your own sessions).`,
      action: "Try the `systematic-debugging` skill on high-revert fixes — it exists to find root causes before editing.",
      dollarImpact: null, outcomeImpact: null,
      confidence: "early", severity: "improve", locked: false,
      themeKey: "skill-fit", whyHref: "/help/coach#skill-fit",
    };
  }
  return null;
};

export default skillFitAdvisor;
