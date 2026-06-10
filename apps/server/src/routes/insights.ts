import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import type { DB } from "../db/index.js";
import { users, userInsights, type InsightsPayload, type User } from "../db/schema.js";
import { hashToken } from "../lib/token.js";
import { readSessionToken } from "../lib/session.js";
import type { InsightsStore } from "../lib/insights-store.js";
import {
  archetypeOf,
  calibratedAxes,
  percentileAxes,
  MIN_SESSIONS,
  PERCENTILE_MIN_POPULATION,
} from "../lib/insights.js";
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

export interface InsightsDeps {
  db: DB;
  insightsStore: InsightsStore;
  sessionSecret?: string; // GitHub client secret — same signer the session uses
}

async function userFromBearer(db: DB, c: Context): Promise<User | null> {
  const auth = c.req.header("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const [user] = await db.select().from(users).where(eq(users.cliTokenHash, hashToken(token)));
  return user ?? null;
}

/** Recompute and persist the archetype after any insights change. */
async function refreshArchetype(db: DB, store: InsightsStore, userId: string): Promise<string | null> {
  const merged = store.merged(userId);
  let archetype: string | null = null;
  if (merged && merged.sessions >= MIN_SESSIONS) {
    const pop = store.population();
    const scores =
      pop.length >= PERCENTILE_MIN_POPULATION ? percentileAxes(merged, pop) : calibratedAxes(merged);
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
    zValidator("json", z.object({ consent: z.boolean().optional(), visibility: z.enum(["public", "private"]).optional() })),
    async (c) => {
      const user = await resolveUser(c);
      if (!user) return c.json({ error: "unauthorized" }, 401);
      const { consent, visibility } = c.req.valid("json");
      const set: Partial<typeof users.$inferInsert> = {};
      if (visibility !== undefined) set.insightsVisibility = visibility;
      if (consent !== undefined) set.insightsConsent = consent;
      if (Object.keys(set).length === 0) return c.json({ error: "nothing_to_set" }, 400);
      await deps.db.update(users).set(set).where(eq(users.id, user.id));
      if (consent === false) {
        // Revoke deletes the data, not just the flag (spec §6). Order matters:
        // DB rows first, store last — Map.delete can't fail, and a crash between
        // the two self-heals at next boot (warm-up reads only surviving DB rows).
        await deps.db.delete(userInsights).where(eq(userInsights.userId, user.id));
        await deps.db.update(users).set({ archetype: null }).where(eq(users.id, user.id));
        deps.insightsStore.remove(user.id);
      }
      captureEvent("insights_consent", user.githubLogin, { consent: String(consent), visibility: visibility ?? "" });
      // Echo: request values ARE the written values (no server-side normalization),
      // so falling back to the pre-update row is accurate for fields not in this request.
      return c.json({ ok: true, consent: consent ?? user.insightsConsent, visibility: visibility ?? user.insightsVisibility });
    },
  );

  return app;
}
