import type { SessionRecord } from "../../db/schema.js";
import type { CoachSession } from "./types.js";

/**
 * Derive a per-session estimatedCost by splitting each tool's summed window cost
 * across that tool's deep sessions in proportion to assistant-turn weight.
 *
 * Window-grain approximation (spec §3.5.1, §9): deep SessionRecords carry no
 * calendar date by privacy design, so a (tool, window) cost cannot be matched
 * to a (tool, day) — we apportion the whole window. estimatedCost is derived
 * here at build time and never stored on the JSONB record.
 */
export function apportionWindowCost(
  sessions: SessionRecord[],
  costByTool: Map<string, number>,
): CoachSession[] {
  const weightByTool = new Map<string, number>();
  for (const s of sessions) {
    const tool = s.tool ?? "claude";
    weightByTool.set(tool, (weightByTool.get(tool) ?? 0) + Math.max(1, s.assistantTurns));
  }
  return sessions.map((s) => {
    const tool = s.tool ?? "claude";
    const cost = costByTool.get(tool) ?? 0;
    const totalWeight = weightByTool.get(tool) ?? 0;
    const weight = Math.max(1, s.assistantTurns);
    const estimatedCost = totalWeight > 0 ? cost * (weight / totalWeight) : 0;
    return { ...s, tool, estimatedCost };
  });
}
