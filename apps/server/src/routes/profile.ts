import { Hono, type Context } from "hono";
import { getCookie } from "hono/cookie";
import { and, eq, gte, sql } from "drizzle-orm";
import type { DB } from "../db/index.js";
import { users, usageDays, orgMembers, userStories, type ModelTokens } from "../db/schema.js";
import type { LeaderboardStore } from "../lib/leaderboard-store.js";
import type { InsightsStore } from "../lib/insights-store.js";
import { readSessionToken } from "../lib/session.js";
import { computeEfficiency, computeRhythm } from "../lib/efficiency.js";
import { BOARD_DAYS } from "../services/ingest.js";
import {
  AXES,
  archetypeOf,
  calibratedAxes,
  percentileAxes,
  percentilePool,
  growthEdgeOf,
  habitStats,
  traitOf,
  MIN_SESSIONS,
  PERCENTILE_MIN_POPULATION,
} from "../lib/insights.js";
import { computeCraftForUser, loadDeepExtras } from "../lib/craft-score-service.js";
import { tierOf, outcomeEconomics, type CraftTier, type Pillars, type OutcomeEconomics } from "../lib/craft-score.js";
import { applyPins, buildInsightCards, featuredDeck, selectDeck, type InsightCard } from "../lib/insight-cards.js";
import { githubVerified } from "../lib/github-stats.js";
import { getGithubStatsCached } from "../lib/github-stats-service.js";
import { buildStack, type StackProfile } from "../lib/stack.js";

export interface ProfileDeps {
  db: DB;
  store: LeaderboardStore;
  insightsStore: InsightsStore;
  sessionSecret?: string;
  // Server PAT for public GitHub-stats reads (null → user tokens only).
  githubToken?: string | null;
  // Test seam: injected fetch for the background GitHub refresh.
  githubFetcher?: typeof fetch;
}

// Locked unless consented AND (public OR owner). "forging" is the owner-only
// consented-but-nothing-uploaded state; visitors see "no_consent" either way.
type ProfileInsightsLocked = { locked: true; reason: "no_consent" | "forging" };

// Deep, consent-gated session signals — promoted to a first-class profile block.
interface ProfileDepth {
  sessions: number;
  windowDays: number;
  totalHours: number | null;
  planModeSessionsPct: number;
  subagentSessionsPct: number | null;
  subagentSpawnsPerSession: number;
  maxParallelAgents: number;
  maxConcurrentSessions?: number;
  avgSessionMinutes: number | null;
  longestSessionMinutes: number;
}

interface ProfileInsightsUnlocked {
  locked: false;
  scoresArePercentiles: boolean;
  population: number;
  axes: Record<(typeof AXES)[number], number>;
  archetype: string;
  trait: string | null;
  habits: ReturnType<typeof habitStats>;
  growthEdge: string;
  craftScore: number | null;
  craftTier: CraftTier | null;
  pillars: Pillars | null;
  trustTier: 0 | 1 | null;
  provisional: boolean;
  sampleSessions: number;
  windowDays: number;
  githubVerified: boolean;
  pinnedCards: string[];
  cards: InsightCard[];
  featuredCardKeys: string[];
  deckMonth: string;
  tagline: string | null;
  depth: ProfileDepth;
  economics: OutcomeEconomics | null;
  stack: StackProfile | null;
}

type ProfileInsights = ProfileInsightsLocked | ProfileInsightsUnlocked;

const LOGIN_RE = /^[a-zA-Z0-9-]{1,39}$/; // GitHub login charset

