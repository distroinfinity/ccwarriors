import { and, eq, gte } from "drizzle-orm";
import type { DB } from "../../db/index.js";
import { users, usageDays, type ModelTokens } from "../../db/schema.js";
import { computeEfficiency, type UsageDayLike } from "../efficiency.js";
import { loadDeepSessions } from "../craft-score-service.js";
import { apportionWindowCost } from "./apportion.js";
import type { Benchmarks, CoachContext, PerToolUsage } from "./types.js";

export const COACH_WINDOW_DAYS = 30; // matches the efficiency/board window

function cutoffDay(now: number, days: number): string {
  return new Date(now - days * 86_400_000).toISOString().slice(0, 10);
}

/** Per-tool cost + token totals inside the coach window. usageDays.tool is NOT NULL. */
export async function loadWindowUsageByTool(db: DB, userId: string, now: number): Promise<PerToolUsage[]> {
  const cutoff = cutoffDay(now, COACH_WINDOW_DAYS);
  const rows = await db
    .select({
      tool: usageDays.tool, cost: usageDays.cost,
      inputTokens: usageDays.inputTokens, outputTokens: usageDays.outputTokens,
      cacheCreationTokens: usageDays.cacheCreationTokens, cacheReadTokens: usageDays.cacheReadTokens,
    })
    .from(usageDays)
    .where(and(eq(usageDays.userId, userId), gte(usageDays.day, cutoff)));
  const byTool = new Map<string, PerToolUsage>();
  for (const r of rows) {
    const t = byTool.get(r.tool) ?? { tool: r.tool, cost: 0, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
    t.cost += Number(r.cost);
    t.inputTokens += r.inputTokens;
    t.outputTokens += r.outputTokens;
    t.cacheCreationTokens += r.cacheCreationTokens;
    t.cacheReadTokens += r.cacheReadTokens;
    byTool.set(r.tool, t);
  }
  return [...byTool.values()];
}

/** Cache-read ratio per calendar month over ~53 weeks (self-comparison history). */
export async function loadMonthlyCacheRatios(db: DB, userId: string, now: number): Promise<Array<{ month: string; ratio: number }>> {
  const cutoff = cutoffDay(now, 53 * 7);
  const rows = await db
    .select({ day: usageDays.day, input: usageDays.inputTokens, cacheCreate: usageDays.cacheCreationTokens, cacheRead: usageDays.cacheReadTokens })
    .from(usageDays)
    .where(and(eq(usageDays.userId, userId), gte(usageDays.day, cutoff)));
  const byMonth = new Map<string, { read: number; denom: number }>();
  for (const r of rows) {
    const month = r.day.slice(0, 7);
    const m = byMonth.get(month) ?? { read: 0, denom: 0 };
    m.read += r.cacheRead;
    m.denom += r.input + r.cacheCreate + r.cacheRead;
    byMonth.set(month, m);
  }
  return [...byMonth.entries()]
    .filter(([, m]) => m.denom > 0)
    .map(([month, m]) => ({ month, ratio: m.read / m.denom }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/** Run-rate projection for the current month + prior-month total. */
export function computeBurn(
  dayRows: Array<{ day: string; cost: number }>,
  now: number,
): { projectedMonthUsd: number; priorMonthUsd: number | null; runRatePerDay: number } {
  const windowCutoff = cutoffDay(now, COACH_WINDOW_DAYS);
  const windowCost = dayRows.filter((r) => r.day >= windowCutoff).reduce((s, r) => s + r.cost, 0);
  const runRatePerDay = windowCost / COACH_WINDOW_DAYS;
  const d = new Date(now);
  const priorMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
  const priorRows = dayRows.filter((r) => r.day.slice(0, 7) === priorMonth);
  const priorMonthUsd = priorRows.length > 0 ? priorRows.reduce((s, r) => s + r.cost, 0) : null;
  return { projectedMonthUsd: runRatePerDay * 30, priorMonthUsd, runRatePerDay };
}

/** Assemble the full CoachContext for one user. */
export async function buildCoachContext(
  db: DB,
  user: typeof users.$inferSelect,
  isOwner: boolean,
  now: number,
  benchmarks: Benchmarks,
): Promise<CoachContext> {
  const usageByTool = await loadWindowUsageByTool(db, user.id, now);
  const windowCostUsd = usageByTool.reduce((s, t) => s + t.cost, 0);

  // Efficiency over the window: build UsageDayLike rows from a full-window read.
  // When modelBreakdown is absent (legacy rows), synthesise one entry from the
  // direct token columns so computeEfficiency can compute cacheReadRatio.
  const cutoff = cutoffDay(now, COACH_WINDOW_DAYS);
  const effRows = await db
    .select({
      day: usageDays.day, cost: usageDays.cost, tool: usageDays.tool,
      modelBreakdown: usageDays.modelBreakdown,
      inputTokens: usageDays.inputTokens, outputTokens: usageDays.outputTokens,
      cacheCreationTokens: usageDays.cacheCreationTokens, cacheReadTokens: usageDays.cacheReadTokens,
    })
    .from(usageDays)
    .where(eq(usageDays.userId, user.id));
  const dayRows: UsageDayLike[] = effRows.map((r) => {
    let modelBreakdown = r.modelBreakdown as ModelTokens[] | null;
    if (!modelBreakdown || modelBreakdown.length === 0) {
      const total = r.inputTokens + r.outputTokens + r.cacheCreationTokens + r.cacheReadTokens;
      if (total > 0) {
        modelBreakdown = [{ modelName: r.tool, inputTokens: r.inputTokens, outputTokens: r.outputTokens, cacheCreationTokens: r.cacheCreationTokens, cacheReadTokens: r.cacheReadTokens }];
      }
    }
    return { day: r.day, cost: Number(r.cost), modelBreakdown };
  });
  const efficiency = dayRows.length > 0 ? computeEfficiency(dayRows, cutoff) : null;

  const monthlyCacheRatios = await loadMonthlyCacheRatios(db, user.id, now);
  const burn = computeBurn(dayRows.map((r) => ({ day: r.day, cost: r.cost })), now);

  const deepMode = user.insightsMode === "deep";
  let deepSessions: CoachContext["deepSessions"] = [];
  if (deepMode) {
    const sessions = await loadDeepSessions(db, user.id);
    const costByTool = new Map(usageByTool.map((t) => [t.tool, t.cost]));
    deepSessions = apportionWindowCost(sessions, costByTool);
  }

  return {
    now, windowDays: COACH_WINDOW_DAYS, isOwner, deepMode, windowCostUsd,
    usageByTool, efficiency, monthlyCacheRatios, burn, deepSessions, benchmarks,
  };
}
