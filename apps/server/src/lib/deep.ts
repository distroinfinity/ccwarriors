// Server-side roll-up of deep per-session records into the existing aggregate
// InsightsPayload. This is the server equivalent of the CLI's aggregateSessions
// (packages/cli/src/insights.ts) — formulas must match exactly so deep-derived
// aggregates score identically to client-pushed aggregates.
import type { InsightsPayload, SessionRecord } from "../db/schema.js";

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Roll per-session records into the aggregate InsightsPayload shape. */
export function deriveAggregate(sessions: SessionRecord[], windowDays: number): InsightsPayload {
  const n = Math.max(1, sessions.length);
  const sum = (f: (s: SessionRecord) => number) => sessions.reduce((a, s) => a + f(s), 0);
  const hist = { "1-5": 0, "6-10": 0, "11-25": 0, "26+": 0 };
  const hours = Array(24).fill(0) as number[];
  for (const s of sessions) {
    for (const k of Object.keys(hist) as (keyof typeof hist)[]) hist[k] += s.wordBuckets[k];
    const h = s.startHour;
    if (Number.isInteger(h) && h >= 0 && h < 24) hours[h] = (hours[h] ?? 0) + 1;
  }
  const totalPrompts = Math.max(1, sum((s) => s.prompts));
  const totalTurns = Math.max(1, sum((s) => s.assistantTurns));
  const withEdits = sessions.filter((s) => s.hadEdits);
  return {
    windowDays,
    sessions: sessions.length,
    promptWordHistogram: hist,
    planModeSessionsPct: r1((sessions.filter((s) => s.usedPlanMode).length / n) * 100),
    exploreBeforeEditRatio:
      withEdits.length === 0
        ? 0
        : Math.round((withEdits.filter((s) => s.exploreBeforeFirstEdit).length / withEdits.length) * 100) / 100,
    avgTurnsBetweenUserMsgs: r1(totalTurns / totalPrompts),
    interruptsPer100Turns: r1((sum((s) => s.interrupts) / totalTurns) * 100),
    subagentSpawnsPerSession: r1(sum((s) => s.subagentSpawns) / n),
    maxParallelAgents: Math.max(0, ...sessions.map((s) => s.maxParallel)),
    hourHistogram: hours,
    editToolCallsPerSession: r1(sum((s) => s.editCalls) / n),
    longestSessionMinutes: r1(Math.min(7 * 24 * 60, Math.max(0, ...sessions.map((s) => s.durationMinutes)))),
  };
}
