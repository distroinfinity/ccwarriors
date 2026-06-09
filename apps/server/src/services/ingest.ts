import { and, eq, gte } from "drizzle-orm";
import type { DB } from "../db/index.js";
import { users, snapshots, usageDays, orgMembers, type ModelTokens, type ToolBreakdown, type User } from "../db/schema.js";
import { hashToken } from "../lib/token.js";
import { computeTier } from "../lib/tier.js";
import type { LeaderboardStore } from "../lib/leaderboard-store.js";
import { isKnownTool, OTHER_TOOL } from "../lib/tools.js";
import { priceModels } from "../lib/pricing.js";
import {
  GATES,
  checkBurnRate,
  checkDailyCeiling,
  checkNewToolWindow,
  checkSettledDayGrowth,
  checkTokenShape,
  type FlagSignal,
} from "../lib/plausibility.js";
import { captureEvent } from "../routes/telemetry.js";

export const MIN_SYNC_INTERVAL_MS = 10_000;
export const SANITY_CAP = 1_000_000;
// A cheater could amplify the new-tool backfill cap by inventing machine ids.
export const MAX_MACHINES_PER_USER = 5;
// Accept raw days for a rolling window; older days are dropped silently
// (timezone drift, slow clocks — not worth flagging).
const WINDOW_DAYS = 40;
const BOARD_DAYS = 30;

export interface LegacyIngestPayload {
  kind: "legacy";
  cost30d: number;
  costAllTime: number;
  ccusageVersion?: string;
}

export interface RawDay {
  date: string; // YYYY-MM-DD
  models: ModelTokens[];
  costEstimate?: number; // ccusage's own price for the day (display hint)
}

export interface RawIngestPayload {
  kind: "raw";
  tools: Record<string, RawDay[]>;
  machineId: string;
  clientBuildId?: string;
  ccusageVersion?: string;
}

export type IngestPayload = LegacyIngestPayload | RawIngestPayload;

export type IngestResult =
  | {
      ok: true;
      tier: string;
      rank30d: number | null;
      rankAllTime: number | null;
      insightsRequested: boolean;
      insightsMode: string;
    }
  | { ok: false; error: "unauthorized" | "implausible" | "rate_limited" };

const round2 = (n: number) => Math.round(n * 100) / 100;

function dayKey(machineId: string, tool: string, day: string): string {
  return `${machineId}|${tool}|${day}`;
}

/** Previous per-tool aggregate; legacy rows derive an all-claude breakdown. */
function prevBreakdownOf(user: User): ToolBreakdown {
  if (user.toolBreakdown) return user.toolBreakdown;
  const cost30d = Number(user.cost30d);
  const costAllTime = Number(user.costAllTime);
  if (cost30d === 0 && costAllTime === 0) return {};
  return { claude: { cost30d, costAllTime } };
}

function breakdown30d(b: ToolBreakdown): Record<string, number> {
  return Object.fromEntries(
    Object.entries(b)
      .filter(([, v]) => v.cost30d > 0)
      .map(([k, v]) => [k, v.cost30d]),
  );
}

async function flagUser(db: DB, store: LeaderboardStore, user: User, signals: FlagSignal[]) {
  if (user.flaggedAt || signals.length === 0) return;
  const reason = signals
    .slice(0, 3)
    .map((s) => `${s.reason}: ${s.detail}`)
    .join(" | ");
  await db.update(users).set({ flaggedAt: new Date(), flagReason: reason }).where(eq(users.id, user.id));
  store.setFlagged(user.id, true);
  captureEvent("plausibility_flagged", user.githubLogin, { reason: signals[0]!.reason, detail: reason });
}

export async function ingestUsage(
  db: DB,
  store: LeaderboardStore,
  token: string,
  payload: IngestPayload,
  now: number = Date.now(),
): Promise<IngestResult> {
  const [user] = await db.select().from(users).where(eq(users.cliTokenHash, hashToken(token)));
  if (!user) return { ok: false, error: "unauthorized" };

  if (user.lastSyncedAt && now - user.lastSyncedAt.getTime() < MIN_SYNC_INTERVAL_MS) {
    return { ok: false, error: "rate_limited" };
  }

  return payload.kind === "legacy"
    ? ingestLegacy(db, store, user, payload, now)
    : ingestRaw(db, store, user, payload, now);
}

