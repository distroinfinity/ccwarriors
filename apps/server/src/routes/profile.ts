import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { eq, sql } from "drizzle-orm";
import type { DB } from "../db/index.js";
import { users, usageDays, orgMembers } from "../db/schema.js";
import type { LeaderboardStore } from "../lib/leaderboard-store.js";
import type { InsightsStore } from "../lib/insights-store.js";
import { readSessionToken } from "../lib/session.js";
import { computeEfficiency, computeRhythm } from "../lib/efficiency.js";
import {
  AXES,
  archetypeOf,
  calibratedAxes,
  percentileAxes,
  growthEdgeOf,
  habitStats,
  traitOf,
  MIN_SESSIONS,
  PERCENTILE_MIN_POPULATION,
} from "../lib/insights.js";

export interface ProfileDeps {
  db: DB;
  store: LeaderboardStore;
  insightsStore: InsightsStore;
  sessionSecret?: string;
}

const LOGIN_RE = /^[a-zA-Z0-9-]{1,39}$/; // GitHub login charset

export function profileRoute(deps: ProfileDeps) {
  const app = new Hono();

  app.get("/:login", async (c) => {
    const raw = c.req.param("login");
    if (!LOGIN_RE.test(raw)) return c.json({ error: "not_found" }, 404);

    // DB row is the identity source of truth; the store supplies live rank.
    const [user] = await deps.db
      .select()
      .from(users)
      .where(sql`lower(${users.githubLogin}) = ${raw.toLowerCase()}`);
    const entry = deps.store.getByLogin(raw);
    if (!user && !entry) return c.json({ error: "not_found" }, 404);

    const login = user?.githubLogin ?? entry!.githubLogin;
    const flagged = !!user?.flaggedAt || !!entry?.flagged;

    // Owner check: session cookie matching this profile unlocks consent state
    // and private insights.
    let isOwner = false;
    if (deps.sessionSecret) {
      const cookie = getCookie(c, "ccw_session");
      const session = cookie ? readSessionToken(cookie, deps.sessionSecret) : null;
      isOwner = !!session && !!user && session.githubId === user.githubId;
    }

    // Rhythm + efficiency from usage_days (all history retained in the table).
    const rows = user
      ? await deps.db
          .select({ day: usageDays.day, cost: usageDays.cost, modelBreakdown: usageDays.modelBreakdown })
          .from(usageDays)
          .where(eq(usageDays.userId, user.id))
      : [];
    const dayRows = rows.map((r) => ({ day: r.day, cost: Number(r.cost), modelBreakdown: r.modelBreakdown }));
    const today = new Date().toISOString().slice(0, 10);
    const cutoff30 = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const rhythm = computeRhythm(dayRows, today);
    const efficiency = dayRows.length > 0 ? computeEfficiency(dayRows, cutoff30) : null;

    // Insights: locked unless consented AND (public OR owner) AND enough sessions.
    const merged = user ? deps.insightsStore.merged(user.id) : null;
    let insights:
      | { locked: true; reason: "no_consent" | "private" | "forging" }
      | {
          locked: false;
          scoresArePercentiles: boolean;
          population: number;
          axes: Record<(typeof AXES)[number], number>;
          archetype: string;
          trait: string | null;
          habits: ReturnType<typeof habitStats>;
          growthEdge: string;
        };
    if (!user?.insightsConsent || !merged) {
      insights = { locked: true, reason: "no_consent" };
    } else if (user.insightsVisibility === "private" && !isOwner) {
      insights = { locked: true, reason: "private" };
    } else if (merged.sessions < MIN_SESSIONS) {
      insights = { locked: true, reason: "forging" };
    } else {
      const pop = deps.insightsStore.population();
      const usePercentiles = pop.length >= PERCENTILE_MIN_POPULATION;
      const axes = usePercentiles ? percentileAxes(merged, pop) : calibratedAxes(merged);
      const effHint = efficiency
        ? { opusShare: efficiency.opusShare, estSavingsPerMonth: efficiency.estSavingsPerMonth ?? 0 }
        : null;
      insights = {
        locked: false,
        scoresArePercentiles: usePercentiles,
        population: pop.length,
        axes,
        archetype: archetypeOf(axes),
        trait: traitOf(merged, { weekendShare: rhythm.weekendShare, currentStreak: rhythm.currentStreak }),
        habits: habitStats(merged),
        growthEdge: growthEdgeOf(axes, merged, effHint),
      };
    }

    const orgs = user
      ? (await deps.db.select({ orgSlug: orgMembers.orgSlug }).from(orgMembers).where(eq(orgMembers.userId, user.id))).map((r) => r.orgSlug)
      : entry?.orgs ?? [];

    // Owner responses are personalized — never let a shared cache serve them.
    c.header("Cache-Control", isOwner ? "private, no-store" : "public, max-age=30");
    return c.json({
      login,
      avatarUrl: user?.avatarUrl ?? entry?.avatarUrl ?? "",
      xHandle: user?.xHandle ?? entry?.xHandle ?? null,
      tier: entry?.tier ?? user?.tier ?? "Stone",
      cardScene: entry?.cardScene ?? user?.cardScene ?? "fujiNight",
      cost30d: entry?.cost30d ?? Number(user?.cost30d ?? 0),
      costAllTime: entry?.costAllTime ?? Number(user?.costAllTime ?? 0),
      rank30d: entry && !flagged ? deps.store.getRank("30d", entry.id) : null,
      rankAllTime: entry && !flagged ? deps.store.getRank("allTime", entry.id) : null,
      underReview: flagged,
      memberSince: user?.createdAt?.toISOString() ?? null,
      lastSyncedAt: user?.lastSyncedAt?.toISOString() ?? null,
      orgs,
      rhythm: { days: rhythm.days, currentStreak: rhythm.currentStreak, longestStreak: rhythm.longestStreak },
      efficiency,
      insights,
      ...(isOwner
        ? {
            owner: {
              consent: user!.insightsConsent,
              visibility: user!.insightsVisibility,
              machineCount: deps.insightsStore.machineCount(user!.id),
            },
          }
        : {}),
    });
  });

  return app;
}
