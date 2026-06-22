import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import type { DB } from "../db/index.js";
import {
  users,
  userInsights,
  userDeepSessions,
  storySources,
  userStories,
  type InsightsPayload,
  type InsightsDeepPayload,
  type User,
} from "../db/schema.js";
import { hashToken } from "../lib/token.js";
import { maybeGenerateStory } from "../lib/story-service.js";
import type { StoryGenerate } from "../lib/story.js";
import { readSessionToken } from "../lib/session.js";
import type { InsightsStore } from "../lib/insights-store.js";
import {
  archetypeOf,
  calibratedAxes,
  percentileAxes,
  percentilePool,
  MIN_SESSIONS,
  PERCENTILE_MIN_POPULATION,
} from "../lib/insights.js";
import { deriveAggregate } from "../lib/deep.js";
import { CARD_KEYS } from "../lib/insight-cards.js";
import { computeCraftForUser, loadDeepSessions, loadUsageSignal } from "../lib/craft-score-service.js";
import {
  checkOutcomeImplausibility,
  checkTimingRegularity,
  type FlagSignal,
} from "../lib/plausibility.js";
import { flagUser } from "../services/ingest.js";
import type { LeaderboardStore } from "../lib/leaderboard-store.js";
import { craftEntryFor } from "../lib/leaderboard-store.js";
import { captureEvent } from "./telemetry.js";

const count = z.number().int().nonnegative().max(10_000_000);
const rate = z.number().nonnegative().max(10_000);

const payloadSchema = z.object({
  windowDays: z.number().int().min(1).max(60),
  sessions: count,
  promptWordHistogram: z.object({ "1-5": count, "6-10": count, "11-25": count, "26+": count }),
  planModeSessionsPct: z.number().min(0).max(100),
  exploreBeforeEditRatio: z.number().min(0).max(1),
  avgTurnsBetweenUserMsgs: rate,
  interruptsPer100Turns: rate,
  subagentSpawnsPerSession: rate,
  maxParallelAgents: z.number().int().min(0).max(1000),
  hourHistogram: z.array(count).length(24),
  editToolCallsPerSession: rate,
  longestSessionMinutes: z.number().min(0).max(7 * 24 * 60),
});

const bodySchema = z.object({
  machineId: z.string().regex(/^[a-f0-9]{8,64}$/i),
  insights: payloadSchema,
});

// ── Deep payload validation (mirrors the CLI SessionRecord/InsightsDeepPayload).
const hashHex = z.string().regex(/^[a-f0-9]{0,64}$/i); // "" when not a repo/branch
const gitOutcomeSchema = z.object({
  repoIdHash: hashHex,
  branchHash: hashHex,
  commitsInWindow: count,
  linesAdded: count,
  linesDeleted: count,
  filesChanged: count,
  testFilesTouched: count,
  aiLinkedCommits: count,
  revertedLinesWithin14d: count,
  squashMergeDetected: z.boolean(),
  rebaseDetected: z.boolean(),
  isMonorepo: z.boolean(),
  hasRemote: z.boolean(),
  // Optional commit-timing histograms (old clients omit them).
  commitHours: z.array(count).length(24).optional(),
  commitDows: z.array(count).length(7).optional(),
  commitKinds: z.object({ fixes: count, features: count, refactors: count, other: count }).optional(),
});

const sessionRecordSchema = z.object({
  startHour: z.number().int().min(0).max(23),
  durationMinutes: z.number().min(0).max(7 * 24 * 60),
  prompts: count,
  interrupts: count,
  usedPlanMode: z.boolean(),
  exploreBeforeFirstEdit: z.boolean(),
  hadEdits: z.boolean(),
  subagentSpawns: count,
  maxParallel: z.number().int().min(0).max(1000),
  editCalls: count,
  assistantTurns: count,
  wordBuckets: z.object({ "1-5": count, "6-10": count, "11-25": count, "26+": count }),
  model: z.string().max(200).nullable(),
  timing: z.object({
    events: count,
    medianGapMs: count,
    p10GapMs: count,
    subSecondFraction: z.number().min(0).max(1),
  }),
  git: gitOutcomeSchema.nullable(),
  // New deep signals (optional — old clients omit).
  thankYous: count.optional(),
  wordTotal: count.optional(),
  recovery: z.object({ loops: count, medianBreakoutMs: count }).optional(),
  extensions: z.record(z.string().max(16), count).optional(),
});