// Shared prelude for both profile reads: the bounded usage_days scan plus the
// rhythm/efficiency/github signals derived from it. Cheap — safe on the core
// (fast-paint) path.
async function loadProfileSignals(deps: ProfileDeps, user: typeof users.$inferSelect) {
  const cutoff53 = new Date(Date.now() - 53 * 7 * 86_400_000).toISOString().slice(0, 10);
  const rows = await deps.db
    .select({ day: usageDays.day, cost: usageDays.cost, modelBreakdown: usageDays.modelBreakdown })
    .from(usageDays)
    .where(and(eq(usageDays.userId, user.id), gte(usageDays.day, cutoff53)));
  const dayRows = rows.map((r) => ({ day: r.day, cost: Number(r.cost), modelBreakdown: r.modelBreakdown as ModelTokens[] | null }));
  const today = new Date().toISOString().slice(0, 10);
  const cutoff30 = new Date(Date.now() - BOARD_DAYS * 86_400_000).toISOString().slice(0, 10);
  const rhythm = computeRhythm(dayRows, today);
  const efficiency = dayRows.length > 0 ? computeEfficiency(dayRows, cutoff30) : null;
  const github = await getGithubStatsCached(
    { db: deps.db, serverToken: deps.githubToken ?? null, fetcher: deps.githubFetcher },
    user,
  );
  return { dayRows, rhythm, efficiency, github };
}