// ── v1: legacy claude-only clients. Behavior unchanged (incl. the 422 cap)
//    except the burn-rate gate now applies — legacy riggers get quarantined too.
async function ingestLegacy(
  db: DB,
  store: LeaderboardStore,
  user: User,
  payload: LegacyIngestPayload,
  now: number,
): Promise<IngestResult> {
  if (
    payload.cost30d < 0 ||
    payload.costAllTime < 0 ||
    payload.cost30d > SANITY_CAP ||
    payload.costAllTime > SANITY_CAP
  ) {
    return { ok: false, error: "implausible" };
  }

  const prev = prevBreakdownOf(user);
  // Old clients report ONE lumped number — and since ccusage v20 the base
  // aggregate includes every agent, not just claude. For a user the server
  // already knows multi-tool (a v3 sync from another machine, or the minute
  // before their client self-updated), naively writing the lump into the
  // claude slice double counts the other tools and trips the burn gate.
  // Subtract the known non-claude slices to recover the claude share.
  const others30 = Object.entries(prev)
    .filter(([k]) => k !== "claude")
    .reduce((s, [, v]) => s + v.cost30d, 0);
  const othersAll = Object.entries(prev)
    .filter(([k]) => k !== "claude")
    .reduce((s, [, v]) => s + v.costAllTime, 0);
  const claude30 = user.hasBreakdown ? Math.max(0, payload.cost30d - others30) : payload.cost30d;
  const claudeAll = user.hasBreakdown
    ? Math.max(prev["claude"]?.costAllTime ?? 0, payload.costAllTime - othersAll)
    : Math.max(prev["claude"]?.costAllTime ?? 0, payload.costAllTime);
  const next: ToolBreakdown = {
    ...prev,
    claude: { cost30d: claude30, costAllTime: claudeAll },
  };
  const totals = sumBreakdown(user.hasBreakdown ? next : { claude: next["claude"]! });

  const signals: FlagSignal[] = [];
  const burn = checkBurnRate(Number(user.cost30d), totals.cost30d, user.lastSyncedAt, now);
  if (burn) signals.push(burn);

  return finalize(db, store, user, {
    totals,
    breakdown: user.hasBreakdown ? next : null,
    hasBreakdown: user.hasBreakdown,
    ccusageVersion: payload.ccusageVersion,
    clientBuildId: null,
    signals,
    now,
  });
}