const MAX_DEEP_SESSIONS = 2000;
// CLI targets 250 sessions / 500k chars; server adds headroom for older clients and burst.
const MAX_STORY_SESSIONS_SERVER = 300;
const deepBodySchema = z.object({
  machineId: z.string().regex(/^[a-f0-9]{8,64}$/i),
  windowDays: z.number().int().min(1).max(60),
  sessions: z.array(sessionRecordSchema).max(MAX_DEEP_SESSIONS),
  maxConcurrentSessions: z.number().int().min(0).max(10_000).optional(),
  // The only TEXT field — redacted client-side, accepted only under consent v2.
  topPrompt: z
    .object({ text: z.string().min(1).max(80), count: count, sessions: count })
    .nullable()
    .optional(),
});

export interface InsightsDeps {
  db: DB;
  insightsStore: InsightsStore;
  // Leaderboard store so a deep-ingest flag shadow-quarantines off the ranked
  // boards too (optional — the DB flaggedAt is the authority either way).
  store?: LeaderboardStore;
  sessionSecret?: string; // GitHub client secret — same signer the session uses
  // Story generation (#50). Absent (no ANTHROPIC_API_KEY) → transcripts are
  // stored dormant; generation picks up when the key ships.
  storyGenerate?: StoryGenerate;
}

