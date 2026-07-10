import type { Advisor } from "../types.js";
import { withGit, dominantKind, survivingLocPerDollar, groupBy, MIN_KIND_SESSIONS, type Kind, KIND_LABEL } from "../deep.js";
import type { CoachSession } from "../types.js";
import { modelFamily } from "../format.js";
import { toolLabel } from "../../tools.js";

const KINDS: Kind[] = ["fixes", "features", "refactors", "other"];

// A grouping key is `${tool}/${modelFamily}`; render it as a human label
// ("codex/openai" -> "Codex · openai") so user-facing copy never shows the raw key.
function groupLabel(key: string): string {
  const slash = key.indexOf("/");
  if (slash < 0) return toolLabel(key);
  return `${toolLabel(key.slice(0, slash))} · ${key.slice(slash + 1)}`;
}

export const taskFitAdvisor: Advisor = (ctx) => {
  if (!ctx.deepMode) return null;
  const g = withGit(ctx.deepSessions);
  if (g.length === 0) return null;

  // Bucket sessions by their dominant commit kind.
  const byKind = new Map<Kind, CoachSession[]>();
  for (const s of g) {
    const k = dominantKind(s.git);
    if (!k) continue;
    (byKind.get(k) ?? byKind.set(k, []).get(k)!).push(s);
  }

  let best: { kind: Kind; topLabel: string; ratio: number } | null = null;
  for (const kind of KINDS) {
    const sessions = byKind.get(kind);
    if (!sessions) continue;
    const groups = groupBy(sessions, (s) => `${s.tool}/${modelFamily(s.model ?? "other")}`);
    const yields: Array<{ label: string; yld: number }> = [];
    for (const [label, gs] of groups) {
      if (gs.length < MIN_KIND_SESSIONS) continue;
      const y = survivingLocPerDollar(gs);
      if (y !== null && y > 0) yields.push({ label, yld: y });
    }
    if (yields.length < 2) continue; // kind not comparable
    yields.sort((a, b) => b.yld - a.yld);
    const top = yields[0]!, bottom = yields[yields.length - 1]!;
    const ratio = top.yld / bottom.yld;
    if (!best || ratio > best.ratio) best = { kind, topLabel: top.label, ratio };
  }
  if (!best) return null;

  const mult = Math.round(best.ratio * 10) / 10;
  const label = groupLabel(best.topLabel);
  return {
    id: "task-fit", tier: 2, category: "fit", visibility: "owner",
    title: "Route this task type to your higher-yield agent",
    evidenceLine: `For your ${KIND_LABEL[best.kind]}, ${label} lands ~${mult}× the surviving LOC/$ of your lowest option (your own sessions).`,
    action: `Send more of your ${KIND_LABEL[best.kind]} to ${label}.`,
    dollarImpact: null,
    outcomeImpact: `~${mult}× surviving LOC/$ on ${KIND_LABEL[best.kind]}`,
    confidence: best.ratio >= 2 ? "solid" : "early",
    severity: "improve", locked: false, themeKey: "task-fit", whyHref: "/help/coach#task-fit",
  };
};

export default taskFitAdvisor;
