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
