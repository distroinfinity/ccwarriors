// Assembles the pure CraftInput from a user's stored deep sessions + usage_days,
// then computes pillars + craft score + trust tier. Kept out of craft-score.ts
// so that file stays pure (no DB/efficiency coupling, easy to unit test).
import { eq } from "drizzle-orm";
import type { DB } from "../db/index.js";
import { usageDays, userDeepSessions, type SessionRecord } from "../db/schema.js";
import { computeEfficiency, type UsageDayLike } from "./efficiency.js";
import {
  computePillars,
  craftScore,
  trustTierOf,
  type CraftInput,
  type Pillars,
} from "./craft-score.js";

export interface CraftResult {
  craftScore: number;
  pillars: Pillars;
  trustTier: 0 | 1;
  input: CraftInput;
}

const WINDOW_DAYS = 30; // matches the efficiency/board window

/** Pull every machine's deep sessions for a user and concatenate them. */
export async function loadDeepSessions(db: DB, userId: string): Promise<SessionRecord[]> {
  const rows = await db
    .select({ sessions: userDeepSessions.sessions })
    .from(userDeepSessions)
    .where(eq(userDeepSessions.userId, userId));
  return rows.flatMap((r) => r.sessions);
}

/** Window cost + token totals + cache/opus signal from usage_days. */
async function loadUsageSignal(
  db: DB,
  userId: string,
  now: number,
): Promise<{ windowCostUsd: number; windowTokens: number; cacheReadRatio: number | null; opusShare: number }> {
  const rows = await db
    .select({ day: usageDays.day, cost: usageDays.cost, modelBreakdown: usageDays.modelBreakdown })
    .from(usageDays)
    .where(eq(usageDays.userId, userId));
  const cutoff = new Date(now - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  const dayRows: UsageDayLike[] = rows.map((r) => ({
    day: r.day,
    cost: Number(r.cost),
    modelBreakdown: r.modelBreakdown,
  }));
  const window = dayRows.filter((r) => r.day >= cutoff);
  const windowCostUsd = window.reduce((s, r) => s + r.cost, 0);
  const windowTokens = window.reduce(
    (s, r) =>
      s +
      (r.modelBreakdown ?? []).reduce(
        (t, m) => t + m.inputTokens + m.outputTokens + m.cacheCreationTokens + m.cacheReadTokens,
        0,
      ),
    0,
  );
  const eff = dayRows.length > 0 ? computeEfficiency(dayRows, cutoff) : null;
  return {
    windowCostUsd,
    windowTokens,
    cacheReadRatio: eff?.cacheReadRatio ?? null,
    opusShare: eff?.opusShare ?? 0,
  };
}

/** Full pipeline: load deep sessions + usage signal → pillars + score + tier.
 *  Returns null when the user has no deep sessions (score is undefined). */
export async function computeCraftForUser(
  db: DB,
  userId: string,
  now: number = Date.now(),
): Promise<CraftResult | null> {
  const sessions = await loadDeepSessions(db, userId);
  if (sessions.length === 0) return null;
  const usage = await loadUsageSignal(db, userId, now);
  const input: CraftInput = { sessions, ...usage };
  const pillars = computePillars(input);
  return {
    craftScore: craftScore(pillars),
    pillars,
    trustTier: trustTierOf(sessions),
    input,
  };
}
