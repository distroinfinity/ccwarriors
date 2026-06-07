// Profile insights scoring: merged payloads → 0-100 axis scores → warrior
// class. All deterministic — the only LLM in this pipeline is the user's.
import type { InsightsPayload } from "../db/schema.js";

export const AXES = ["planning", "autonomy", "steering", "summoning", "velocity"] as const;
export type Axis = (typeof AXES)[number];
export type AxisScores = Record<Axis, number>;

// Below this many sessions in the window the archetype shows "forging" —
// tiny samples produce garbage classes.
export const MIN_SESSIONS = 10;
// Below this many consented warriors, scores use the fixed calibration
// constants; at/after it, percentiles take over automatically.
export const PERCENTILE_MIN_POPULATION = 30;

export type MergedInsights = InsightsPayload;

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Merge per-machine payloads: rates weighted by sessions, counts summed, maxes maxed. */
export function mergeInsights(payloads: InsightsPayload[]): MergedInsights {
  if (payloads.length === 1) return payloads[0]!;
  const sessions = payloads.reduce((s, p) => s + p.sessions, 0) || 1;
  const w = (f: (p: InsightsPayload) => number) =>
    round1(payloads.reduce((s, p) => s + f(p) * p.sessions, 0) / sessions);
  const hist = { "1-5": 0, "6-10": 0, "11-25": 0, "26+": 0 };
  const hours = Array(24).fill(0) as number[];
  for (const p of payloads) {
    for (const k of Object.keys(hist) as (keyof typeof hist)[]) hist[k] += p.promptWordHistogram[k] ?? 0;
    p.hourHistogram.forEach((v, i) => (hours[i] = (hours[i] ?? 0) + v));
  }
  return {
    windowDays: Math.max(...payloads.map((p) => p.windowDays)),
    sessions,
    promptWordHistogram: hist,
    planModeSessionsPct: w((p) => p.planModeSessionsPct),
    exploreBeforeEditRatio: w((p) => p.exploreBeforeEditRatio),
    avgTurnsBetweenUserMsgs: w((p) => p.avgTurnsBetweenUserMsgs),
    interruptsPer100Turns: w((p) => p.interruptsPer100Turns),
    subagentSpawnsPerSession: w((p) => p.subagentSpawnsPerSession),
    maxParallelAgents: Math.max(...payloads.map((p) => p.maxParallelAgents)),
    hourHistogram: hours,
    editToolCallsPerSession: w((p) => p.editToolCallsPerSession),
    longestSessionMinutes: Math.max(...payloads.map((p) => p.longestSessionMinutes)),
  };
}

/** Fixed-anchor scores for the cold-start population (< PERCENTILE_MIN_POPULATION).
    Anchors tuned on founder data; replaced by percentiles automatically as the
    consented population grows. */
export function calibratedAxes(m: MergedInsights): AxisScores {
  const shortPromptRatio = shortPromptShare(m);
  return {
    // think-before-strike: plan mode share + exploring before editing
    planning: clamp((m.planModeSessionsPct / 30) * 60 + m.exploreBeforeEditRatio * 40),
    // long unsupervised runs, few interrupts
    autonomy: clamp((m.avgTurnsBetweenUserMsgs / 25) * 70 + (1 - clamp(m.interruptsPer100Turns, 0, 20) / 20) * 30),
    // short rapid orders, frequent course corrections
    steering: clamp(shortPromptRatio * 60 + (clamp(m.interruptsPer100Turns, 0, 20) / 20) * 20 + clamp(promptsPerSessionProxy(m), 0, 20) * 1),
    // agent armies
    summoning: clamp((m.subagentSpawnsPerSession / 3) * 70 + Math.min(30, m.maxParallelAgents * 6)),
    // raw throughput
    velocity: clamp((sessionsPerDay(m) / 5) * 50 + (m.editToolCallsPerSession / 40) * 50),
  };
}

function shortPromptShare(m: MergedInsights): number {
  const h = m.promptWordHistogram;
  const total = h["1-5"] + h["6-10"] + h["11-25"] + h["26+"];
  return total === 0 ? 0 : (h["1-5"] + h["6-10"]) / total;
}