// The full consent-gated insights block (craft, pillars, cards, depth, stack).
// Lifted verbatim from the inline handler — same gating, same shape.
async function buildInsights(
  deps: ProfileDeps,
  user: typeof users.$inferSelect,
  isOwner: boolean,
  signals: { rhythm: ReturnType<typeof computeRhythm>; efficiency: ReturnType<typeof computeEfficiency> | null; github: Awaited<ReturnType<typeof getGithubStatsCached>> },
): Promise<ProfileInsights> {
  const { rhythm, efficiency, github } = signals;
  const merged = deps.insightsStore.merged(user.id);
  if (!user.insightsConsent) return { locked: true, reason: "no_consent" };
  if (user.insightsVisibility === "private" && !isOwner) return { locked: true, reason: "no_consent" };
  if (!merged || merged.sessions === 0) return { locked: true, reason: isOwner ? "forging" : "no_consent" };

  // Percentiles need both a big-enough pool AND a non-degenerate sample
  // for THIS user; everyone else gets calibrated scores (real data, just
  // not rank-normalized). Tiny samples never join the pool.
  const pop = percentilePool(deps.insightsStore.population());
  const usePercentiles = pop.length >= PERCENTILE_MIN_POPULATION && merged.sessions >= MIN_SESSIONS;
  const axes = usePercentiles ? percentileAxes(merged, pop) : calibratedAxes(merged);
  const effHint = efficiency
    ? { opusShare: efficiency.opusShare, estSavingsPerMonth: efficiency.estSavingsPerMonth ?? 0 }
    : null;
  // Craft Score: computed on demand from the user's deep sessions + usage
  // signal. Null when the user has no deep rows (aggregate-only insights).
  // provisional until the deep population crosses PERCENTILE_MIN_POPULATION
  // (single-pool percentiles are a #51 refinement); pillars stay calibrated.
  const craft = await computeCraftForUser(deps.db, user.id);
  const extras = craft ? await loadDeepExtras(deps.db, user.id) : null;
  const archetype = archetypeOf(axes);
  // Paxel-style insight deck. Built from the deep sessions craft already
  // loaded; cards self-guard and emit only when their real signal exists.
  // Empty when there's no deep data (aggregate-only insights).
  const pins = user.pinnedCards ?? [];
  // Story teaser: when a derived story exists, the deck leads with a card
  // linking to /:login/story.
  const login = user.githubLogin;
  const [story] = await deps.db
    .select({ doc: userStories.doc })
    .from(userStories)
    .where(eq(userStories.userId, user.id));
  const craftEconomics = craft
    ? outcomeEconomics(craft.input.sessions, craft.input.windowCostUsd)
    : null;
  // Stack profile: verified from real agent edits. Consent-gated (deep data).
  const stack = buildStack(
    craft?.input.sessions ?? null,
    efficiency?.modelMix ?? null,
    github,
  );
  const baseCards = craft
    ? buildInsightCards({
        sessions: craft.input.sessions,
        merged,
        efficiency,
        archetype,
        pillars: craft.pillars,
        github,
        extras,
        economics: craftEconomics,
        rhythm: {
          weekendShare: rhythm.weekendShare,
          currentStreak: rhythm.currentStreak,
          longestStreak: rhythm.longestStreak,
          activeDays: rhythm.days.length, // days already holds active days only
        },
      })
    : [];
  const storyCard: InsightCard | null = story
    ? {
        key: "story",
        question: "What's the full story?",
        headline: "Read your story",
        body: story.doc.narrative.slice(0, 140),
        shareText: `${story.doc.narrative.slice(0, 140)} My story on @ccwarriorsxyz.`,
      }
    : null;
  // Curate to a Wrapped-sized deck (pins bypass the cap), then order.
  const cards = applyPins(selectDeck(storyCard ? [storyCard, ...baseCards] : baseCards, pins), pins);
  // "This month" featuring: a curated 5-6, rotating monthly. The full deck stays
  // in `cards` for the client's "see all". Pure given login, deck, month, pins.
  const now = new Date();
  const deckMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const featuredCardKeys = featuredDeck(cards, login, deckMonth, pins);
  // Deep-session-derived signals (null when user has aggregate-only data).
  const deepSessions = craft && craft.input.sessions.length > 0 ? craft.input.sessions : null;
  const deepMinutes = deepSessions ? deepSessions.reduce((s, r) => s + r.durationMinutes, 0) : 0;
  const totalHours = deepSessions ? Math.round((deepMinutes / 60) * 10) / 10 : null;
  const avgSessionMinutes = deepSessions ? Math.round(deepMinutes / deepSessions.length) : null;
  const subagentSessionsPct = deepSessions
    ? Math.round((deepSessions.filter((r) => r.subagentSpawns > 0).length / deepSessions.length) * 100)
    : null;

  return {
    locked: false,
    scoresArePercentiles: usePercentiles,
    population: pop.length,
    axes,
    archetype,
    trait: traitOf(merged, { weekendShare: rhythm.weekendShare, currentStreak: rhythm.currentStreak }),
    habits: habitStats(merged),
    growthEdge: growthEdgeOf(axes, merged, effHint),
    craftScore: craft?.craftScore ?? null,
    craftTier: craft ? tierOf(craft.craftScore) : null,
    pillars: craft?.pillars ?? null,
    trustTier: craft?.trustTier ?? null,
    provisional: merged.sessions < MIN_SESSIONS || !usePercentiles,
    sampleSessions: merged.sessions,
    windowDays: merged.windowDays,
    githubVerified: githubVerified(craft?.trustTier ?? null, github),
    pinnedCards: pins,
    cards,
    featuredCardKeys,
    deckMonth,
    tagline: story?.doc.tagline ?? null,
    depth: {
      sessions: merged.sessions,
      windowDays: merged.windowDays,
      totalHours,
      planModeSessionsPct: Math.round(merged.planModeSessionsPct),
      subagentSessionsPct,
      subagentSpawnsPerSession: Math.round(merged.subagentSpawnsPerSession * 10) / 10,
      maxParallelAgents: merged.maxParallelAgents,
      ...(extras?.maxConcurrentSessions !== undefined ? { maxConcurrentSessions: extras.maxConcurrentSessions } : {}),
      avgSessionMinutes,
      longestSessionMinutes: Math.round(merged.longestSessionMinutes),
    },
    economics: craftEconomics,
    stack,
  };
}

