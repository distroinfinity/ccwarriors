// Craft Score — the composite metric that judges an AI-era engineer from their
// git-coupled session data. Six outcome-coupled pillars (0..100 each) fold into
// a single min-pulled weighted mean.
//
// IMPORTANT: every numeric constant below (anchors, scalers, weights, the
// min-pulling k) is a v1 PLACEHOLDER to tune on real data — exactly like
// lib/tier.ts thresholds. They are calibrated on founder/synthetic data and
// will move once the consented population is large enough to fit. Tracked in
// issue #51 (cohort activity-banding + anchor refit). Treat the SHAPE of each
// formula as the contract, not the magic numbers.
//
// Deterministic, pure, no I/O — the only LLM in this pipeline is the user's.
import type { SessionRecord } from "../db/schema.js";

export const PILLARS = [
  "direction",
  "verification",
  "autonomy",
  "yield",
  "orchestration",
  "throughput",
] as const;
export type Pillar = (typeof PILLARS)[number];
export type Pillars = Record<Pillar, number>;

// Pillar weights (sum = 1). Verification + Yield carry the load: the two
// hardest-to-game, most outcome-coupled signals.
export const PILLAR_WEIGHTS: Pillars = {
  verification: 0.22,
  yield: 0.22,
  direction: 0.16,
  autonomy: 0.16,
  orchestration: 0.12,
  throughput: 0.12,
};

// Min-pulling penalty: a profile is only as strong as its weakest craft.
// craftScore = weightedMean - K_MIN_PULL * (max - median). k≈0.25.
export const K_MIN_PULL = 0.25;

// Below this many consented deep-mode warriors, pillar scores stay on the fixed
// calibration anchors (badged provisional). At/after it, percentiles take over.
// Reuses the insights threshold so the two systems flip together.
export const PERCENTILE_MIN_POPULATION = 30;

export const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const round1 = (n: number) => Math.round(n * 10) / 10;

// ── Craft tiers ──────────────────────────────────────────────────────────────
// Forge-themed score bands (our own brand of a CF-style rating ramp). The web
// colors by key: ink → bronze → terracotta → ember.
export type CraftTier = { key: "apprentice" | "journeyman" | "artisan" | "mastersmith"; name: string };

export function tierOf(score: number): CraftTier {
  if (score >= 80) return { key: "mastersmith", name: "Mastersmith" };
  if (score >= 60) return { key: "artisan", name: "Artisan" };
  if (score >= 40) return { key: "journeyman", name: "Journeyman" };
  return { key: "apprentice", name: "Apprentice" };
}

// ── Input: a user's merged deep data. The caller assembles this from
//    userDeepSessions (all machines concatenated) + usage_days/efficiency.
export interface CraftInput {
  sessions: SessionRecord[];
  windowCostUsd: number;
  windowTokens: number;
  cacheReadRatio: number | null;
  opusShare: number;
}

// ── Session helpers (spec-defined).
/** A session "shipped" if it produced commits in the window. */
export function shipped(s: SessionRecord): boolean {
  return !!s.git && s.git.commitsInWindow > 0;
}
/** Surviving LOC = added minus what got reverted within 14d (floored at 0). */
export function survivingLoc(s: SessionRecord): number {
  if (!s.git) return 0;
  return Math.max(0, s.git.linesAdded - s.git.revertedLinesWithin14d);
}
/** A verified-test session shipped AND touched a test file. */
export function verifiedTestSession(s: SessionRecord): boolean {
  return shipped(s) && !!s.git && s.git.testFilesTouched > 0;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]) => (xs.length === 0 ? 0 : sum(xs) / xs.length);

// ──────────────────────────────────────────────────────────────────────────
// P1 Direction — structured prompts that land.
//   0.5*specDensity + 0.5*exploreThenShipRatio.
//   specDensity = fraction of prompts in the 6-25 word buckets (mid-length:
//     not one-word, not essays) across all sessions.
//   exploreThenShipRatio = (sessions that explored before first edit AND
//     shipped) / (sessions with edits); 0 if no edit sessions.
// ──────────────────────────────────────────────────────────────────────────
export function pillarDirection(sessions: SessionRecord[]): number {
  let mid = 0;
  let total = 0;
  for (const s of sessions) {
    const b = s.wordBuckets;
    mid += b["6-10"] + b["11-25"];
    total += b["1-5"] + b["6-10"] + b["11-25"] + b["26+"];
  }
  const specDensity = total === 0 ? 0 : mid / total;

  const withEdits = sessions.filter((s) => s.hadEdits);
  const exploreThenShip =
    withEdits.length === 0
      ? 0
      : withEdits.filter((s) => s.exploreBeforeFirstEdit && shipped(s)).length / withEdits.length;

  return round1(clamp(100 * (0.5 * specDensity + 0.5 * exploreThenShip)));
}