// ── v3: raw per-tool/day/model token counts. The server prices everything.
async function ingestRaw(
  db: DB,
  store: LeaderboardStore,
  user: User,
  payload: RawIngestPayload,
  now: number,
): Promise<IngestResult> {
  const signals: FlagSignal[] = [];
  const cutoffWindow = new Date(now - WINDOW_DAYS * 86_400_000);
  // Date-label compare (not timestamp): ccusage groups days by local date
  // string, so the board's 30d window must include the same labels the CLI
  // shows users — otherwise the boundary day drifts the totals.
  const cutoff30Day = isoDay(new Date(now - BOARD_DAYS * 86_400_000));

  // Normalize tool keys (unknown → "other", merged) and drop out-of-window days.
  interface NormDay {
    models: ModelTokens[];
    estimate?: number;
  }
  const normalized = new Map<string, Map<string, NormDay>>(); // tool → day → tokens+estimate
  for (const [rawKey, days] of Object.entries(payload.tools)) {
    const tool = isKnownTool(rawKey) ? rawKey : OTHER_TOOL;
    const byDay = normalized.get(tool) ?? new Map<string, NormDay>();
    for (const d of days) {
      const t = new Date(`${d.date}T00:00:00Z`).getTime();
      if (!Number.isFinite(t) || t < cutoffWindow.getTime() || t > now + 2 * 86_400_000) continue;
      const prev = byDay.get(d.date);
      byDay.set(d.date, {
        models: [...(prev?.models ?? []), ...d.models],
        estimate:
          d.costEstimate !== undefined || prev?.estimate !== undefined
            ? (prev?.estimate ?? 0) + (d.costEstimate ?? 0)
            : undefined,
      });
    }
    if (byDay.size > 0) normalized.set(tool, byDay);
  }

  // Existing rows in the window: history gate + delta accumulation + aggregates.
  const existing = await db
    .select()
    .from(usageDays)
    .where(and(eq(usageDays.userId, user.id), gte(usageDays.day, isoDay(cutoffWindow))));
  const existingByKey = new Map(existing.map((r) => [dayKey(r.machineId, r.tool, r.day), r]));
  const machines = new Set(existing.map((r) => r.machineId));
  machines.add(payload.machineId);
  if (machines.size > MAX_MACHINES_PER_USER) {
    signals.push({ reason: "machine_count", detail: `${machines.size} machine ids` });
  }

  // Price every incoming day and run the per-day gates.
  interface PricedRow {
    tool: string;
    day: string;
    models: ModelTokens[];
    cost: number;
    prevCost: number;
  }
  // Server-computed dollars are the ONLY stored/ranked values. ccusage's
  // client-side estimates ride along purely as a cross-check: aggregate
  // divergence beyond the band → estimate_mismatch telemetry (tampered client
  // OR our pricing table went stale — both worth eyes, neither auto-flags).
  const priced: PricedRow[] = [];
  const unknownModelNames = new Set<string>();
  let sumComputed = 0;
  let sumEstimate = 0;
  for (const [tool, byDay] of normalized) {
    for (const [day, { models, estimate }] of byDay) {
      const { cost, unknownModels } = priceModels(models);
      for (const m of unknownModels) unknownModelNames.add(m);
      if (estimate !== undefined && estimate > 0) {
        sumComputed += cost;
        sumEstimate += estimate;
      }
      const prev = existingByKey.get(dayKey(payload.machineId, tool, day));
      const prevCost = prev ? Number(prev.cost) : 0;

      const ceiling = checkDailyCeiling(tool, day, cost);
      if (ceiling) signals.push(ceiling);
      const shape = checkTokenShape(tool, day, models);
      if (shape) signals.push(shape);
      if (prev) {
        const grow = checkSettledDayGrowth(tool, day, prevCost, cost, now);
        if (grow) signals.push(grow);
      }
      priced.push({ tool, day, models, cost, prevCost });
    }
  }

  // Non-quarantining telemetry signals (promised by lib/pricing.ts):
  if (unknownModelNames.size > 0) {
    captureEvent("unknown_model_priced", user.githubLogin, {
      models: [...unknownModelNames].slice(0, 10).join(","),
      count: unknownModelNames.size,
    });
  }
  if (sumComputed > 0 && Math.abs(sumEstimate - sumComputed) / sumComputed > GATES.estimateBand()) {
    captureEvent("estimate_mismatch", user.githubLogin, {
      computed: round2(sumComputed),
      estimate: round2(sumEstimate),
      clientBuildId: payload.clientBuildId ?? "",
    });
  }

  const prevBreakdown = prevBreakdownOf(user);

  // New-tool backfill gate: first-ever window for a tool can't be a fortune.
  const toolsWithHistory = new Set(existing.map((r) => r.tool));
  const windowByTool = new Map<string, number>();
  for (const p of priced) windowByTool.set(p.tool, (windowByTool.get(p.tool) ?? 0) + p.cost);
  for (const [tool, windowCost] of windowByTool) {
    if (!toolsWithHistory.has(tool) && !prevBreakdown[tool]) {
      const gate = checkNewToolWindow(tool, windowCost);
      if (gate) signals.push(gate);
    }
  }

  // Aggregate: overlay payload rows onto existing rows, sum per tool/window.
  const merged = new Map<string, { tool: string; day: string; cost: number }>();
  for (const r of existing) {
    merged.set(dayKey(r.machineId, r.tool, r.day), { tool: r.tool, day: r.day, cost: Number(r.cost) });
  }
  for (const p of priced) {
    merged.set(dayKey(payload.machineId, p.tool, p.day), { tool: p.tool, day: p.day, cost: p.cost });
  }

  const next: ToolBreakdown = {};
  const sum30ByTool = new Map<string, number>();
  for (const { tool, day, cost } of merged.values()) {
    if (day >= cutoff30Day) {
      sum30ByTool.set(tool, (sum30ByTool.get(tool) ?? 0) + cost);
    }
  }
  // All-time accumulates positive per-day deltas; the first raw sync for a
  // previously-tracked tool (the legacy→raw transition) takes max(prev, window)
  // so the overlapping legacy ~30d window isn't double counted.
  const allToolKeys = new Set([...windowByTool.keys(), ...sum30ByTool.keys(), ...Object.keys(prevBreakdown)]);
  for (const tool of allToolKeys) {
    const cost30d = round2(sum30ByTool.get(tool) ?? 0);
    const prevAll = prevBreakdown[tool]?.costAllTime ?? 0;
    const deltaSum = priced
      .filter((p) => p.tool === tool)
      .reduce((s, p) => s + Math.max(0, p.cost - p.prevCost), 0);
    let costAllTime: number;
    if (prevBreakdown[tool] && !toolsWithHistory.has(tool)) {
      const windowAll = round2(
        [...merged.values()].filter((m) => m.tool === tool).reduce((s, m) => s + m.cost, 0),
      );
      costAllTime = Math.max(prevAll, windowAll);
    } else {
      costAllTime = round2(prevAll + deltaSum);
    }
    if (cost30d > 0 || costAllTime > 0) next[tool] = { cost30d, costAllTime };
  }

  const totals = sumBreakdown(next);
  if (totals.cost30d > SANITY_CAP || totals.costAllTime > SANITY_CAP) {
    signals.push({ reason: "sanity_cap", detail: `total $${totals.cost30d.toFixed(0)}` });
  }

  // Burn-rate gate over previously-tracked tools only — a first multi-tool sync
  // legitimately jumps when codex/gemini/... appear (bounded by the gates above).
  const trackedNext = Object.entries(next)
    .filter(([tool]) => prevBreakdown[tool])
    .reduce((s, [, v]) => s + v.cost30d, 0);
  const burn = checkBurnRate(Number(user.cost30d), round2(trackedNext), user.lastSyncedAt, now);
  if (burn) signals.push(burn);

  return finalize(db, store, user, {
    totals,
    breakdown: next,
    hasBreakdown: true,
    ccusageVersion: payload.ccusageVersion,
    clientBuildId: payload.clientBuildId ?? null,
    signals,
    now,
    usageRows: priced.map((p) => ({
      userId: user.id,
      machineId: payload.machineId,
      tool: p.tool,
      day: p.day,
      inputTokens: sumField(p.models, "inputTokens"),
      outputTokens: sumField(p.models, "outputTokens"),
      cacheCreationTokens: sumField(p.models, "cacheCreationTokens"),
      cacheReadTokens: sumField(p.models, "cacheReadTokens"),
      modelBreakdown: p.models,
      cost: String(p.cost),
      updatedAt: new Date(now),
    })),
  });
}