function sessionsPerDay(m: MergedInsights): number {
  return m.sessions / Math.max(1, m.windowDays);
}

// Prompts per session isn't shipped directly; the histogram total / sessions is it.
function promptsPerSessionProxy(m: MergedInsights): number {
  const h = m.promptWordHistogram;
  return (h["1-5"] + h["6-10"] + h["11-25"] + h["26+"]) / Math.max(1, m.sessions);
}

/** Percentile of this user's calibrated axis values within the population. */
export function percentileAxes(me: MergedInsights, population: MergedInsights[]): AxisScores {
  const mine = calibratedAxes(me);
  const all = population.map(calibratedAxes);
  const out = {} as AxisScores;
  for (const axis of AXES) {
    const below = all.filter((a) => a[axis] < mine[axis]).length;
    out[axis] = Math.round((below / Math.max(1, all.length - 1 || 1)) * 100);
  }
  return out;
}

const CLASS_BY_AXIS: Record<Axis, string> = {
  planning: "The Tactician",
  velocity: "The Berserker",
  summoning: "The Summoner",
  steering: "The Commander",
  autonomy: "The Falconer",
};

/** Purely dominant-axis (spec 2.3). Ties break by AXES order — deterministic. */
export function archetypeOf(scores: AxisScores): string {
  let best: Axis = AXES[0];
  for (const axis of AXES) if (scores[axis] > scores[best]) best = axis;
  return CLASS_BY_AXIS[best];
}

export interface TraitContext {
  weekendShare: number; // share of active usage_days falling on Sat/Sun
  currentStreak: number;
}

/** Rhythm flavor line (not a class). First match wins; null = no trait line. */
export function traitOf(m: MergedInsights, ctx: TraitContext): string | null {
  const total = m.hourHistogram.reduce((s, v) => s + v, 0);
  if (total > 0) {
    const night = [22, 23, 0, 1, 2, 3, 4].reduce((s, h) => s + (m.hourHistogram[h] ?? 0), 0);
    const dawn = [5, 6, 7, 8, 9].reduce((s, h) => s + (m.hourHistogram[h] ?? 0), 0);
    if (night / total > 0.35) return "Night Stalker";
    if (dawn / total > 0.3) return "Dawn Raider";
  }
  if (ctx.weekendShare > 0.4) return "Weekend Warrior";
  if (ctx.currentStreak >= 14) return "Daily Grinder";
  return null;
}

export interface EfficiencyHint {
  opusShare: number; // 0..1 cost share on opus-family models in the 30d window
  estSavingsPerMonth: number;
}

/** One useful line, rule table, first match wins (spec 2.5). */
export function growthEdgeOf(scores: AxisScores, m: MergedInsights, eff: EfficiencyHint | null): string {
  if (scores.planning < 30 && m.interruptsPer100Turns > 8) {
    return "You correct mid-flight often. One pass of plan mode before big strikes would cut those interrupts.";
  }
  if (eff && eff.opusShare > 0.6 && eff.estSavingsPerMonth >= 5) {
    return `Heavy Opus mix. Right-sizing routine work to Sonnet saves about $${Math.round(eff.estSavingsPerMonth)}/mo.`;
  }
  if (scores.summoning < 20 && scores.velocity > 70) {
    return "High output, zero delegation. Subagents would parallelize your grind.";
  }
  if (scores.autonomy < 30) {
    return "Short leash on the agent. Longer unsupervised runs compound your throughput.";
  }
  return "Solid form. Keep syncing daily so your scores sharpen as the legion grows.";
}

export interface HabitStats {
  shortPromptPct: number; // % of prompts at 10 words or fewer
  planModeSessionsPct: number;
  maxParallelAgents: number;
  interruptsPer100Turns: number;
  longestSessionMinutes: number;
}

export function habitStats(m: MergedInsights): HabitStats {
  return {
    shortPromptPct: Math.round(shortPromptShare(m) * 100),
    planModeSessionsPct: Math.round(m.planModeSessionsPct),
    maxParallelAgents: m.maxParallelAgents,
    interruptsPer100Turns: round1(m.interruptsPer100Turns),
    longestSessionMinutes: Math.round(m.longestSessionMinutes),
  };
}