// ──────────────────────────────────────────────────────────────────────────
// P2 Verification Rigor ⭐ — does the work survive review and tests?
//   0.6*testCoupling + 0.4*(1 - revertRate).
//   testCoupling = verified-test-sessions / shipped-sessions (0 if none shipped).
//   revertRate   = totalRevertedLines / max(1, totalLinesAdded), clamped 0..1.
// ──────────────────────────────────────────────────────────────────────────
export function pillarVerification(sessions: SessionRecord[]): number {
  const shippedSessions = sessions.filter(shipped);
  const testCoupling =
    shippedSessions.length === 0
      ? 0
      : shippedSessions.filter(verifiedTestSession).length / shippedSessions.length;

  const totalAdded = sum(sessions.map((s) => s.git?.linesAdded ?? 0));
  const totalReverted = sum(sessions.map((s) => s.git?.revertedLinesWithin14d ?? 0));
  const revertRate = clamp(totalReverted / Math.max(1, totalAdded), 0, 1);

  return round1(clamp(100 * (0.6 * testCoupling + 0.4 * (1 - revertRate))));
}

// ──────────────────────────────────────────────────────────────────────────
// P3 Autonomy Calibration — long unsupervised runs that SURVIVE; penalize long
//   runs that revert. meanTurnsBetween over shipped sessions, scaled (÷25*100
//   capped at 100), multiplied by (1 - revertRate on high-autonomy shipped
//   sessions). No shipped sessions → low floor (20).
//   "turns between user messages" ≈ assistantTurns / max(1, prompts).
// ──────────────────────────────────────────────────────────────────────────
const AUTONOMY_TURNS_ANCHOR = 25; // assistantTurns/prompt that maxes the raw scale
const AUTONOMY_FLOOR = 20; // score when there is nothing shipped to judge

function turnsBetween(s: SessionRecord): number {
  return s.assistantTurns / Math.max(1, s.prompts);
}

export function pillarAutonomy(sessions: SessionRecord[]): number {
  const shippedSessions = sessions.filter(shipped);
  if (shippedSessions.length === 0) return AUTONOMY_FLOOR;

  const meanTurns = mean(shippedSessions.map(turnsBetween));
  const rawAutonomy = clamp((meanTurns / AUTONOMY_TURNS_ANCHOR) * 100);

  // "High autonomy" = shipped sessions whose run length is above the cohort's
  // own mean. Reverts inside those long runs are the thing we punish: a long
  // unsupervised run that gets ripped out is the worst-case outcome.
  const highAutonomy = shippedSessions.filter((s) => turnsBetween(s) >= meanTurns);
  const haAdded = sum(highAutonomy.map((s) => s.git?.linesAdded ?? 0));
  const haReverted = sum(highAutonomy.map((s) => s.git?.revertedLinesWithin14d ?? 0));
  const haRevertRate = clamp(haReverted / Math.max(1, haAdded), 0, 1);

  return round1(clamp(rawAutonomy * (1 - haRevertRate)));
}

// ──────────────────────────────────────────────────────────────────────────
// P4 Yield / Efficiency ⭐ — outcome per DOLLAR. The anti-spend-proxy.
//   survivingLOCPerDollar = totalSurvivingLOC / max(1, windowCostUsd)
//   commitsPerDollar      = totalShippedCommits / max(1, windowCostUsd)
//   blend 0.6*locYield + 0.4*commitYield.
//
// TUNED ON PROD (2026-06-10, 58 real users — issue #51):
//   - Dropped the model-right-sizing term. The median user runs ~90% Opus
//     (p50 0.90, p90 0.98); Opus is 77% of all tokens. For Claude Code power
//     users Opus IS the tool, so an opusShare penalty would ding ~everyone and
//     turn Yield into a "did you use Sonnet" detector. Wrong signal.
//   - Dropped the cache-read bonus: non-discriminating (p10 0.93, p50 0.96,
//     p90 0.98 — everyone is cache-warm).
//   - Denominator is DOLLARS, not tokens: 90%+ of tokens are cheap cache-reads
//     (effective $0.76/M), so a raw token count is a misleading yield base;
//     server-priced dollars are the honest cost.
// Outcome-side ANCHOR LEVELS below are still provisional — they need deployed
// deep data to fit (no surviving-LOC/commit samples exist in prod yet, #51).
//
// CRITICAL INVARIANT: holding outcomes (LOC, commits) fixed and RAISING
// windowCostUsd must never raise P4. Both ratios are monotone-decreasing in
// the dollar denominator and the anchor maps monotone-increasing, so the
// composite is monotone-non-increasing in spend. See the token-invariant test.
// ──────────────────────────────────────────────────────────────────────────