export function profileRoute(deps: ProfileDeps) {
  const app = new Hono();

  function ownerOf(c: Context, githubId: string | undefined): boolean {
    if (!deps.sessionSecret || !githubId) return false;
    const cookie = getCookie(c, "ccw_session");
    const session = cookie ? readSessionToken(cookie, deps.sessionSecret) : null;
    return !!session && session.githubId === githubId;
  }

  // The story page (#50): the LLM-derived narrative. Public data when the
  // profile is public; private profiles serve it to the owner only.
  app.get("/:login/story", async (c) => {
    const raw = c.req.param("login");
    if (!LOGIN_RE.test(raw)) return c.json({ error: "not_found" }, 404);
    const [user] = await deps.db
      .select()
      .from(users)
      .where(sql`lower(${users.githubLogin}) = ${raw.toLowerCase()}`);
    if (!user) return c.json({ error: "not_found" }, 404);
    const isOwner = ownerOf(c, user.githubId);
    if (user.insightsVisibility === "private" && !isOwner) return c.json({ error: "not_found" }, 404);
    const [story] = await deps.db.select().from(userStories).where(eq(userStories.userId, user.id));
    if (!story) return c.json({ error: "no_story" }, 404);
    c.header("Cache-Control", isOwner ? "private, no-store" : "public, max-age=300");
    return c.json({
      login: user.githubLogin,
      avatarUrl: user.avatarUrl,
      story: story.doc,
      generatedAt: story.generatedAt.toISOString(),
    });
  });

  // Lazy insights read (#progressive-load): the expensive deep-session craft /
  // pillars / cards block, fetched in parallel by the web after the core paints.
  app.get("/:login/insights", async (c) => {
    const raw = c.req.param("login");
    if (!LOGIN_RE.test(raw)) return c.json({ error: "not_found" }, 404);
    const [user] = await deps.db
      .select()
      .from(users)
      .where(sql`lower(${users.githubLogin}) = ${raw.toLowerCase()}`);
    if (!user) return c.json({ error: "not_found" }, 404);
    const isOwner = ownerOf(c, user.githubId);
    const signals = await loadProfileSignals(deps, user);
    const insights = await buildInsights(deps, user, isOwner, signals);
    c.header("Cache-Control", isOwner ? "private, no-store" : "public, max-age=30");
    if (!isOwner) c.header("Vary", "Cookie");
    return c.json(insights);
  });

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

    const signals = user ? await loadProfileSignals(deps, user) : null;
    const rhythm = signals?.rhythm ?? { days: [], currentStreak: 0, longestStreak: 0, weekendShare: 0 };
    const efficiency = signals?.efficiency ?? null;
    const github = signals?.github ?? null;

    let tokensAllTime: number | null = null;
    if (user) {
      const [tot] = await deps.db
        .select({
          total: sql<string | null>`sum(${usageDays.inputTokens} + ${usageDays.outputTokens} + ${usageDays.cacheCreationTokens} + ${usageDays.cacheReadTokens})`,
        })
        .from(usageDays)
        .where(eq(usageDays.userId, user.id));
      tokensAllTime = tot?.total != null ? Number(tot.total) : null;
    }

    const orgs = user
      ? (await deps.db.select({ orgSlug: orgMembers.orgSlug }).from(orgMembers).where(eq(orgMembers.userId, user.id))).map((r) => r.orgSlug)
      : entry?.orgs ?? [];

    // Owner responses are personalized — never let a shared cache serve them.
    c.header("Cache-Control", isOwner ? "private, no-store" : "public, max-age=30");
    if (!isOwner) c.header("Vary", "Cookie");
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
      tokensAllTime,
      underReview: flagged,
      memberSince: user?.createdAt?.toISOString() ?? null,
      lastSyncedAt: user?.lastSyncedAt?.toISOString() ?? null,
      orgs,
      rhythm: {
        days: rhythm.days.filter((d) => d.day >= new Date(Date.now() - 53 * 7 * 86_400_000).toISOString().slice(0, 10)),
        currentStreak: rhythm.currentStreak,
        longestStreak: rhythm.longestStreak,
      },
      efficiency,
      github,
      ...(isOwner
        ? {
            owner: {
              consent: user!.insightsConsent,
              mode: user!.insightsMode,
              visibility: user!.insightsVisibility,
              machineCount: deps.insightsStore.machineCount(user!.id),
              // Lets the web offer the v2 upgrade to pre-existing deep users.
              consentVersion: user!.consentVersion ?? 1,
            },
          }
        : {}),
    });
  });

  return app;
}