function sumField(models: ModelTokens[], f: keyof Omit<ModelTokens, "modelName">): number {
  return models.reduce((s, m) => s + (m[f] ?? 0), 0);
}

function sumBreakdown(b: ToolBreakdown): { cost30d: number; costAllTime: number } {
  let cost30d = 0;
  let costAllTime = 0;
  for (const v of Object.values(b)) {
    cost30d += v.cost30d;
    costAllTime += v.costAllTime;
  }
  return { cost30d: round2(cost30d), costAllTime: round2(costAllTime) };
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

interface FinalizeArgs {
  totals: { cost30d: number; costAllTime: number };
  breakdown: ToolBreakdown | null;
  hasBreakdown: boolean;
  ccusageVersion?: string;
  clientBuildId: string | null;
  signals: FlagSignal[];
  now: number;
  usageRows?: (typeof usageDays.$inferInsert)[];
}

async function finalize(
  db: DB,
  store: LeaderboardStore,
  user: User,
  args: FinalizeArgs,
): Promise<IngestResult> {
  const tier = computeTier(args.totals.costAllTime);
  const syncedAt = new Date(args.now);

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        cost30d: String(args.totals.cost30d),
        costAllTime: String(args.totals.costAllTime),
        tier,
        lastSyncedAt: syncedAt,
        toolBreakdown: args.breakdown ?? undefined,
        hasBreakdown: args.hasBreakdown,
        clientBuildId: args.clientBuildId ?? undefined,
      })
      .where(eq(users.id, user.id));

    await tx.insert(snapshots).values({
      userId: user.id,
      cost30d: String(args.totals.cost30d),
      costAllTime: String(args.totals.costAllTime),
      ccusageVersion: args.ccusageVersion ?? "",
      toolBreakdown: args.breakdown,
      clientBuildId: args.clientBuildId,
    });

    for (const row of args.usageRows ?? []) {
      await tx
        .insert(usageDays)
        .values(row)
        .onConflictDoUpdate({
          target: [usageDays.userId, usageDays.machineId, usageDays.tool, usageDays.day],
          set: {
            inputTokens: row.inputTokens,
            outputTokens: row.outputTokens,
            cacheCreationTokens: row.cacheCreationTokens,
            cacheReadTokens: row.cacheReadTokens,
            modelBreakdown: row.modelBreakdown,
            cost: row.cost,
            updatedAt: row.updatedAt,
          },
        });
    }
  });

  // Shadow quarantine on violations — sync still succeeds, board membership doesn't.
  await flagUser(db, store, user, args.signals);
  const flagged = !!user.flaggedAt || args.signals.length > 0;

  // Org membership lives in org_members, not on the sync path — carry the
  // store's view forward; on a cold entry (first sync since boot) load it.
  let orgs = store.get(user.id)?.orgs;
  if (orgs === undefined) {
    const rows = await db
      .select({ orgSlug: orgMembers.orgSlug })
      .from(orgMembers)
      .where(eq(orgMembers.userId, user.id));
    orgs = rows.map((r) => r.orgSlug);
  }

  store.upsert({
    id: user.id,
    githubLogin: user.githubLogin,
    avatarUrl: user.avatarUrl,
    xHandle: user.xHandle,
    tier,
    cardScene: user.cardScene,
    cost30d: args.totals.cost30d,
    costAllTime: args.totals.costAllTime,
    breakdown: args.breakdown
      ? breakdown30d(args.breakdown)
      : { claude: args.totals.cost30d },
    flagged,
    orgs,
  });

  return {
    ok: true,
    tier,
    rank30d: store.getRank("30d", user.id),
    rankAllTime: store.getRank("allTime", user.id),
    // Back-compat: insightsRequested = (mode === 'deep'). mode is the new
    // source of truth the client reads going forward.
    insightsRequested: user.insightsMode === "deep",
    insightsMode: user.insightsMode,
  };
}