// Anchors (provisional, #51): survivingLOCPerDollar of 4 ≈ score 50, so
// score = ratio/ANCHOR*50 capped 100 → 8 surviving LOC per $ ≈ 100.
const LOC_PER_DOLLAR_ANCHOR = 4;
// commitsPerDollar of 0.5 ≈ score 50 (≈ $2 per shipped commit) → 1.0 ≈ 100.
const COMMITS_PER_DOLLAR_ANCHOR = 0.5;

/** Linear anchor map: value == anchor → 50, capped 100. */
function anchorScore(value: number, anchorValue: number): number {
  return clamp((value / anchorValue) * 50);
}

export function pillarYield(input: CraftInput): number {
  const totalSurvivingLoc = sum(input.sessions.map(survivingLoc));
  const totalShippedCommits = sum(input.sessions.map((s) => s.git?.commitsInWindow ?? 0));

  const dollars = Math.max(1, input.windowCostUsd);
  const survivingLocPerDollar = totalSurvivingLoc / dollars;
  const commitsPerDollar = totalShippedCommits / dollars;

  const locYield = anchorScore(survivingLocPerDollar, LOC_PER_DOLLAR_ANCHOR);
  const commitYield = anchorScore(commitsPerDollar, COMMITS_PER_DOLLAR_ANCHOR);

  return round1(clamp(0.6 * locYield + 0.4 * commitYield));
}

// ──────────────────────────────────────────────────────────────────────────
// P5 Orchestration — parallelism that SHIPS.
//   0.6*spawnYield + 0.4*modelDiversity.
//   spawnYield     = mean(subagentSpawns on shipped sessions), scaled ÷3*100.
//   modelDiversity = distinct non-null models across all sessions, ÷3*100 cap.
//   Empty spawns with nothing shipped score ~0 (spawnYield reads shipped only).
// ──────────────────────────────────────────────────────────────────────────
const SPAWN_ANCHOR = 3; // mean spawns/shipped-session that maxes spawnYield
const MODEL_DIVERSITY_ANCHOR = 3; // distinct models that maxes diversity

export function pillarOrchestration(sessions: SessionRecord[]): number {
  const shippedSessions = sessions.filter(shipped);
  const meanSpawns = mean(shippedSessions.map((s) => s.subagentSpawns));
  const spawnYield = clamp((meanSpawns / SPAWN_ANCHOR) * 100);

  const models = new Set(sessions.map((s) => s.model).filter((m): m is string => !!m));
  const modelDiversity = clamp((models.size / MODEL_DIVERSITY_ANCHOR) * 100);

  return round1(clamp(0.6 * spawnYield + 0.4 * modelDiversity));
}

// ──────────────────────────────────────────────────────────────────────────
// P6 Throughput — sustained VERIFIED output (surviving LOC only).
//   survivingLOCPerActiveDay + shippedCommitsPerActiveDay, anchor-mapped.
//   activeDays = distinct session start-days; we only carry startHour (not the
//   date), so approximate activeDays via session count (capped, ≥1) per spec.
// ──────────────────────────────────────────────────────────────────────────
const LOC_PER_DAY_ANCHOR = 200; // surviving LOC/active-day that scores 50 → 400 ≈ 100
const COMMITS_PER_DAY_ANCHOR = 3; // shipped commits/active-day that scores 50 → 6 ≈ 100

export function pillarThroughput(sessions: SessionRecord[]): number {
  const totalSurvivingLoc = sum(sessions.map(survivingLoc));
  const totalShippedCommits = sum(sessions.map((s) => s.git?.commitsInWindow ?? 0));
  // No per-session date in SessionRecord; approximate active days by session
  // count (≥1). Refined to true distinct start-days once dates ship (#51).
  const activeDays = Math.max(1, sessions.length);

  const locPerDay = totalSurvivingLoc / activeDays;
  const commitsPerDay = totalShippedCommits / activeDays;

  const locScore = anchorScore(locPerDay, LOC_PER_DAY_ANCHOR);
  const commitScore = anchorScore(commitsPerDay, COMMITS_PER_DAY_ANCHOR);

  return round1(clamp(0.5 * locScore + 0.5 * commitScore));
}

