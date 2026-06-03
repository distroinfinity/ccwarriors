import { eq } from "drizzle-orm";
import type { DB } from "../db/index.js";
import { users, snapshots } from "../db/schema.js";
import { hashToken } from "../lib/token.js";
import { computeTier } from "../lib/tier.js";
import type { LeaderboardStore } from "../lib/leaderboard-store.js";

export const MIN_SYNC_INTERVAL_MS = 60_000;
export const SANITY_CAP = 1_000_000;

export interface IngestPayload {
  cost30d: number;
  costAllTime: number;
  ccusageVersion?: string;
}

export type IngestResult =
  | { ok: true; tier: string; rank30d: number | null; rankAllTime: number | null }
  | { ok: false; error: "unauthorized" | "implausible" | "rate_limited" };

export async function ingestUsage(
  db: DB,
  store: LeaderboardStore,
  token: string,
  payload: IngestPayload,
  now: number = Date.now(),
): Promise<IngestResult> {
  const [user] = await db.select().from(users).where(eq(users.cliTokenHash, hashToken(token)));
  if (!user) return { ok: false, error: "unauthorized" };

  if (
    payload.cost30d < 0 ||
    payload.costAllTime < 0 ||
    payload.cost30d > SANITY_CAP ||
    payload.costAllTime > SANITY_CAP
  ) {
    return { ok: false, error: "implausible" };
  }
  if (user.lastSyncedAt && now - user.lastSyncedAt.getTime() < MIN_SYNC_INTERVAL_MS) {
    return { ok: false, error: "rate_limited" };
  }

  const tier = computeTier(payload.costAllTime);
  const syncedAt = new Date(now);

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        cost30d: String(payload.cost30d),
        costAllTime: String(payload.costAllTime),
        tier,
        lastSyncedAt: syncedAt,
      })
      .where(eq(users.id, user.id));

    await tx.insert(snapshots).values({
      userId: user.id,
      cost30d: String(payload.cost30d),
      costAllTime: String(payload.costAllTime),
      ccusageVersion: payload.ccusageVersion ?? "",
    });
  });

  store.upsert({
    id: user.id,
    githubLogin: user.githubLogin,
    avatarUrl: user.avatarUrl,
    xHandle: user.xHandle,
    tier,
    cardScene: user.cardScene,
    cost30d: payload.cost30d,
    costAllTime: payload.costAllTime,
  });

  return {
    ok: true,
    tier,
    rank30d: store.getRank("30d", user.id),
    rankAllTime: store.getRank("allTime", user.id),
  };
}