async function userFromBearer(db: DB, c: Context): Promise<User | null> {
  const auth = c.req.header("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const [user] = await db.select().from(users).where(eq(users.cliTokenHash, hashToken(token)));
  return user ?? null;
}

/** Recompute and persist the archetype after any insights change. Derives
    from session #1 — MIN_SESSIONS only decides percentile-pool membership. */
async function refreshArchetype(db: DB, store: InsightsStore, userId: string): Promise<string | null> {
  const merged = store.merged(userId);
  let archetype: string | null = null;
  if (merged && merged.sessions > 0) {
    const pop = percentilePool(store.population());
    const scores =
      pop.length >= PERCENTILE_MIN_POPULATION && merged.sessions >= MIN_SESSIONS
        ? percentileAxes(merged, pop)
        : calibratedAxes(merged);
    archetype = archetypeOf(scores);
  }
  await db.update(users).set({ archetype }).where(eq(users.id, userId));
  return archetype;
}

export function insightsRoute(deps: InsightsDeps) {
  const app = new Hono();

  /** Bearer CLI token first (CLI calls), session cookie second (web calls). */
  async function resolveUser(c: Context): Promise<User | null> {
    const viaBearer = await userFromBearer(deps.db, c);
    if (viaBearer) return viaBearer;
    if (!deps.sessionSecret) return null;
    const cookie = getCookie(c, "ccw_session");
    const session = cookie ? readSessionToken(cookie, deps.sessionSecret) : null;
    if (!session) return null;
    const [user] = await deps.db.select().from(users).where(eq(users.githubId, session.githubId));
    return user ?? null;
  }

  // CLI pushes its locally-extracted aggregate. Consent flag is the gate —
  // a stale client that kept extracting after a revoke gets a 403, not stored.
  app.post("/", zValidator("json", bodySchema), async (c) => {
    const user = await userFromBearer(deps.db, c);
    if (!user) return c.json({ error: "unauthorized" }, 401);
    if (!user.insightsConsent) return c.json({ error: "consent_off" }, 403);

    const { machineId, insights } = c.req.valid("json");
    const mid = machineId.toLowerCase();
    await deps.db
      .insert(userInsights)
      .values({ userId: user.id, machineId: mid, payload: insights as InsightsPayload, windowDays: insights.windowDays, capturedAt: new Date() })
      .onConflictDoUpdate({
        target: [userInsights.userId, userInsights.machineId],
        set: { payload: insights as InsightsPayload, windowDays: insights.windowDays, capturedAt: new Date() },
      });
    deps.insightsStore.upsert(user.id, mid, insights as InsightsPayload);
    const archetype = await refreshArchetype(deps.db, deps.insightsStore, user.id);
    captureEvent("insights_received", user.githubLogin, { sessions: insights.sessions });
    return c.json({ ok: true, archetype });
  });

  app.get("/consent", async (c) => {
    const user = await resolveUser(c);
    if (!user) return c.json({ error: "unauthorized" }, 401);
    return c.json({ consent: user.insightsConsent, visibility: user.insightsVisibility });
  });

  app.post(
    "/consent",
    zValidator(
      "json",
      z.object({
        consent: z.boolean().optional(),
        visibility: z.enum(["public", "private"]).optional(),
        // Deep-disclosure version the CLI user acknowledged (v2 = text extracts
        // + transcripts). Gates topPrompt/transcript acceptance server-side.
        consentVersion: z.number().int().min(1).max(100).optional(),
      }),
    ),
    async (c) => {
      const user = await resolveUser(c);
      if (!user) return c.json({ error: "unauthorized" }, 401);
      const { consent, visibility, consentVersion } = c.req.valid("json");
      const set: Partial<typeof users.$inferInsert> = {};
      if (visibility !== undefined) set.insightsVisibility = visibility;
      if (consentVersion !== undefined) set.consentVersion = consentVersion;
      // Keep the boolean and the binary mode consistent: consent=true → 'deep',
      // consent=false → 'off' (mode !== 'off' is the source of truth).
      if (consent !== undefined) {
        set.insightsConsent = consent;
        set.insightsMode = consent ? "deep" : "off";
      }
      if (Object.keys(set).length === 0) return c.json({ error: "nothing_to_set" }, 400);
      await deps.db.update(users).set(set).where(eq(users.id, user.id));
      if (consent === false) {
        // Revoke deletes the data, not just the flag (spec §6). Order matters:
        // DB rows first, store last — Map.delete can't fail, and a crash between
        // the two self-heals at next boot (warm-up reads only surviving DB rows).
        await deps.db.delete(userInsights).where(eq(userInsights.userId, user.id));
        await deps.db.delete(userDeepSessions).where(eq(userDeepSessions.userId, user.id));
        await deps.db.delete(storySources).where(eq(storySources.userId, user.id));
        await deps.db.delete(userStories).where(eq(userStories.userId, user.id));
        await deps.db.update(users).set({ archetype: null, craftScore: null, trustTier: null }).where(eq(users.id, user.id));
        deps.insightsStore.remove(user.id);
        // Strip craft from the leaderboard: consent revoked → no craft visible.
        deps.store?.setCraft(user.id, undefined);
      } else if (visibility !== undefined && deps.store) {
        // Visibility change: strip or restore craft based on the new value.
        const newVisibility = visibility;
        if (newVisibility === "private") {
          deps.store.setCraft(user.id, undefined);
        } else {
          // Toggled back to public: restore craft from the current DB score.
          const currentScore = user.craftScore; // may be null if no deep data yet
          deps.store.setCraft(
            user.id,
            craftEntryFor({ insightsConsent: consent ?? user.insightsConsent, insightsVisibility: newVisibility, craftScore: currentScore }),
          );
        }
      }
      captureEvent("insights_consent", user.githubLogin, { consent: String(consent), visibility: visibility ?? "" });
      // Echo: request values ARE the written values (no server-side normalization),
      // so falling back to the pre-update row is accurate for fields not in this request.
      return c.json({ ok: true, consent: consent ?? user.insightsConsent, visibility: visibility ?? user.insightsVisibility });
    },
  );

  // Story transcripts (consent v2 only): redacted prompts + tool-call names.
  // Stored transiently in story_sources; PURGED after a story is generated.
  const transcriptSessionSchema = z.object({
    startedDay: z.string().max(10).nullable(),
    durationMinutes: z.number().min(0).max(7 * 24 * 60),
    model: z.string().max(200).nullable(),
    interrupts: count,
    prompts: z.array(z.string().max(2000)).max(60),
    toolCounts: z.record(z.string().max(64), count),
  });
  app.post(
    "/transcripts",
    zValidator(
      "json",
      z.object({
        machineId: z.string().regex(/^[a-f0-9]{8,64}$/i),
        windowDays: z.number().int().min(1).max(60),
        sessions: z.array(transcriptSessionSchema).min(1).max(MAX_STORY_SESSIONS_SERVER),
      }),
    ),
    async (c) => {
      const user = await userFromBearer(deps.db, c);
      if (!user) return c.json({ error: "unauthorized" }, 401);
      if (user.insightsMode !== "deep") {
        captureEvent("transcripts_rejected", user.githubLogin, { reason: "mode_off" });
        return c.json({ error: "mode_off" }, 403);
      }
      // Text only ever crosses with the v2 acknowledgment — no exceptions.
      if ((user.consentVersion ?? 1) < 2) {
        captureEvent("transcripts_rejected", user.githubLogin, { reason: "consent_v2_required" });
        return c.json({ error: "consent_v2_required" }, 403);
      }

      const { windowDays, sessions } = c.req.valid("json");

      // Total-size guard: a handful of maximally-dense sessions (7 × ~120k
      // chars) already exceeds this — the count cap alone doesn't bound bytes.
      // 800k chars ≈ 1.3× the 600k server input cap — reject early rather than
      // silently truncating. Old CLIs send ≤30 sessions, well under this limit.
      if (JSON.stringify(sessions).length > 800_000) {
        captureEvent("transcripts_rejected", user.githubLogin, { reason: "payload_too_large" });
        return c.json({ error: "payload_too_large" }, 400);
      }

      const payload = { windowDays, sessions };
      await deps.db
        .insert(storySources)
        .values({ userId: user.id, payload, capturedAt: new Date() })
        .onConflictDoUpdate({ target: storySources.userId, set: { payload, capturedAt: new Date() } });

      if (deps.storyGenerate) {
        // Fire-and-forget: the upload never waits on (or fails with) the LLM.
        void maybeGenerateStory({ db: deps.db, generate: deps.storyGenerate }, user).catch(() => {});
      }
      captureEvent("story_transcripts_received", user.githubLogin, { sessions: sessions.length });
      return c.json({ ok: true });
    },
  );

  // Owner-curated pins: up to 4 card keys lead the profile deck.
  app.post(
    "/pins",
    zValidator("json", z.object({ pins: z.array(z.string().max(40)).max(4) })),
    async (c) => {
      const user = await resolveUser(c);
      if (!user) return c.json({ error: "unauthorized" }, 401);
      const { pins } = c.req.valid("json");
      if (pins.some((k) => !CARD_KEYS.has(k))) return c.json({ error: "unknown_card_key" }, 400);
      await deps.db.update(users).set({ pinnedCards: pins }).where(eq(users.id, user.id));
      return c.json({ ok: true, pins });
    },
  );

  // Deep-mode upload: per-session records + hashed git outcomes. The server
  // stores the raw records AND derives the aggregate (so #47 archetype/efficiency
  // keep working from one upload — server derives the rest).
  app.post("/deep", zValidator("json", deepBodySchema), async (c) => {
    const user = await userFromBearer(deps.db, c);
    if (!user) return c.json({ error: "unauthorized" }, 401);
    if (user.insightsMode !== "deep") return c.json({ error: "mode_off" }, 403);

    const { machineId, windowDays, sessions, maxConcurrentSessions, topPrompt } = c.req.valid("json");
    const mid = machineId.toLowerCase();
    const deep: InsightsDeepPayload = { windowDays, sessions };

    // topPrompt is TEXT — only accepted from users who acknowledged the v2
    // disclosure. A stale/forged client sending it earlier is silently dropped.
    const textAllowed = (user.consentVersion ?? 1) >= 2;
    const extras = {
      ...(maxConcurrentSessions !== undefined ? { maxConcurrentSessions } : {}),
      ...(textAllowed && topPrompt !== undefined ? { topPrompt } : {}),
    };

    await deps.db
      .insert(userDeepSessions)
      .values({ userId: user.id, machineId: mid, sessions: deep.sessions, windowDays, capturedAt: new Date(), extras })
      .onConflictDoUpdate({
        target: [userDeepSessions.userId, userDeepSessions.machineId],
        set: { sessions: deep.sessions, windowDays, capturedAt: new Date(), extras },
      });

    // Derive the aggregate and persist it through the same path as a direct
    // /insights push, so the profile archetype/scoring are unchanged.
    const aggregate = deriveAggregate(deep.sessions, windowDays);
    await deps.db
      .insert(userInsights)
      .values({ userId: user.id, machineId: mid, payload: aggregate, windowDays, capturedAt: new Date() })
      .onConflictDoUpdate({
        target: [userInsights.userId, userInsights.machineId],
        set: { payload: aggregate, windowDays, capturedAt: new Date() },
      });
    deps.insightsStore.upsert(user.id, mid, aggregate);
    const archetype = await refreshArchetype(deps.db, deps.insightsStore, user.id);

    // Eagerly recompute the Craft Score so the profile read is instant and the
    // leaderboard can rank on the stored value. Reads back all machines' deep
    // rows (this upload is already committed) + usage_days.
    const craft = await computeCraftForUser(deps.db, user.id);
    const newCraftScore = craft ? String(craft.craftScore) : null;
    await deps.db
      .update(users)
      .set({
        craftScore: newCraftScore,
        trustTier: craft ? craft.trustTier : null,
      })
      .where(eq(users.id, user.id));
    // Update leaderboard store entry (user row visibility may have changed;
    // use the snapshot we have — insightsVisibility is not mutated by /deep).
    if (deps.store) {
      deps.store.setCraft(
        user.id,
        craftEntryFor({ insightsConsent: user.insightsConsent, insightsVisibility: user.insightsVisibility, craftScore: newCraftScore }),
      );
    }

    // ── Anti-gaming gates (Craft Score is a hiring credential). Run AFTER the
    // data is stored, NEVER reject: a violation shadow-quarantines (flaggedAt
    // set, user leaves ranked boards) but the sync still returns 200, so a
    // cheater probing for a 4xx can't triangulate the gate. Gates read every
    // machine's deep rows (this upload is committed) + the priced usage window.
    const allSessions = await loadDeepSessions(deps.db, user.id);
    const totalSurvivingLoc = allSessions.reduce(
      (s, r) => s + (r.git ? Math.max(0, r.git.linesAdded - r.git.revertedLinesWithin14d) : 0),
      0,
    );
    const totalShippedCommits = allSessions.reduce(
      (s, r) => s + (r.git ? r.git.commitsInWindow : 0),
      0,
    );
    const usage = await loadUsageSignal(deps.db, user.id, Date.now());
    const signals: FlagSignal[] = [];
    const outcome = checkOutcomeImplausibility(
      totalSurvivingLoc,
      totalShippedCommits,
      usage.windowTokens,
      usage.windowCostUsd,
    );
    if (outcome) signals.push(outcome);
    const timing = checkTimingRegularity(allSessions);
    if (timing) signals.push(timing);
    await flagUser(deps.db, deps.store ?? null, user, signals);

    captureEvent("deep_insights_received", user.githubLogin, { sessions: deep.sessions.length });
    return c.json({ ok: true, archetype, craftScore: craft?.craftScore ?? null });
  });

  app.get("/mode", async (c) => {
    const user = await resolveUser(c);
    if (!user) return c.json({ error: "unauthorized" }, 401);
    return c.json({ mode: user.insightsMode, visibility: user.insightsVisibility });
  });

  app.post(
    "/mode",
    zValidator("json", z.object({ mode: z.enum(["off", "deep"]) })),
    async (c) => {
      const user = await resolveUser(c);
      if (!user) return c.json({ error: "unauthorized" }, 401);
      const { mode } = c.req.valid("json");
      // mode is the source of truth; keep the legacy consent boolean consistent.
      await deps.db
        .update(users)
        .set({ insightsMode: mode, insightsConsent: mode === "deep" })
        .where(eq(users.id, user.id));
      if (mode === "off") {
        // Off purges all behavioral data (aggregate + deep), nulls the archetype,
        // and evicts from the in-memory store. DB first, store last (self-heals).
        await deps.db.delete(userInsights).where(eq(userInsights.userId, user.id));
        await deps.db.delete(userDeepSessions).where(eq(userDeepSessions.userId, user.id));
        await deps.db.update(users).set({ archetype: null, craftScore: null, trustTier: null }).where(eq(users.id, user.id));
        deps.insightsStore.remove(user.id);
        // Mode off = consent false → strip craft from the leaderboard.
        deps.store?.setCraft(user.id, undefined);
      }
      captureEvent("insights_mode", user.githubLogin, { mode });
      return c.json({ ok: true, mode, visibility: user.insightsVisibility });
    },
  );

  return app;
}