/** All six pillars from a user's merged deep input. */
export function computePillars(input: CraftInput): Pillars {
  return {
    direction: pillarDirection(input.sessions),
    verification: pillarVerification(input.sessions),
    autonomy: pillarAutonomy(input.sessions),
    yield: pillarYield(input),
    orchestration: pillarOrchestration(input.sessions),
    throughput: pillarThroughput(input.sessions),
  };
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

// ──────────────────────────────────────────────────────────────────────────
// Craft Score — weighted mean MINUS a min-pulling penalty. A spiky profile
// (one elite pillar, the rest weak) scores below a balanced one with the same
// arithmetic mean: craft is judged on the floor, not the ceiling.
// ──────────────────────────────────────────────────────────────────────────
export function craftScore(pillars: Pillars): number {
  const values = PILLARS.map((p) => pillars[p]);
  const weightedMean = sum(PILLARS.map((p) => pillars[p] * PILLAR_WEIGHTS[p]));
  const penalty = K_MIN_PULL * (Math.max(...values) - median(values));
  return round1(clamp(weightedMean - penalty));
}

// ──────────────────────────────────────────────────────────────────────────
// Pillar percentiles / cohort. Like percentileAxes: caller passes the FULL
// consented deep-mode population (including this user). Below
// PERCENTILE_MIN_POPULATION we return the raw calibrated pillar values badged
// `provisional: true`. (Cohort activity-banding is a #51 refinement.)
// ──────────────────────────────────────────────────────────────────────────
export interface PillarPercentileResult {
  pillars: Pillars;
  provisional: boolean;
}

export function pillarPercentiles(me: CraftInput, population: CraftInput[]): PillarPercentileResult {
  const mine = computePillars(me);
  if (population.length < PERCENTILE_MIN_POPULATION) {
    return { pillars: mine, provisional: true };
  }
  const all = population.map(computePillars);
  const out = {} as Pillars;
  for (const pillar of PILLARS) {
    const below = all.filter((p) => p[pillar] < mine[pillar]).length;
    out[pillar] = Math.round((below / Math.max(1, all.length - 1)) * 100);
  }
  return { pillars: out, provisional: false };
}

// ──────────────────────────────────────────────────────────────────────────
// Outcome economics — cost per surviving line and commits per $100.
// The anti-burn metric: what a dollar buys in lasting outcomes.
//
// NOTE: honest window mismatch — sessions span the deep window (≤60d,
// typically 40d); windowCostUsd is the 30d usage window. Same mismatch that
// pillarYield already carries; we label it, we don't hide it.
// ──────────────────────────────────────────────────────────────────────────
export interface OutcomeEconomics {
  survivingLoc: number;      // sum max(0, linesAdded - revertedLinesWithin14d) across sessions with git
  shippedCommits: number;    // total commits across sessions with git
  windowCostUsd: number;
  costPerSurvivingLoc: number | null;  // windowCostUsd / survivingLoc; null if survivingLoc < 50
  commitsPer100Usd: number | null;     // shippedCommits / windowCostUsd * 100; null if windowCostUsd < 1 or shippedCommits < 3
}

export function outcomeEconomics(sessions: SessionRecord[], windowCostUsd: number): OutcomeEconomics {
  const totalSurvivingLoc = sum(sessions.map(survivingLoc));
  const totalShippedCommits = sum(sessions.map((s) => s.git?.commitsInWindow ?? 0));

  // costPerSurvivingLoc: null if fewer than 50 surviving LOC — too noisy.
  let costPerSurvivingLoc: number | null = null;
  if (totalSurvivingLoc >= 50) {
    const raw = windowCostUsd / totalSurvivingLoc;
    // < $0.01: keep 4 significant decimals. ≥ $0.01: round to 2 decimals.
    costPerSurvivingLoc = raw < 0.01
      ? Math.round(raw * 10_000) / 10_000
      : Math.round(raw * 100) / 100;
  }

  // commitsPer100Usd: null if cost < $1 (denominator noise) or commits < 3.
  let commitsPer100Usd: number | null = null;
  if (windowCostUsd >= 1 && totalShippedCommits >= 3) {
    commitsPer100Usd = Math.round((totalShippedCommits / windowCostUsd) * 100 * 10) / 10;
  }

  return { survivingLoc: totalSurvivingLoc, shippedCommits: totalShippedCommits, windowCostUsd, costPerSurvivingLoc, commitsPer100Usd };
}

// ──────────────────────────────────────────────────────────────────────────
// Trust tier — how much we trust the git signal behind the score.
//   1 = local-git credential: at least one session has a non-null git outcome
//       with commitsInWindow>0 AND hasRemote (real repo, real remote).
//   0 = unverified (behavioral only).
//   Tier 2 (GitHub-verified) is issue #48.
// ──────────────────────────────────────────────────────────────────────────
export function trustTierOf(sessions: SessionRecord[]): 0 | 1 {
  return sessions.some((s) => s.git && s.git.commitsInWindow > 0 && s.git.hasRemote) ? 1 : 0;
}
