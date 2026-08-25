import type { ModelTokens } from "../db/schema.js";

// Plausibility gates — the anti-rigging layer. Violations never reject the
// sync (a cheater probing for 4xx learns where the gates are); they flag the
// user into shadow quarantine: data still stored, sync still 200, but the
// user leaves every board until an admin clears the flag.
//
// ── Why every gate below counts TOKENS, never dollars ────────────────────────
// Dollars are not a stable property of a stored day. lib/pricing.ts refreshes
// the LiteLLM table every 24h, so the same tokens re-price on every ingest.
// Cache reads are ~94% of a real agentic day, which makes a day's dollar figure
// hostage to one upstream field (`cache_read_input_token_cost`). In prod this
// quarantined 31 of 77 users — e.g. a codex day whose tokens never changed was
// stored at $54.62, flagged at "$54.62 → $75.49", and prices to $42.90 today.
// Tokens are what the client actually measured, so they are the only thing a
// history-immutability or burn-rate claim can honestly be made about.

// All thresholds env-tunable so we can loosen for legit whales without a deploy.
function envNum(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

// ── Quarantine policy ────────────────────────────────────────────────────────
// Which signals actually hide a user. Anything not listed is still computed and
// emitted as telemetry (services/ingest.ts flagUser) but never sets flagged_at.
// `history_rewrite` and `burn_rate` are deliberately absent: they are the two
// that were tripped by price drift, and they stay observation-only.
const DEFAULT_QUARANTINE_REASONS = [
  "token_shape",
  "sanity_cap",
  "machine_count",
  "daily_ceiling",
  "new_tool_backfill",
  "outcome_implausible",
  "timing_regular",
] as const;

/** Reasons that shadow-quarantine. `GATE_QUARANTINE_ENABLED=0` lifts them all;
 *  `GATE_QUARANTINE_REASONS=a,b` replaces the set — both without a deploy. */
export function quarantineReasons(): Set<string> {
  if (process.env["GATE_QUARANTINE_ENABLED"] === "0") return new Set();
  const raw = process.env["GATE_QUARANTINE_REASONS"];
  if (raw !== undefined) {
    return new Set(
      raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }
  return new Set(DEFAULT_QUARANTINE_REASONS);
}

export function isQuarantining(reason: string): boolean {
  return quarantineReasons().has(reason);
}

export const GATES = {
  // Max believable token growth per elapsed hour between two syncs, plus slack
  // for the very first sync after a gap. Sized ~8x above the heaviest real user
  // observed in prod (15.6B tokens in a day ≈ 0.65B/h) — this is a "physically
  // impossible" line, not a "suspiciously busy" one.
  maxHourlyTokenBurn: () => envNum("GATE_MAX_HOURLY_TOKEN_BURN", 5e9),
  burnTokenSlack: () => envNum("GATE_BURN_TOKEN_SLACK", 10e9),
  // Max believable tokens for a single tool-day. Population max is 15.6B.
  maxDailyTokensPerTool: () => envNum("GATE_MAX_DAILY_TOKENS", 20e9),
  // Max believable backfill when a tool appears for the first time
  // (a fabricated 40-day history is the cheapest way to fake a big number).
  // Population max for a real 40-day window is 83B.
  newToolWindowTokenCap: () => envNum("GATE_NEW_TOOL_WINDOW_TOKENS", 150e9),
  // Days older than this are considered settled — their tokens must not grow.
  settledAfterDays: () => envNum("GATE_SETTLED_AFTER_DAYS", 7),
  settledGrowthTolerance: () => envNum("GATE_SETTLED_TOLERANCE", 0.5),
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
  // or a flood of commits per million real tokens, means a fabricated git repo.
  maxLocPerToken: () => envNum("GATE_MAX_LOC_PER_TOKEN", 1.0),
  maxCommitsPerMTok: () => envNum("GATE_MAX_COMMITS_PER_MTOK", 200),
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

/** Total tokens in a set of per-model counts — the unit every gate compares. */
export function totalTokens(models: ModelTokens[]): number {
  let n = 0;
  for (const m of models) {
    n += m.inputTokens + m.outputTokens + m.cacheCreationTokens + m.cacheReadTokens;
  }
  return n;
}

const fmt = (n: number) => `${(n / 1e9).toFixed(2)}B tok`;

/**
 * Burn-rate gate: Δ total tokens between syncs vs elapsed time.
 * Observation-only by default (see DEFAULT_QUARANTINE_REASONS).
 */
export function checkBurnRate(
  prevTokens: number,
  nextTokens: number,
  lastSyncedAt: Date | null,
  now: number,
): FlagSignal | null {
  const delta = nextTokens - prevTokens;
  if (delta <= 0) return null;
  // No previous sync → bounded by the other gates (new-tool cap, daily ceiling).
  if (!lastSyncedAt) return null;
  const hours = Math.max(0, (now - lastSyncedAt.getTime()) / 3_600_000);
  const allowed = hours * GATES.maxHourlyTokenBurn() + GATES.burnTokenSlack();
  if (delta > allowed) {
    return {
      reason: "burn_rate",
      detail: `+${fmt(delta)} in ${hours.toFixed(2)}h (allowed ${fmt(allowed)})`,
    };
  }
  return null;
}

/** Per-day ceiling: one tool-day above the token cap is not believable. */
export function checkDailyCeiling(tool: string, day: string, tokens: number): FlagSignal | null {
  if (tokens <= GATES.maxDailyTokensPerTool()) return null;
  return { reason: "daily_ceiling", detail: `${tool} ${day} ${fmt(tokens)}` };
}

/** New-tool backfill cap: a tool's first-ever window can't be a fortune. */
export function checkNewToolWindow(tool: string, windowTokens: number): FlagSignal | null {
  if (windowTokens <= GATES.newToolWindowTokenCap()) return null;
  return { reason: "new_tool_backfill", detail: `${tool} first window ${fmt(windowTokens)}` };
}

/**
 * History immutability: a settled day (older than N days) must not grow.
 * Local agent logs are append-only in the recent window — last week's numbers
 * inflating later means the logs were rewritten. Compares TOKENS: the same day
 * re-priced by a LiteLLM refresh must not read as a rewrite.
 * Observation-only by default (see DEFAULT_QUARANTINE_REASONS).
 */
export function checkSettledDayGrowth(
  tool: string,
  day: string,
  prevTokens: number,
  nextTokens: number,
  now: number,
): FlagSignal | null {
  const ageMs = now - new Date(`${day}T00:00:00Z`).getTime();
  if (ageMs < GATES.settledAfterDays() * 86_400_000) return null;
  // +1M absolute slack on top of the ratio: a late-flushed session tail is a
  // rounding error on a real day but a large ratio on a nearly-empty one.
  const allowed = prevTokens * (1 + GATES.settledGrowthTolerance()) + 1_000_000;
  if (nextTokens <= allowed) return null;
  return {
    reason: "history_rewrite",
    detail: `${tool} ${day} ${fmt(prevTokens)} → ${fmt(nextTokens)}`,
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
 * and a bounded commits-per-million-tokens. Both halves are token-denominated so
 * a pricing refresh can never move this gate.
 */
export function checkOutcomeImplausibility(
  totalSurvivingLoc: number,
  totalShippedCommits: number,
  windowTokens: number,
): FlagSignal | null {
  const locPerToken = totalSurvivingLoc / Math.max(1, windowTokens);
  if (locPerToken > GATES.maxLocPerToken()) {
    return {
      reason: "outcome_implausible",
      detail: `${totalSurvivingLoc} surviving LOC vs ${windowTokens} tokens (${locPerToken.toFixed(2)} loc/token > ${GATES.maxLocPerToken()})`,
    };
  }
  const mtok = Math.max(1, windowTokens) / 1_000_000;
  const commitsPerMTok = totalShippedCommits / mtok;
  if (commitsPerMTok > GATES.maxCommitsPerMTok()) {
    return {
      reason: "outcome_implausible",
      detail: `${totalShippedCommits} commits vs ${mtok.toFixed(2)}M tokens (${commitsPerMTok.toFixed(1)} commits/Mtok > ${GATES.maxCommitsPerMTok()})`,
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
