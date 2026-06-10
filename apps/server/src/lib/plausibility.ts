import type { ModelTokens } from "../db/schema.js";

// Plausibility gates — the anti-rigging layer. Violations never reject the
// sync (a cheater probing for 4xx learns where the gates are); they flag the
// user into shadow quarantine: data still stored, sync still 200, but the
// user leaves every board until an admin clears the flag.

// All thresholds env-tunable so we can loosen for legit whales without a deploy.
function envNum(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export const GATES = {
  // Max believable spend growth per elapsed hour between two syncs, plus slack
  // for the very first sync after a gap.
  maxHourlyBurn: () => envNum("GATE_MAX_HOURLY_BURN", 500),
  burnSlack: () => envNum("GATE_BURN_SLACK", 200),
  // Max believable priced cost for a single tool-day.
  maxDailyCostPerTool: () => envNum("GATE_MAX_DAILY_COST", 3_000),
  // Max believable backfill when a tool appears for the first time
  // (a fabricated 40-day history is the cheapest way to fake a big number).
  newToolWindowCap: () => envNum("GATE_NEW_TOOL_WINDOW_CAP", 15_000),
  // Days older than this are considered settled — they must not grow.
  settledAfterDays: () => envNum("GATE_SETTLED_AFTER_DAYS", 2),
  settledGrowthTolerance: () => envNum("GATE_SETTLED_TOLERANCE", 0.10),
  // How far ccusage's client-side estimate may diverge from our token math
  // before we emit an estimate_mismatch telemetry signal. The estimate NEVER
  // becomes a stored/ranked value — server-computed dollars are the only
  // authority. The signal catches both tampered clients and a stale pricing
  // table on our side (non-quarantining: LiteLLM lag on new models is normal).
  estimateBand: () => envNum("GATE_ESTIMATE_BAND", 0.25),
  // ── Craft Score deep-ingest gates (hiring credential — gaming resistance is
  // make-or-break). Outcome-vs-spend: the model physically cannot emit more
  // than ~1 line of surviving code per output token, and total tokens (even
  // cache-inflated) vastly exceed lines — so surviving LOC above total tokens,
  // or a flood of commits per real dollar, means a fabricated git repo.
  maxLocPerToken: () => envNum("GATE_MAX_LOC_PER_TOKEN", 1.0),
  maxCommitsPerDollar: () => envNum("GATE_MAX_COMMITS_PER_DOLLAR", 50),
  // ── Timing regularity: scripted sessions fire events with near-zero, uniform
  // gaps; humans pause to read and think. Conservative defaults — a false
  // positive on a real credential is costly, so only the blatant cases trip.
  timingMinEvents: () => envNum("GATE_TIMING_MIN_EVENTS", 20),
  maxSubSecondFraction: () => envNum("GATE_MAX_SUBSECOND_FRACTION", 0.9),
  minMedianGapMs: () => envNum("GATE_MIN_MEDIAN_GAP_MS", 300),
} as const;

export interface FlagSignal {
  reason: string;
  detail: string;
}

/** Burn-rate gate: Δ total cost30d between syncs vs elapsed time. */
export function checkBurnRate(
  prevCost30d: number,
  nextCost30d: number,
  lastSyncedAt: Date | null,
  now: number,
): FlagSignal | null {
  const delta = nextCost30d - prevCost30d;
  if (delta <= 0) return null;
  // No previous sync → bounded by the other gates (new-tool cap, daily ceiling).
  if (!lastSyncedAt) return null;
  const hours = Math.max(0, (now - lastSyncedAt.getTime()) / 3_600_000);
  const allowed = hours * GATES.maxHourlyBurn() + GATES.burnSlack();
  if (delta > allowed) {
    return {
      reason: "burn_rate",
      detail: `+$${delta.toFixed(0)} in ${hours.toFixed(2)}h (allowed $${allowed.toFixed(0)})`,
    };
  }
  return null;
}

/** Per-day ceiling: one tool-day priced above the cap is not believable. */
export function checkDailyCeiling(tool: string, day: string, cost: number): FlagSignal | null {
  if (cost <= GATES.maxDailyCostPerTool()) return null;
  return { reason: "daily_ceiling", detail: `${tool} ${day} $${cost.toFixed(0)}` };
}

/** New-tool backfill cap: a tool's first-ever window can't be a fortune. */
export function checkNewToolWindow(tool: string, windowCost: number): FlagSignal | null {
  if (windowCost <= GATES.newToolWindowCap()) return null;
  return { reason: "new_tool_backfill", detail: `${tool} first window $${windowCost.toFixed(0)}` };
}

/**
 * History immutability: a settled day (older than N days) must not grow.
 * Local agent logs are append-only in the recent window — last week's numbers
 * inflating later means the logs were rewritten.
 */
export function checkSettledDayGrowth(
  tool: string,
  day: string,
  prevCost: number,
  nextCost: number,
  now: number,
): FlagSignal | null {
  const ageMs = now - new Date(`${day}T00:00:00Z`).getTime();
  if (ageMs < GATES.settledAfterDays() * 86_400_000) return null;
  const allowed = prevCost * (1 + GATES.settledGrowthTolerance()) + 1;
  if (nextCost <= allowed) return null;
  return {
    reason: "history_rewrite",
    detail: `${tool} ${day} $${prevCost.toFixed(2)} → $${nextCost.toFixed(2)}`,
  };
}

/** Token-shape sanity: catches fabricated logs with absurd token mixes. */
export function checkTokenShape(tool: string, day: string, models: ModelTokens[]): FlagSignal | null {
  for (const m of models) {
    const out = m.outputTokens;
    const reads = m.cacheReadTokens;
    // Cache reads dwarf output in real agent sessions, but not by 6 orders of
    // magnitude; and pure-output days with zero input/cache don't happen.
    if (out > 0 && reads > 0 && reads / out > 1_000_000) {
      return { reason: "token_shape", detail: `${tool} ${day} ${m.modelName} read/out ratio` };
    }
    if (out > 50_000_000) {
      return { reason: "token_shape", detail: `${tool} ${day} ${m.modelName} output ${out}` };
    }
  }
  return null;
}

/**
 * Outcome-vs-spend implausibility (deep ingest). The #1 attack on a hiring
 * credential is a fabricated git repo — scripted commits inflating LOC/commits
 * with no corresponding AI token spend. Real AI-assisted work has a bounded
 * outcome-per-token (a model can't emit more surviving lines than output tokens)
 * and a bounded commits-per-dollar of real model spend.
 */
export function checkOutcomeImplausibility(
  totalSurvivingLoc: number,
  totalShippedCommits: number,
  windowTokens: number,
  windowCostUsd: number,
): FlagSignal | null {
  const locPerToken = totalSurvivingLoc / Math.max(1, windowTokens);
  if (locPerToken > GATES.maxLocPerToken()) {
    return {
      reason: "outcome_implausible",
      detail: `${totalSurvivingLoc} surviving LOC vs ${windowTokens} tokens (${locPerToken.toFixed(2)} loc/token > ${GATES.maxLocPerToken()})`,
    };
  }
  const commitsPerDollar = totalShippedCommits / Math.max(1, windowCostUsd);
  if (commitsPerDollar > GATES.maxCommitsPerDollar()) {
    return {
      reason: "outcome_implausible",
      detail: `${totalShippedCommits} commits vs $${windowCostUsd.toFixed(2)} (${commitsPerDollar.toFixed(1)} commits/$ > ${GATES.maxCommitsPerDollar()})`,
    };
  }
  return null;
}

/**
 * Timing regularity (deep ingest). Scripted/synthetic sessions have
 * machine-regular timing — near-zero, uniform inter-event gaps — while humans
 * pause to read and think. Only "substantial" sessions count; we need a few of
 * them all showing the machine signature before flagging (conservative: a false
 * positive on a real credential is costly).
 */
export function checkTimingRegularity(
  sessions: { timing: { events: number; subSecondFraction: number; medianGapMs: number } }[],
): FlagSignal | null {
  const substantial = sessions.filter((s) => s.timing.events >= GATES.timingMinEvents());
  if (substantial.length < 3) return null;
  const meanSubSecond =
    substantial.reduce((s, x) => s + x.timing.subSecondFraction, 0) / substantial.length;
  const meanMedianGap =
    substantial.reduce((s, x) => s + x.timing.medianGapMs, 0) / substantial.length;
  if (meanSubSecond > GATES.maxSubSecondFraction() && meanMedianGap < GATES.minMedianGapMs()) {
    return {
      reason: "timing_regular",
      detail: `${substantial.length} long sessions: mean subSecond ${meanSubSecond.toFixed(2)}, mean medianGap ${meanMedianGap.toFixed(0)}ms`,
    };
  }
  return null;
}
