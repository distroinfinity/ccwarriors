// Pure outcome aggregation over deep sessions for the Tier-2 advisors. No I/O, no clock.
import type { SessionGitOutcome } from "../../db/schema.js";
import type { CoachSession } from "./types.js";

export const MIN_KIND_SESSIONS = 5;  // floor for one per-kind outcome comparison cell
export const MIN_GROUP_SESSIONS = 5; // floor for a two-group split (skill/plan vs not)

export type Kind = "fixes" | "features" | "refactors" | "other";
export const KIND_LABEL: Record<Kind, string> = { fixes: "fixes", features: "features", refactors: "refactors", other: "other" };

type WithGit = CoachSession & { git: SessionGitOutcome };

/** Sessions that carry a git outcome (others contribute no outcome signal). */
export function withGit(sessions: CoachSession[]): WithGit[] {
  return sessions.filter((s): s is WithGit => s.git !== null);
}

/** Reverted-within-14d lines / added lines. null when there are no added lines. */
export function revertRatio(sessions: CoachSession[]): number | null {
  const g = withGit(sessions);
  const added = g.reduce((s, x) => s + x.git.linesAdded, 0);
  if (added <= 0) return null;
  const reverted = g.reduce((s, x) => s + x.git.revertedLinesWithin14d, 0);
  return reverted / added;
}

/** Surviving lines = added − reverted-within-14d, floored at 0 per session, summed. */
export function survivingLoc(sessions: CoachSession[]): number {
  return withGit(sessions).reduce((s, x) => s + Math.max(0, x.git.linesAdded - x.git.revertedLinesWithin14d), 0);
}

/** Summed apportioned estimatedCost. */
export function totalCost(sessions: CoachSession[]): number {
  return sessions.reduce((s, x) => s + x.estimatedCost, 0);
}

/** $/surviving-line. null when no surviving lines. */
export function dollarPerSurvivingLine(sessions: CoachSession[]): number | null {
  const loc = survivingLoc(sessions);
  if (loc <= 0) return null;
  return totalCost(sessions) / loc;
}

/** Surviving LOC per dollar. null when no cost. */
export function survivingLocPerDollar(sessions: CoachSession[]): number | null {
  const cost = totalCost(sessions);
  if (cost <= 0) return null;
  return survivingLoc(sessions) / cost;
}

/** The single commit kind with the most commits in a session. null when absent/all-zero. */
export function dominantKind(g: SessionGitOutcome): Kind | null {
  const k = g.commitKinds;
  if (!k) return null;
  const entries: Array<[Kind, number]> = [["fixes", k.fixes], ["features", k.features], ["refactors", k.refactors], ["other", k.other]];
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0]![1] > 0 ? entries[0]![0] : null;
}

/** Bucket sessions by a string key. */
export function groupBy(sessions: CoachSession[], keyFn: (s: CoachSession) => string): Map<string, CoachSession[]> {
  const m = new Map<string, CoachSession[]>();
  for (const s of sessions) {
    const k = keyFn(s);
    (m.get(k) ?? m.set(k, []).get(k)!).push(s);
  }
  return m;
}
