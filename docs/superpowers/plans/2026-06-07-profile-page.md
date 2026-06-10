# Warrior Profile Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Public profile page at `ccwarriors.xyz/u/<login>` with archetype + 5-axis scores (consent-gated CLI extraction from `~/.claude/projects` JSONL), efficiency scorecard, habit stats, and rhythm heatmap — shipped big-bang via CLI self-update.

**Architecture:** CLI deterministically counts events in local Claude Code session JSONL (no transcripts uploaded) and POSTs an aggregate `insights` payload to a new `/insights` endpoint when the server-side consent flag is on. Server stores per-machine payloads in `user_insights`, merges + scores them in an in-memory `InsightsStore` (LeaderboardStore pattern), and serves everything through `GET /profile/:login`. Web adds a router-less `/u/:login` path rendering the Dossier layout in the Paper Dossier treatment.

**Tech Stack:** Hono + Drizzle + PGlite/Postgres (server), zero-dep Node bundle via tsup (CLI), Vite + React + vanilla CSS (web), html-to-image (share card). Spec: `docs/superpowers/specs/2026-06-07-profile-page-design.md`.

**Conventions for this plan:**
- Repo root: `/Users/manu/.superset/worktrees/claude-warriors/profile-page`. All commands run from repo root unless noted.
- Server has a vitest suite (`apps/server/tests/`) — it MUST stay green. New pure server logic (scoring, extraction normalizer) gets unit tests; routes/UI are verified by running dev servers (project rule: UI verified by screenshots, not tests).
- Dev servers: `pnpm dev` runs server (`:8787`, PGlite + SEED_DEMO) and web (`:5173`) together.
- UI copy: no literal emojis, no em-dashes, one-liners (design language).

---

## Verified facts the code below relies on

Claude Code session files: `~/.claude/projects/<project-dir>/<sessionId>.jsonl`, one JSON object per line. Verified on real local data (2026-06-07):

- User prompts: `type === "user"`, `isSidechain !== true`, `isMeta !== true`, and `message.content` is a string OR an array containing `{type:"text"}` blocks (arrays containing `{type:"tool_result"}` are tool results, not prompts).
- Interrupts: prompt text contains `"[Request interrupted"`.
- Plan mode: user entries carry `permissionMode: "plan"` while plan mode is active.
- Tool calls: assistant entries (`type === "assistant"`, not sidechain) have `message.content` arrays with `{type:"tool_use", name:"Read"|"Bash"|"Edit"|"Task"|"Agent"|...}` blocks. Subagent spawns are `name === "Task" || name === "Agent"`; parallel agents = max such blocks in ONE assistant message.
- Timestamps: ISO strings in `timestamp` on user/assistant entries. `new Date(ts).getHours()` gives machine-local hour.
- One file = one session; the filename is the sessionId.

---

### Task 1: DB schema — `user_insights` table + users columns

**Files:**
- Modify: `apps/server/src/db/schema.ts`
- Generated: `apps/server/drizzle/0005_*.sql` (via drizzle-kit)

- [ ] **Step 1: Add columns and table to schema**

In `apps/server/src/db/schema.ts`, inside the `users` table object, after `installSource: text("install_source"),` add:

```ts
  // Warrior profile insights (behavioral extraction). Consent is the source of
  // truth: the CLI only extracts while this is true, and /insights rejects
  // payloads when it is false (stale clients can't push post-revoke).
  insightsConsent: boolean("insights_consent").notNull().default(false),
  insightsVisibility: text("insights_visibility").notNull().default("public"), // public | private
  archetype: text("archetype"),
```

After the `orgMembers` table definition, add:

```ts
// Per-machine behavioral insights payload (aggregate counts only — no
// transcript text ever reaches the server). Mirrors usage_days conventions:
// one row per (user, machine), updated in place each send.
export const userInsights = pgTable(
  "user_insights",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    machineId: text("machine_id").notNull(),
    payload: jsonb("payload").$type<InsightsPayload>().notNull(),
    windowDays: bigint("window_days", { mode: "number" }).notNull().default(40),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("user_insights_user_machine").on(t.userId, t.machineId)],
);
```

Near the top, after the `ModelTokens` type, add the payload type (shared shape with the CLI — duplicated by design, same as `ModelTokens` is today):

```ts
// Aggregate behavioral counts extracted locally by the CLI from session JSONL.
// Raw counts and histograms only — prompt text, paths, code never leave the machine.
export type InsightsPayload = {
  windowDays: number;
  sessions: number;
  promptWordHistogram: { "1-5": number; "6-10": number; "11-25": number; "26+": number };
  planModeSessionsPct: number; // % of sessions that used plan mode
  exploreBeforeEditRatio: number; // sessions with explore call before first edit / sessions with edits
  avgTurnsBetweenUserMsgs: number;
  interruptsPer100Turns: number;
  subagentSpawnsPerSession: number;
  maxParallelAgents: number;
  hourHistogram: number[]; // 24 buckets, session-start counts, machine-local
  editToolCallsPerSession: number;
  longestSessionMinutes: number;
};
```

At the bottom, add the export:

```ts
export type UserInsights = typeof userInsights.$inferSelect;
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm --filter server db:generate`
Expected: a new `apps/server/drizzle/0005_<name>.sql` appears containing `CREATE TABLE "user_insights"` and `ALTER TABLE "users" ADD COLUMN "insights_consent"` (plus the other two columns).

- [ ] **Step 3: Verify the suite still passes (tests migrate PGlite from ./drizzle)**

Run: `pnpm --filter server test`
Expected: all existing tests PASS (migrations apply cleanly).

Run: `pnpm --filter server typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/db/schema.ts apps/server/drizzle
git commit -m "feat(server): user_insights table + consent/visibility/archetype columns"
```

---

### Task 2: Scoring library — axes, archetypes, traits, growth edge

**Files:**
- Create: `apps/server/src/lib/insights.ts`
- Test: `apps/server/tests/insights.test.ts`

Pure functions only — no DB, no Hono. This is the paxel-extension brain; it gets real unit tests.

- [ ] **Step 1: Write failing tests**

Create `apps/server/tests/insights.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  mergeInsights,
  calibratedAxes,
  percentileAxes,
  archetypeOf,
  traitOf,
  growthEdgeOf,
  habitStats,
  MIN_SESSIONS,
  PERCENTILE_MIN_POPULATION,
  AXES,
  type MergedInsights,
} from "../src/lib/insights.js";
import type { InsightsPayload } from "../src/db/schema.js";

function payload(over: Partial<InsightsPayload> = {}): InsightsPayload {
  return {
    windowDays: 40,
    sessions: 50,
    promptWordHistogram: { "1-5": 100, "6-10": 60, "11-25": 30, "26+": 10 },
    planModeSessionsPct: 20,
    exploreBeforeEditRatio: 0.5,
    avgTurnsBetweenUserMsgs: 8,
    interruptsPer100Turns: 5,
    subagentSpawnsPerSession: 1.0,
    maxParallelAgents: 3,
    hourHistogram: Array(24).fill(0).map((_, h) => (h >= 9 && h <= 18 ? 5 : 0)),
    editToolCallsPerSession: 15,
    longestSessionMinutes: 90,
    ...over,
  };
}

describe("mergeInsights", () => {
  it("weights rates by sessions, sums histograms, maxes parallel", () => {
    const a = payload({ sessions: 10, planModeSessionsPct: 0, maxParallelAgents: 2 });
    const b = payload({ sessions: 30, planModeSessionsPct: 40, maxParallelAgents: 6 });
    const m = mergeInsights([a, b]);
    expect(m.sessions).toBe(40);
    expect(m.planModeSessionsPct).toBeCloseTo(30); // (0*10 + 40*30) / 40
    expect(m.maxParallelAgents).toBe(6);
    expect(m.promptWordHistogram["1-5"]).toBe(200);
  });
});

describe("calibratedAxes", () => {
  it("returns 0-100 for all five axes", () => {
    const axes = calibratedAxes(mergeInsights([payload()]));
    expect(Object.keys(axes).sort()).toEqual([...AXES].sort());
    for (const v of Object.values(axes)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });
  it("heavy summoner scores summoning highest", () => {
    const axes = calibratedAxes(
      mergeInsights([payload({ subagentSpawnsPerSession: 4, maxParallelAgents: 8, planModeSessionsPct: 5 })]),
    );
    const top = Object.entries(axes).sort((x, y) => y[1] - x[1])[0]![0];
    expect(top).toBe("summoning");
  });
});

describe("percentileAxes", () => {
  it("ranks within the population", () => {
    const pop: MergedInsights[] = [
      mergeInsights([payload({ planModeSessionsPct: 5 })]),
      mergeInsights([payload({ planModeSessionsPct: 20 })]),
      mergeInsights([payload({ planModeSessionsPct: 60 })]),
    ];
    const scores = percentileAxes(pop[2]!, pop);
    expect(scores.planning).toBeGreaterThan(percentileAxes(pop[0]!, pop).planning);
  });
});

describe("archetypeOf", () => {
  it("maps dominant axis to class", () => {
    expect(archetypeOf({ planning: 90, autonomy: 10, steering: 10, summoning: 10, velocity: 10 })).toBe(
      "The Tactician",
    );
    expect(archetypeOf({ planning: 10, autonomy: 10, steering: 10, summoning: 95, velocity: 50 })).toBe(
      "The Summoner",
    );
  });
});

describe("traitOf", () => {
  it("detects night stalker from hour histogram", () => {
    const hours = Array(24).fill(0);
    hours[23] = 20;
    hours[0] = 20;
    hours[13] = 10;
    const m = mergeInsights([payload({ hourHistogram: hours })]);
    expect(traitOf(m, { weekendShare: 0.1, currentStreak: 2 })).toBe("Night Stalker");
  });
  it("falls back to daily grinder on long streaks", () => {
    const m = mergeInsights([payload()]); // daytime hours
    expect(traitOf(m, { weekendShare: 0.1, currentStreak: 20 })).toBe("Daily Grinder");
  });
});

describe("growthEdgeOf", () => {
  it("low planning + high interrupts suggests plan mode", () => {
    const m = mergeInsights([payload({ interruptsPer100Turns: 12 })]);
    const edge = growthEdgeOf({ planning: 20, autonomy: 50, steering: 50, summoning: 50, velocity: 50 }, m, null);
    expect(edge).toContain("plan mode");
  });
});

describe("habitStats", () => {
  it("computes short prompt percentage", () => {
    const h = habitStats(mergeInsights([payload()]));
    expect(h.shortPromptPct).toBe(80); // (100+60)/200
  });
});

describe("constants", () => {
  it("documents the gates", () => {
    expect(MIN_SESSIONS).toBe(10);
    expect(PERCENTILE_MIN_POPULATION).toBe(30);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter server test -- insights`
Expected: FAIL — `Cannot find module '../src/lib/insights.js'`.

- [ ] **Step 3: Implement `apps/server/src/lib/insights.ts`**

```ts
// Profile insights scoring: merged payloads → 0-100 axis scores → warrior
// class. All deterministic — the only LLM in this pipeline is the user's.
import type { InsightsPayload } from "../db/schema.js";

export const AXES = ["planning", "autonomy", "steering", "summoning", "velocity"] as const;
export type Axis = (typeof AXES)[number];
export type AxisScores = Record<Axis, number>;

// Below this many sessions in the window the archetype shows "forging" —
// tiny samples produce garbage classes.
export const MIN_SESSIONS = 10;
// Below this many consented warriors, scores use the fixed calibration
// constants; at/after it, percentiles take over automatically.
export const PERCENTILE_MIN_POPULATION = 30;

export type MergedInsights = InsightsPayload;

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Merge per-machine payloads: rates weighted by sessions, counts summed, maxes maxed. */
export function mergeInsights(payloads: InsightsPayload[]): MergedInsights {
  if (payloads.length === 1) return payloads[0]!;
  const sessions = payloads.reduce((s, p) => s + p.sessions, 0) || 1;
  const w = (f: (p: InsightsPayload) => number) =>
    round1(payloads.reduce((s, p) => s + f(p) * p.sessions, 0) / sessions);
  const hist = { "1-5": 0, "6-10": 0, "11-25": 0, "26+": 0 };
  const hours = Array(24).fill(0) as number[];
  for (const p of payloads) {
    for (const k of Object.keys(hist) as (keyof typeof hist)[]) hist[k] += p.promptWordHistogram[k] ?? 0;
    p.hourHistogram.forEach((v, i) => (hours[i] = (hours[i] ?? 0) + v));
  }
  return {
    windowDays: Math.max(...payloads.map((p) => p.windowDays)),
    sessions,
    promptWordHistogram: hist,
    planModeSessionsPct: w((p) => p.planModeSessionsPct),
    exploreBeforeEditRatio: w((p) => p.exploreBeforeEditRatio),
    avgTurnsBetweenUserMsgs: w((p) => p.avgTurnsBetweenUserMsgs),
    interruptsPer100Turns: w((p) => p.interruptsPer100Turns),
    subagentSpawnsPerSession: w((p) => p.subagentSpawnsPerSession),
    maxParallelAgents: Math.max(...payloads.map((p) => p.maxParallelAgents)),
    hourHistogram: hours,
    editToolCallsPerSession: w((p) => p.editToolCallsPerSession),
    longestSessionMinutes: Math.max(...payloads.map((p) => p.longestSessionMinutes)),
  };
}

/** Fixed-anchor scores for the cold-start population (< PERCENTILE_MIN_POPULATION).
    Anchors tuned on founder data; replaced by percentiles automatically as the
    consented population grows. */
export function calibratedAxes(m: MergedInsights): AxisScores {
  const shortPromptRatio = shortPromptShare(m);
  return {
    // think-before-strike: plan mode share + exploring before editing
    planning: clamp((m.planModeSessionsPct / 30) * 60 + m.exploreBeforeEditRatio * 40),
    // long unsupervised runs, few interrupts
    autonomy: clamp((m.avgTurnsBetweenUserMsgs / 25) * 70 + (1 - clamp(m.interruptsPer100Turns, 0, 20) / 20) * 30),
    // short rapid orders, frequent course corrections
    steering: clamp(shortPromptRatio * 60 + (clamp(m.interruptsPer100Turns, 0, 20) / 20) * 20 + clamp(promptsPerSessionProxy(m), 0, 20) * 1),
    // agent armies
    summoning: clamp((m.subagentSpawnsPerSession / 3) * 70 + Math.min(30, m.maxParallelAgents * 6)),
    // raw throughput
    velocity: clamp((sessionsPerDay(m) / 5) * 50 + (m.editToolCallsPerSession / 40) * 50),
  };
}

function shortPromptShare(m: MergedInsights): number {
  const h = m.promptWordHistogram;
  const total = h["1-5"] + h["6-10"] + h["11-25"] + h["26+"];
  return total === 0 ? 0 : (h["1-5"] + h["6-10"]) / total;
}

function sessionsPerDay(m: MergedInsights): number {
  return m.sessions / Math.max(1, m.windowDays);
}

// Prompts per session isn't shipped directly; the histogram total / sessions is it.
function promptsPerSessionProxy(m: MergedInsights): number {
  const h = m.promptWordHistogram;
  return (h["1-5"] + h["6-10"] + h["11-25"] + h["26+"]) / Math.max(1, m.sessions);
}

/** Percentile of this user's calibrated axis values within the population. */
export function percentileAxes(me: MergedInsights, population: MergedInsights[]): AxisScores {
  const mine = calibratedAxes(me);
  const all = population.map(calibratedAxes);
  const out = {} as AxisScores;
  for (const axis of AXES) {
    const below = all.filter((a) => a[axis] < mine[axis]).length;
    out[axis] = Math.round((below / Math.max(1, all.length - 1 || 1)) * 100);
  }
  return out;
}

const CLASS_BY_AXIS: Record<Axis, string> = {
  planning: "The Tactician",
  velocity: "The Berserker",
  summoning: "The Summoner",
  steering: "The Commander",
  autonomy: "The Falconer",
};

/** Purely dominant-axis (spec 2.3). Ties break by AXES order — deterministic. */
export function archetypeOf(scores: AxisScores): string {
  let best: Axis = AXES[0];
  for (const axis of AXES) if (scores[axis] > scores[best]) best = axis;
  return CLASS_BY_AXIS[best];
}

export interface TraitContext {
  weekendShare: number; // share of active usage_days falling on Sat/Sun
  currentStreak: number;
}

/** Rhythm flavor line (not a class). First match wins; null = no trait line. */
export function traitOf(m: MergedInsights, ctx: TraitContext): string | null {
  const total = m.hourHistogram.reduce((s, v) => s + v, 0);
  if (total > 0) {
    const night = [22, 23, 0, 1, 2, 3, 4].reduce((s, h) => s + (m.hourHistogram[h] ?? 0), 0);
    const dawn = [5, 6, 7, 8, 9].reduce((s, h) => s + (m.hourHistogram[h] ?? 0), 0);
    if (night / total > 0.35) return "Night Stalker";
    if (dawn / total > 0.3) return "Dawn Raider";
  }
  if (ctx.weekendShare > 0.4) return "Weekend Warrior";
  if (ctx.currentStreak >= 14) return "Daily Grinder";
  return null;
}

export interface EfficiencyHint {
  opusShare: number; // 0..1 cost share on opus-family models in the 30d window
  estSavingsPerMonth: number;
}

/** One useful line, rule table, first match wins (spec 2.5). */
export function growthEdgeOf(scores: AxisScores, m: MergedInsights, eff: EfficiencyHint | null): string {
  if (scores.planning < 30 && m.interruptsPer100Turns > 8) {
    return "You correct mid-flight often. One pass of plan mode before big strikes would cut those interrupts.";
  }
  if (eff && eff.opusShare > 0.6 && eff.estSavingsPerMonth >= 5) {
    return `Heavy Opus mix. Right-sizing routine work to Sonnet saves about $${Math.round(eff.estSavingsPerMonth)}/mo.`;
  }
  if (scores.summoning < 20 && scores.velocity > 70) {
    return "High output, zero delegation. Subagents would parallelize your grind.";
  }
  if (scores.autonomy < 30) {
    return "Short leash on the agent. Longer unsupervised runs compound your throughput.";
  }
  return "Solid form. Keep syncing daily so your scores sharpen as the legion grows.";
}

export interface HabitStats {
  shortPromptPct: number; // % of prompts at 10 words or fewer
  planModeSessionsPct: number;
  maxParallelAgents: number;
  interruptsPer100Turns: number;
  longestSessionMinutes: number;
}

export function habitStats(m: MergedInsights): HabitStats {
  return {
    shortPromptPct: Math.round(shortPromptShare(m) * 100),
    planModeSessionsPct: Math.round(m.planModeSessionsPct),
    maxParallelAgents: m.maxParallelAgents,
    interruptsPer100Turns: round1(m.interruptsPer100Turns),
    longestSessionMinutes: Math.round(m.longestSessionMinutes),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter server test -- insights`
Expected: PASS (all describe blocks). If `steering`'s weights make the "heavy summoner" test flaky, the summoning anchors above dominate by construction — re-check the test inputs before touching weights.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/lib/insights.ts apps/server/tests/insights.test.ts
git commit -m "feat(server): insights scoring lib — axes, archetypes, traits, growth edge"
```

---

### Task 3: InsightsStore + `/insights` + consent endpoints + ingest flag

**Files:**
- Create: `apps/server/src/lib/insights-store.ts`
- Create: `apps/server/src/routes/insights.ts`
- Modify: `apps/server/src/services/ingest.ts` (result gains `insightsRequested`)
- Modify: `apps/server/src/lib/leaderboard-store.ts` (add `getByLogin`)
- Modify: `apps/server/src/app.ts`, `apps/server/src/index.ts` (wire deps + warm)

- [ ] **Step 1: Create `apps/server/src/lib/insights-store.ts`**

```ts
// In-memory view of user_insights (LeaderboardStore pattern): warmed at boot,
// updated on every /insights POST. Holds merged per-user payloads so percentile
// scoring never hits the DB on a profile read.
import { mergeInsights, type MergedInsights } from "./insights.js";
import type { InsightsPayload } from "../db/schema.js";

export class InsightsStore {
  // userId → machineId → payload
  private byUser = new Map<string, Map<string, InsightsPayload>>();

  upsert(userId: string, machineId: string, payload: InsightsPayload): void {
    const machines = this.byUser.get(userId) ?? new Map<string, InsightsPayload>();
    machines.set(machineId, payload);
    this.byUser.set(userId, machines);
  }

  remove(userId: string): void {
    this.byUser.delete(userId);
  }

  merged(userId: string): MergedInsights | null {
    const machines = this.byUser.get(userId);
    if (!machines || machines.size === 0) return null;
    return mergeInsights([...machines.values()]);
  }

  machineCount(userId: string): number {
    return this.byUser.get(userId)?.size ?? 0;
  }

  /** Merged payloads for every consented user — the percentile population. */
  population(): MergedInsights[] {
    return [...this.byUser.keys()]
      .map((id) => this.merged(id))
      .filter((m): m is MergedInsights => m !== null);
  }

  size(): number {
    return this.byUser.size;
  }
}
```

- [ ] **Step 2: Add `getByLogin` to `apps/server/src/lib/leaderboard-store.ts`**

After the `get(id: string)` method:

```ts
  /** Case-insensitive login lookup (profile URLs arrive in user-typed case). */
  getByLogin(login: string): Entry | undefined {
    const lower = login.toLowerCase();
    for (const e of this.entries.values()) {
      if (e.githubLogin.toLowerCase() === lower) return e;
    }
    return undefined;
  }
```

- [ ] **Step 3: Extend the ingest result with `insightsRequested`**

In `apps/server/src/services/ingest.ts`:

Change the `IngestResult` success shape (line ~52) to:

```ts
export type IngestResult =
  | { ok: true; tier: string; rank30d: number | null; rankAllTime: number | null; insightsRequested: boolean }
  | { ok: false; error: "unauthorized" | "implausible" | "rate_limited" };
```

In `finalize()`, change the return statement to:

```ts
  return {
    ok: true,
    tier,
    rank30d: store.getRank("30d", user.id),
    rankAllTime: store.getRank("allTime", user.id),
    // Tells the CLI to run (or keep running) local insights extraction.
    insightsRequested: user.insightsConsent === true,
  };
```

- [ ] **Step 4: Create `apps/server/src/routes/insights.ts`**

```ts
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq } from "drizzle-orm";
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

async function userFromBearer(db: DB, c: { req: { header: (n: string) => string | undefined } }): Promise<User | null> {
  const auth = c.req.header("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const [user] = await db.select().from(users).where(eq(users.cliTokenHash, hashToken(token)));
  return user ?? null;
}

/** Recompute and persist the archetype after any insights change. */
async function refreshArchetype(db: DB, store: InsightsStore, userId: string): Promise<void> {
  const merged = store.merged(userId);
  let archetype: string | null = null;
  if (merged && merged.sessions >= MIN_SESSIONS) {
    const pop = store.population();
    const scores =
      pop.length >= PERCENTILE_MIN_POPULATION ? percentileAxes(merged, pop) : calibratedAxes(merged);
    archetype = archetypeOf(scores);
  }
  await db.update(users).set({ archetype }).where(eq(users.id, userId));
}

export function insightsRoute(deps: InsightsDeps) {
  const app = new Hono();

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
    await refreshArchetype(deps.db, deps.insightsStore, user.id);
    captureEvent("insights_received", user.githubLogin, { sessions: insights.sessions });
    return c.json({ ok: true, archetype: (await deps.db.select({ a: users.archetype }).from(users).where(eq(users.id, user.id)))[0]?.a ?? null });
  });

  // Consent: readable/settable by the CLI (Bearer) and the web (session cookie).
  const resolveUser = async (c: Parameters<Parameters<typeof app.get>[1]>[0]): Promise<User | null> => {
    const viaBearer = await userFromBearer(deps.db, c);
    if (viaBearer) return viaBearer;
    if (!deps.sessionSecret) return null;
    const cookie = getCookie(c, "ccw_session");
    const session = cookie ? readSessionToken(cookie, deps.sessionSecret) : null;
    if (!session) return null;
    const [user] = await deps.db.select().from(users).where(eq(users.githubId, session.githubId));
    return user ?? null;
  };

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
        // Revoke deletes the data, not just the flag (spec §6).
        await deps.db.delete(userInsights).where(eq(userInsights.userId, user.id));
        await deps.db.update(users).set({ archetype: null }).where(eq(users.id, user.id));
        deps.insightsStore.remove(user.id);
      }
      captureEvent("insights_consent", user.githubLogin, { consent: String(consent), visibility: visibility ?? "" });
      return c.json({ ok: true, consent: consent ?? user.insightsConsent, visibility: visibility ?? user.insightsVisibility });
    },
  );

  return app;
}
```

- [ ] **Step 5: Wire into `app.ts` and warm the store in `index.ts`**

In `apps/server/src/app.ts`:
- Add imports: `import { insightsRoute } from "./routes/insights.js";` and `import type { InsightsStore } from "./lib/insights-store.js";`
- Add to `AppDeps`: `insightsStore?: InsightsStore;`
- Inside `if (deps) { ... }`, after the sponsors route:

```ts
    if (deps.insightsStore) {
      app.route(
        "/insights",
        insightsRoute({ db: deps.db, insightsStore: deps.insightsStore, sessionSecret: deps.auth?.clientSecret }),
      );
    }
```

In `apps/server/src/index.ts`:
- Import: `import { InsightsStore } from "./lib/insights-store.js";` and add `userInsights` to the schema import.
- After `const store = new LeaderboardStore();`:

```ts
  const insightsStore = new InsightsStore();
```

- Inside the warm-up `try` block, after the users loop:

```ts
    // Warm insights (consented users only — revokes deleted their rows).
    const insightRows = await db.select().from(userInsights);
    for (const r of insightRows) insightsStore.upsert(r.userId, r.machineId, r.payload);
```

- Pass `insightsStore` into `createApp({ ... })`.

- [ ] **Step 6: Fix the ingest tests for the new result field**

Run: `pnpm --filter server test`
Expected: `tests/ingest.test.ts` may fail on exact-shape assertions. If it asserts with `toEqual` on the success object, add `insightsRequested: false` to the expected objects. Make only that mechanical fix.

Run again: `pnpm --filter server test && pnpm --filter server typecheck`
Expected: PASS, clean.

- [ ] **Step 7: Smoke test the endpoints against the dev server**

Run: `SEED_CLI_TOKEN=devtoken pnpm --filter server dev` (background), then:

```bash
curl -s -X POST localhost:8787/insights/consent -H "Authorization: Bearer devtoken" -H "content-type: application/json" -d '{"consent":true}'
# expect {"ok":true,"consent":true,...}
curl -s -X POST localhost:8787/insights -H "Authorization: Bearer devtoken" -H "content-type: application/json" -d '{"machineId":"abcdef12","insights":{"windowDays":40,"sessions":50,"promptWordHistogram":{"1-5":100,"6-10":60,"11-25":30,"26+":10},"planModeSessionsPct":20,"exploreBeforeEditRatio":0.5,"avgTurnsBetweenUserMsgs":8,"interruptsPer100Turns":5,"subagentSpawnsPerSession":1,"maxParallelAgents":3,"hourHistogram":[0,0,0,0,0,0,0,0,0,5,5,5,5,5,5,5,5,5,5,0,0,0,0,0],"editToolCallsPerSession":15,"longestSessionMinutes":90}}'
# expect {"ok":true,"archetype":"The ..."}
curl -s -X POST localhost:8787/insights/consent -H "Authorization: Bearer devtoken" -H "content-type: application/json" -d '{"consent":false}'
# expect ok; then re-POST /insights → expect 403 {"error":"consent_off"}
```

- [ ] **Step 8: Commit**

```bash
git add apps/server/src
git commit -m "feat(server): /insights ingest + consent endpoints, InsightsStore, insightsRequested flag"
```

---

### Task 4: Efficiency lib + demo profile seed

**Files:**
- Create: `apps/server/src/lib/efficiency.ts`
- Modify: `apps/server/src/seed.ts` (demo users with DB rows so the page is verifiable in dev)
- Modify: `apps/server/src/index.ts` (call the new seeder)
- Test: `apps/server/tests/efficiency.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/server/tests/efficiency.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeEfficiency, computeRhythm } from "../src/lib/efficiency.js";

const day = (d: string, cost: number, opus = false, cacheRead = 0, input = 1000): {
  day: string; cost: number; modelBreakdown: { modelName: string; inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number }[] | null;
} => ({
  day: d,
  cost,
  modelBreakdown: [
    {
      modelName: opus ? "claude-opus-4-20250805" : "claude-sonnet-4-5",
      inputTokens: input,
      outputTokens: 200,
      cacheCreationTokens: 0,
      cacheReadTokens: cacheRead,
    },
  ],
});

describe("computeEfficiency", () => {
  it("grades a sonnet-heavy, cache-warm mix highly", () => {
    const rows = [day("2026-06-01", 10, false, 9000), day("2026-06-02", 10, false, 9000)];
    const e = computeEfficiency(rows, "2026-05-08");
    expect(e.opusShare).toBe(0);
    expect(e.cacheReadRatio).toBeGreaterThan(0.8);
    expect(e.grade).toBe("A+");
  });
  it("flags an opus-heavy mix with savings", () => {
    const rows = [day("2026-06-01", 100, true, 0)];
    const e = computeEfficiency(rows, "2026-05-08");
    expect(e.opusShare).toBe(1);
    expect(e.estSavingsPerMonth).toBeGreaterThan(0);
    expect(["C", "D"]).toContain(e.grade);
  });
});

describe("computeRhythm", () => {
  it("computes streaks over contiguous days", () => {
    const rows = [day("2026-06-05", 1), day("2026-06-06", 1), day("2026-06-07", 1), day("2026-06-01", 1)];
    const r = computeRhythm(rows, "2026-06-07");
    expect(r.currentStreak).toBe(3);
    expect(r.longestStreak).toBe(3);
    expect(r.days.length).toBe(4);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter server test -- efficiency`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `apps/server/src/lib/efficiency.ts`**

```ts
// Efficiency + rhythm derived from usage_days rows. Deterministic heuristics —
// thresholds documented inline; tune with real data like lib/tier.ts does.
import type { ModelTokens } from "../db/schema.js";

export interface UsageDayLike {
  day: string; // YYYY-MM-DD
  cost: number;
  modelBreakdown: ModelTokens[] | null;
}

export interface Efficiency {
  cacheReadRatio: number | null; // cacheRead / (input + cacheCreation + cacheRead)
  opusShare: number; // 0..1 cost-weighted share on opus-family models
  modelMix: Array<{ family: string; share: number }>; // cost share by family, desc
  grade: string | null; // A+ A B C D
  estSavingsPerMonth: number | null; // $ if overused opus moved to sonnet
  tokensPerActiveDay: number | null;
}

const FAMILY_RE: Array<[RegExp, string]> = [
  [/opus/i, "opus"],
  [/sonnet/i, "sonnet"],
  [/haiku/i, "haiku"],
  [/gpt|o[0-9]|codex/i, "openai"],
  [/gemini/i, "gemini"],
];

function familyOf(model: string): string {
  for (const [re, fam] of FAMILY_RE) if (re.test(model)) return fam;
  return "other";
}

// Sonnet input+output is roughly 1/5 of Opus pricing; moving the overused
// share saves ~80% of that slice. Coarse on purpose — it is a nudge, not a bill.
const OPUS_OK_SHARE = 0.35;
const SONNET_DISCOUNT = 0.8;

/** Rows must already be filtered to the user; cutoff30 = ISO day 30 days ago. */
export function computeEfficiency(rows: UsageDayLike[], cutoff30: string): Efficiency {
  const window = rows.filter((r) => r.day >= cutoff30);
  if (window.length === 0) {
    return { cacheReadRatio: null, opusShare: 0, modelMix: [], grade: null, estSavingsPerMonth: null, tokensPerActiveDay: null };
  }
  let input = 0, cacheCreate = 0, cacheRead = 0, output = 0;
  const costByFamily = new Map<string, number>();
  let totalCost = 0;
  for (const r of window) {
    totalCost += r.cost;
    const models = r.modelBreakdown ?? [];
    const dayTokens = models.reduce((s, m) => s + m.inputTokens + m.outputTokens + m.cacheCreationTokens + m.cacheReadTokens, 0) || 1;
    for (const m of models) {
      input += m.inputTokens;
      cacheCreate += m.cacheCreationTokens;
      cacheRead += m.cacheReadTokens;
      output += m.outputTokens;
      // Apportion the day's server-priced cost by token share per model.
      const share = (m.inputTokens + m.outputTokens + m.cacheCreationTokens + m.cacheReadTokens) / dayTokens;
      const fam = familyOf(m.modelName);
      costByFamily.set(fam, (costByFamily.get(fam) ?? 0) + r.cost * share);
    }
  }
  const denom = input + cacheCreate + cacheRead;
  const cacheReadRatio = denom > 0 ? cacheRead / denom : null;
  const opusCost = costByFamily.get("opus") ?? 0;
  const opusShare = totalCost > 0 ? opusCost / totalCost : 0;
  const overuse = Math.max(0, opusShare - OPUS_OK_SHARE);
  const estSavingsPerMonth = overuse > 0 ? Math.round(totalCost * overuse * SONNET_DISCOUNT) : 0;

  let grade: string;
  const cache = cacheReadRatio ?? 0;
  if (opusShare < 0.2 && cache > 0.75) grade = "A+";
  else if (opusShare < 0.35 && cache > 0.6) grade = "A";
  else if (opusShare < 0.55) grade = "B";
  else if (opusShare < 0.75) grade = "C";
  else grade = "D";

  const modelMix = [...costByFamily.entries()]
    .filter(([, c]) => c > 0)
    .map(([family, c]) => ({ family, share: Math.round((c / Math.max(0.01, totalCost)) * 100) / 100 }))
    .sort((a, b) => b.share - a.share);

  const tokensPerActiveDay = Math.round((input + output + cacheCreate + cacheRead) / window.length);
  return { cacheReadRatio, opusShare, modelMix, grade, estSavingsPerMonth, tokensPerActiveDay };
}

export interface Rhythm {
  days: Array<{ day: string; cost: number }>; // every active day, ascending
  currentStreak: number;
  longestStreak: number;
  weekendShare: number; // share of active days on Sat/Sun (feeds traitOf)
}

export function computeRhythm(rows: UsageDayLike[], today: string): Rhythm {
  // Multiple rows per day (machines/tools) collapse to one summed cell.
  const byDay = new Map<string, number>();
  for (const r of rows) byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.cost);
  const days = [...byDay.entries()]
    .map(([day, cost]) => ({ day, cost: Math.round(cost * 100) / 100 }))
    .sort((a, b) => a.day.localeCompare(b.day));

  const active = new Set(days.filter((d) => d.cost > 0).map((d) => d.day));
  const dayMs = 86_400_000;
  const toMs = (d: string) => new Date(`${d}T00:00:00Z`).getTime();

  let currentStreak = 0;
  for (let t = toMs(today); active.has(new Date(t).toISOString().slice(0, 10)); t -= dayMs) currentStreak++;

  let longestStreak = 0;
  let run = 0;
  let prev: number | null = null;
  for (const d of days) {
    if (d.cost <= 0) continue;
    const t = toMs(d.day);
    run = prev !== null && t - prev === dayMs ? run + 1 : 1;
    longestStreak = Math.max(longestStreak, run);
    prev = t;
  }

  let weekend = 0;
  for (const d of active) {
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (dow === 0 || dow === 6) weekend++;
  }
  return { days, currentStreak, longestStreak, weekendShare: active.size > 0 ? weekend / active.size : 0 };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter server test -- efficiency`
Expected: PASS.

- [ ] **Step 5: Demo profile seed**

In `apps/server/src/seed.ts`, add imports at top: `users, usageDays, userInsights, type InsightsPayload` from `./db/schema.js` and `hashToken` is NOT needed (use a literal hash-free token). Add at the end of the file:

```ts
// DB-backed demo profiles so /u/<login> is fully exercisable offline:
// three demo users get real usage_days history; two have insights (one
// public, one private); one has consent off (locked panel state).
export async function seedDemoProfiles(db: DB): Promise<void> {
  const { hashToken } = await import("./lib/token.js");
  const today = Date.now();
  const demo: Array<{ login: string; consent: boolean; visibility: "public" | "private"; spawns: number }> = [
    { login: "torvaldsjr", consent: true, visibility: "public", spawns: 3.2 },
    { login: "nightowl", consent: true, visibility: "private", spawns: 0.4 },
    { login: "vibecoder", consent: false, visibility: "public", spawns: 0 },
  ];
  for (const [i, d] of demo.entries()) {
    const [u] = await db
      .insert(users)
      .values({
        githubId: `demo-${d.login}`,
        githubLogin: d.login,
        avatarUrl: `https://i.pravatar.cc/120?img=${(i * 5 + 3) % 70}`,
        cliTokenHash: hashToken(`demo-${d.login}`),
        insightsConsent: d.consent,
        insightsVisibility: d.visibility,
        cost30d: "1000",
        costAllTime: "2600",
        tier: "Diamond",
      })
      .onConflictDoNothing()
      .returning();
    if (!u) continue; // already seeded on a previous boot
    // 40 days of deterministic usage: weekdays heavier, opus mixed in.
    const rows = [];
    for (let back = 0; back < 40; back++) {
      const date = new Date(today - back * 86_400_000);
      const day = date.toISOString().slice(0, 10);
      const dow = date.getUTCDay();
      if ((back * 7 + i) % 9 === 0) continue; // gaps so streak logic shows
      const heavy = dow !== 0 && dow !== 6;
      const cost = heavy ? 30 + ((back * 13) % 25) : 8;
      rows.push({
        userId: u.id,
        machineId: "deadbeef",
        tool: "claude",
        day,
        inputTokens: 200_000,
        outputTokens: 40_000,
        cacheCreationTokens: 50_000,
        cacheReadTokens: heavy ? 900_000 : 100_000,
        modelBreakdown: [
          { modelName: i === 1 ? "claude-opus-4-20250805" : "claude-sonnet-4-5", inputTokens: 200_000, outputTokens: 40_000, cacheCreationTokens: 50_000, cacheReadTokens: heavy ? 900_000 : 100_000 },
        ],
        cost: String(cost),
      });
    }
    if (rows.length > 0) await db.insert(usageDays).values(rows).onConflictDoNothing();
    if (d.consent) {
      const payload: InsightsPayload = {
        windowDays: 40,
        sessions: 80 + i * 20,
        promptWordHistogram: { "1-5": 300 + i * 50, "6-10": 200, "11-25": 80, "26+": 30 },
        planModeSessionsPct: i === 1 ? 45 : 12,
        exploreBeforeEditRatio: 0.55,
        avgTurnsBetweenUserMsgs: 9 + i * 4,
        interruptsPer100Turns: 6 - i * 2,
        subagentSpawnsPerSession: d.spawns,
        maxParallelAgents: d.spawns > 1 ? 6 : 1,
        hourHistogram: Array(24).fill(0).map((_, h) => (i === 1 ? (h >= 22 || h <= 3 ? 8 : 1) : h >= 9 && h <= 19 ? 6 : 0)),
        editToolCallsPerSession: 18,
        longestSessionMinutes: 240,
      };
      await db
        .insert(userInsights)
        .values({ userId: u.id, machineId: "deadbeef", payload, windowDays: 40 })
        .onConflictDoNothing();
    }
  }
}
```

Note: these demo logins intentionally collide with the in-store `seedDemo` roster — the store keeps serving board ranks under its string ids; the profile route resolves DB data by login independently (Task 5 is written for that).

In `apps/server/src/index.ts`, change the seed block to:

```ts
  if (cfg.seedDemo) {
    seedDemo(store);
    await seedDemoDonations(db);
    await seedDemoProfiles(db);
  }
```

(and add `seedDemoProfiles` to the import from `./seed.js`). IMPORTANT: warm the `insightsStore` AFTER this block so demo insights load into it (move/keep the warm-up below seeding — it already is, verify order).

- [ ] **Step 6: Verify boot + suite**

Run: `pnpm --filter server test && pnpm --filter server typecheck`
Expected: PASS.
Run dev server briefly: `pnpm --filter server dev` → expect boot log without errors. Ctrl+C.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src apps/server/tests/efficiency.test.ts
git commit -m "feat(server): efficiency/rhythm lib + DB-backed demo profiles"
```

---

### Task 5: Profile API — `GET /profile/:login`

**Files:**
- Create: `apps/server/src/routes/profile.ts`
- Modify: `apps/server/src/app.ts` (route + etag)

- [ ] **Step 1: Create `apps/server/src/routes/profile.ts`**

```ts
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
```

- [ ] **Step 2: Wire into `app.ts`**

Import `profileRoute`. Inside `if (deps) { ... }` add (note: NOT behind insightsStore — profile works without it? No: keep it simple, both are always constructed in index.ts; require insightsStore):

```ts
    if (deps.insightsStore) {
      app.route("/profile", profileRoute({ db: deps.db, store: deps.store, insightsStore: deps.insightsStore, sessionSecret: deps.auth?.clientSecret }));
    }
```

Do NOT add the shared `cacheEtag` middleware to `/profile/*` — owner responses are cookie-personalized (the route sets its own Cache-Control instead).

- [ ] **Step 3: Verify against dev server**

Run: `pnpm --filter server dev` (SEED_DEMO on by default), then:

```bash
curl -s localhost:8787/profile/torvaldsjr | python3 -m json.tool | head -40
# expect: identity + rank30d + rhythm.days (~35 entries) + efficiency.grade + insights.locked=false with archetype
curl -s localhost:8787/profile/vibecoder | python3 -m json.tool | grep -A2 insights
# expect: insights.locked=true reason no_consent
curl -s localhost:8787/profile/nightowl | python3 -m json.tool | grep -A2 insights
# expect: locked=true reason private (no owner cookie)
curl -s -o /dev/null -w "%{http_code}\n" localhost:8787/profile/no_such_warrior_xyz
# expect: 404
```

Run: `pnpm --filter server test && pnpm --filter server typecheck`
Expected: PASS, clean.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src
git commit -m "feat(server): GET /profile/:login — identity, rhythm, efficiency, gated insights"
```

---

### Task 6: CLI — local extractor (`insights.ts`)

**Files:**
- Create: `packages/cli/src/insights.ts`
- Test: `packages/cli/tests/insights.test.ts`

- [ ] **Step 1: Write failing tests for the session parser**

Create `packages/cli/tests/insights.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseSessionLines, aggregateSessions, type SessionStats } from "../src/insights.js";

const line = (o: object) => JSON.stringify(o);

describe("parseSessionLines", () => {
  it("counts prompts, plan mode, interrupts, tools", () => {
    const lines = [
      line({ type: "user", message: { content: "fix the bug in auth" }, timestamp: "2026-06-07T22:10:00.000Z" }),
      line({ type: "assistant", message: { content: [{ type: "tool_use", name: "Read" }, { type: "tool_use", name: "Grep" }] }, timestamp: "2026-06-07T22:10:05.000Z" }),
      line({ type: "user", message: { content: [{ type: "tool_result", content: "..." }] }, timestamp: "2026-06-07T22:10:06.000Z" }),
      line({ type: "assistant", message: { content: [{ type: "tool_use", name: "Edit" }] }, timestamp: "2026-06-07T22:11:00.000Z" }),
      line({ type: "user", message: { content: "[Request interrupted by user] no, the other file" }, permissionMode: "plan", timestamp: "2026-06-07T22:12:00.000Z" }),
      line({ type: "assistant", message: { content: [{ type: "tool_use", name: "Task" }, { type: "tool_use", name: "Task" }, { type: "tool_use", name: "Agent" }] }, timestamp: "2026-06-07T22:13:00.000Z" }),
      line({ type: "user", isSidechain: true, message: { content: "subagent prompt — not a user prompt" }, timestamp: "2026-06-07T22:13:30.000Z" }),
      line({ type: "user", isMeta: true, message: { content: "meta" }, timestamp: "2026-06-07T22:13:40.000Z" }),
    ];
    const s = parseSessionLines(lines)!;
    expect(s.prompts).toBe(2);
    expect(s.interrupts).toBe(1);
    expect(s.usedPlanMode).toBe(true);
    expect(s.exploreBeforeFirstEdit).toBe(true);
    expect(s.hadEdits).toBe(true);
    expect(s.subagentSpawns).toBe(3);
    expect(s.maxParallel).toBe(3);
    expect(s.editCalls).toBe(1);
    expect(s.assistantTurns).toBe(3);
    expect(s.startHour).toBe(new Date("2026-06-07T22:10:00.000Z").getHours());
    expect(s.wordBuckets["1-5"]).toBe(1); // "fix the bug in auth" → 5 words
  });

  it("returns null for empty/attachment-only files", () => {
    expect(parseSessionLines([line({ type: "file-history-snapshot" })])).toBeNull();
  });
});

describe("aggregateSessions", () => {
  it("builds the payload shape", () => {
    const s: SessionStats = {
      prompts: 10, interrupts: 1, usedPlanMode: true, exploreBeforeFirstEdit: true, hadEdits: true,
      subagentSpawns: 2, maxParallel: 2, editCalls: 12, assistantTurns: 40, startHour: 14,
      durationMinutes: 60, wordBuckets: { "1-5": 4, "6-10": 3, "11-25": 2, "26+": 1 },
    };
    const p = aggregateSessions([s, { ...s, usedPlanMode: false, startHour: 23 }], 40);
    expect(p.sessions).toBe(2);
    expect(p.planModeSessionsPct).toBe(50);
    expect(p.hourHistogram[14]).toBe(1);
    expect(p.hourHistogram[23]).toBe(1);
    expect(p.maxParallelAgents).toBe(2);
    expect(p.avgTurnsBetweenUserMsgs).toBe(4); // 80 turns / 20 prompts
    expect(p.interruptsPer100Turns).toBeCloseTo(2.5); // 2 / 80 * 100
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter claude-warriors test -- insights`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/cli/src/insights.ts`**

```ts
// Local behavioral extraction from Claude Code session JSONL. Deterministic
// event counting — no LLM, no transcript text retained or uploaded. Per-file
// results are cached (path+size+mtime) so repeat syncs only parse new lines'
// worth of files. See spec §3.3.
import { createReadStream, existsSync } from "node:fs";
import { readFile, writeFile, readdir, stat, mkdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { join } from "node:path";

export const WINDOW_DAYS = 40;
const EXPLORE_TOOLS = new Set(["Read", "Grep", "Glob"]);
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const SPAWN_TOOLS = new Set(["Task", "Agent"]);

export interface SessionStats {
  prompts: number;
  interrupts: number;
  usedPlanMode: boolean;
  exploreBeforeFirstEdit: boolean;
  hadEdits: boolean;
  subagentSpawns: number;
  maxParallel: number;
  editCalls: number;
  assistantTurns: number;
  startHour: number; // machine-local 0-23
  durationMinutes: number;
  wordBuckets: { "1-5": number; "6-10": number; "11-25": number; "26+": number };
}

export interface InsightsPayload {
  windowDays: number;
  sessions: number;
  promptWordHistogram: { "1-5": number; "6-10": number; "11-25": number; "26+": number };
  planModeSessionsPct: number;
  exploreBeforeEditRatio: number;
  avgTurnsBetweenUserMsgs: number;
  interruptsPer100Turns: number;
  subagentSpawnsPerSession: number;
  maxParallelAgents: number;
  hourHistogram: number[];
  editToolCallsPerSession: number;
  longestSessionMinutes: number;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

function promptText(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const blocks = content.filter((b): b is Record<string, unknown> => !!b && typeof b === "object");
    if (blocks.some((b) => b["type"] === "tool_result")) return null; // tool result, not a prompt
    const texts = blocks.filter((b) => b["type"] === "text").map((b) => String(b["text"] ?? ""));
    return texts.length > 0 ? texts.join(" ") : null;
  }
  return null;
}

/** Parse one session file's lines into counts. Null when no conversation found. */
export function parseSessionLines(lines: Iterable<string>): SessionStats | null {
  let prompts = 0, interrupts = 0, subagentSpawns = 0, maxParallel = 0, editCalls = 0, assistantTurns = 0;
  let usedPlanMode = false, hadEdits = false;
  let exploreBeforeFirstEdit = false, sawExplore = false, sawEdit = false;
  let firstTs: number | null = null, lastTs: number | null = null;
  const wordBuckets = { "1-5": 0, "6-10": 0, "11-25": 0, "26+": 0 };

  for (const line of lines) {
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const type = o["type"];
    if (type !== "user" && type !== "assistant") continue;
    if (o["isSidechain"] === true) continue;
    const ts = typeof o["timestamp"] === "string" ? new Date(o["timestamp"]).getTime() : NaN;
    if (Number.isFinite(ts)) {
      if (firstTs === null) firstTs = ts;
      lastTs = ts;
    }
    const message = o["message"] as Record<string, unknown> | undefined;

    if (type === "user") {
      if (o["isMeta"] === true) continue;
      if (o["permissionMode"] === "plan") usedPlanMode = true;
      const text = promptText(message?.["content"]);
      if (text === null) continue;
      prompts++;
      if (text.includes("[Request interrupted")) interrupts++;
      const words = text.trim().split(/\s+/).filter(Boolean).length;
      if (words <= 5) wordBuckets["1-5"]++;
      else if (words <= 10) wordBuckets["6-10"]++;
      else if (words <= 25) wordBuckets["11-25"]++;
      else wordBuckets["26+"]++;
      continue;
    }

    // assistant
    assistantTurns++;
    const content = message?.["content"];
    if (!Array.isArray(content)) continue;
    let parallel = 0;
    for (const b of content) {
      if (!b || typeof b !== "object" || (b as Record<string, unknown>)["type"] !== "tool_use") continue;
      const name = String((b as Record<string, unknown>)["name"] ?? "");
      if (SPAWN_TOOLS.has(name)) {
        subagentSpawns++;
        parallel++;
      }
      if (EXPLORE_TOOLS.has(name) && !sawEdit) sawExplore = true;
      if (EDIT_TOOLS.has(name)) {
        if (!sawEdit && sawExplore) exploreBeforeFirstEdit = true;
        sawEdit = true;
        hadEdits = true;
        editCalls++;
      }
    }
    maxParallel = Math.max(maxParallel, parallel);
  }

  if (prompts === 0 && assistantTurns === 0) return null;
  const startHour = firstTs !== null ? new Date(firstTs).getHours() : 12;
  const durationMinutes = firstTs !== null && lastTs !== null ? Math.max(0, (lastTs - firstTs) / 60_000) : 0;
  return {
    prompts, interrupts, usedPlanMode, exploreBeforeFirstEdit, hadEdits,
    subagentSpawns, maxParallel, editCalls, assistantTurns, startHour, durationMinutes, wordBuckets,
  };
}

export function aggregateSessions(sessions: SessionStats[], windowDays: number): InsightsPayload {
  const n = Math.max(1, sessions.length);
  const sum = (f: (s: SessionStats) => number) => sessions.reduce((a, s) => a + f(s), 0);
  const hist = { "1-5": 0, "6-10": 0, "11-25": 0, "26+": 0 };
  const hours = Array(24).fill(0) as number[];
  for (const s of sessions) {
    for (const k of Object.keys(hist) as (keyof typeof hist)[]) hist[k] += s.wordBuckets[k];
    hours[s.startHour] = (hours[s.startHour] ?? 0) + 1;
  }
  const totalPrompts = Math.max(1, sum((s) => s.prompts));
  const totalTurns = Math.max(1, sum((s) => s.assistantTurns));
  const withEdits = sessions.filter((s) => s.hadEdits);
  return {
    windowDays,
    sessions: sessions.length,
    promptWordHistogram: hist,
    planModeSessionsPct: r1((sessions.filter((s) => s.usedPlanMode).length / n) * 100),
    exploreBeforeEditRatio:
      withEdits.length === 0
        ? 0
        : Math.round((withEdits.filter((s) => s.exploreBeforeFirstEdit).length / withEdits.length) * 100) / 100,
    avgTurnsBetweenUserMsgs: r1(totalTurns / totalPrompts),
    interruptsPer100Turns: r1((sum((s) => s.interrupts) / totalTurns) * 100),
    subagentSpawnsPerSession: r1(sum((s) => s.subagentSpawns) / n),
    maxParallelAgents: Math.max(0, ...sessions.map((s) => s.maxParallel)),
    hourHistogram: hours,
    editToolCallsPerSession: r1(sum((s) => s.editCalls) / n),
    longestSessionMinutes: r1(Math.max(0, ...sessions.map((s) => s.durationMinutes))),
  };
}

// ── Filesystem walk + cache ─────────────────────────────────────────────────

interface CacheFile {
  files: Record<string, { size: number; mtimeMs: number; stats: SessionStats | null }>;
  lastSentAt?: string;
}

const HOME = process.env["CCWARRIORS_HOME"] ?? join(homedir(), ".claude-warriors");
const CACHE_PATH = join(HOME, "insights-cache.json");
const PROJECTS_DIR = process.env["CCWARRIORS_CLAUDE_DIR"] ?? join(homedir(), ".claude", "projects");

async function loadCache(): Promise<CacheFile> {
  try {
    return JSON.parse(await readFile(CACHE_PATH, "utf8")) as CacheFile;
  } catch {
    return { files: {} };
  }
}

async function saveCache(cache: CacheFile): Promise<void> {
  await mkdir(HOME, { recursive: true, mode: 0o700 });
  await writeFile(CACHE_PATH, JSON.stringify(cache), { encoding: "utf8", mode: 0o600 });
}

async function parseFile(path: string): Promise<SessionStats | null> {
  const lines: string[] = [];
  const rl = createInterface({ input: createReadStream(path, "utf8"), crlfDelay: Infinity });
  for await (const line of rl) lines.push(line);
  return parseSessionLines(lines);
}

/** Collect insights for sessions modified within the window. Cache makes
    repeat runs parse only new/changed files. */
export async function collectInsights(): Promise<InsightsPayload | null> {
  if (!existsSync(PROJECTS_DIR)) return null;
  const cutoff = Date.now() - WINDOW_DAYS * 86_400_000;
  const cache = await loadCache();
  const seen = new Set<string>();
  const sessions: SessionStats[] = [];

  const projectDirs = await readdir(PROJECTS_DIR, { withFileTypes: true });
  for (const dirent of projectDirs) {
    if (!dirent.isDirectory()) continue;
    const dir = join(PROJECTS_DIR, dirent.name);
    let files: string[];
    try {
      files = (await readdir(dir)).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const f of files) {
      const full = join(dir, f);
      let st;
      try {
        st = await stat(full);
      } catch {
        continue;
      }
      if (st.mtimeMs < cutoff) continue; // outside window
      seen.add(full);
      const cached = cache.files[full];
      let stats: SessionStats | null;
      if (cached && cached.size === st.size && cached.mtimeMs === st.mtimeMs) {
        stats = cached.stats;
      } else {
        try {
          stats = await parseFile(full);
        } catch {
          stats = null;
        }
        cache.files[full] = { size: st.size, mtimeMs: st.mtimeMs, stats };
      }
      if (stats) sessions.push(stats);
    }
  }

  // Drop cache entries for files gone or aged out (bound the cache size).
  for (const key of Object.keys(cache.files)) if (!seen.has(key)) delete cache.files[key];
  await saveCache(cache);

  if (sessions.length === 0) return null;
  return aggregateSessions(sessions, WINDOW_DAYS);
}

const SEND_INTERVAL_MS = 6 * 60 * 60 * 1000; // network throttle: at most every 6h

export async function shouldSend(now: number = Date.now()): Promise<boolean> {
  const cache = await loadCache();
  if (!cache.lastSentAt) return true;
  return now - new Date(cache.lastSentAt).getTime() > SEND_INTERVAL_MS;
}

export async function markSent(now: number = Date.now()): Promise<void> {
  const cache = await loadCache();
  cache.lastSentAt = new Date(now).toISOString();
  await saveCache(cache);
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter claude-warriors test -- insights`
Expected: PASS.

- [ ] **Step 5: Real-data smoke run**

```bash
cd packages/cli && npx tsx -e "import('./src/insights.ts').then(async m => console.log(JSON.stringify(await m.collectInsights(), null, 2)))" && cd ../..
```
Expected: a JSON payload printed from YOUR real `~/.claude/projects` — sanity-check the numbers (sessions count plausible, hourHistogram sums to sessions, no text fields anywhere).

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/insights.ts packages/cli/tests/insights.test.ts
git commit -m "feat(cli): local insights extraction from session JSONL with file cache"
```

---

### Task 7: CLI wiring — `insights` command, sync + daemon hooks

**Files:**
- Modify: `packages/cli/src/core.ts` (postInsights, consent calls, IngestResponse)
- Modify: `packages/cli/src/cli.ts` (subcommand + sync hook + help)
- Modify: `packages/cli/src/daemon.ts` (post-sync hook)

- [ ] **Step 1: Extend `packages/cli/src/core.ts`**

Add `insightsRequested` to the response type:

```ts
export interface IngestResponse {
  ok: boolean;
  tier?: string;
  rank30d?: number | null;
  rankAllTime?: number | null;
  insightsRequested?: boolean;
}
```

Append at the end of the file:

```ts
import type { InsightsPayload } from "./insights.js";

export async function postInsights(
  token: string,
  machineId: string,
  insights: InsightsPayload,
): Promise<{ status: number; ok: boolean }> {
  const res = await fetch(`${API_BASE}/insights`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ machineId, insights }),
    signal: AbortSignal.timeout(30_000),
  });
  return { status: res.status, ok: res.ok };
}

export async function setInsightsConsent(token: string, consent: boolean): Promise<{ status: number; ok: boolean }> {
  const res = await fetch(`${API_BASE}/insights/consent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ consent }),
    signal: AbortSignal.timeout(15_000),
  });
  return { status: res.status, ok: res.ok };
}

export async function getInsightsConsent(token: string): Promise<{ consent: boolean } | null> {
  try {
    const res = await fetch(`${API_BASE}/insights/consent`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as { consent: boolean };
  } catch {
    return null;
  }
}
```

(Move the `import type { InsightsPayload }` line up with the other imports — banner position shown here only for diff clarity.)

- [ ] **Step 2: Shared post-sync hook + subcommand in `packages/cli/src/cli.ts`**

Add imports: `collectInsights, shouldSend, markSent` from `./insights.js`; `postInsights, setInsightsConsent, getInsightsConsent` added to the `./core.js` import.

Add this helper above `cmdSync`:

```ts
/** After a good sync: when the server asks (consent on) and the 6h throttle
    allows, extract locally and push. Fire-and-forget — sync UX never blocks. */
async function maybePushInsights(token: string, machineId: string, requested: boolean | undefined, verbose: boolean): Promise<void> {
  if (!requested) return;
  try {
    if (!(await shouldSend())) return;
    const payload = await collectInsights();
    if (!payload) return;
    const res = await postInsights(token, machineId, payload);
    if (res.ok) {
      await markSent();
      if (verbose) console.log(dim("   insights synced — your archetype is forging at ccwarriors.xyz"));
    }
  } catch {
    // insights must never break a sync
  }
}
```

In `cmdSync`, right after `markUpdateSuccess();` (line ~133), add:

```ts
  await maybePushInsights(config.token, machineId, result.data.insightsRequested, true);
```

Add the subcommand function:

```ts
async function cmdInsights(args: string[]): Promise<void> {
  const sub = args[0];
  if (sub === "--dry-run" || sub === "dry-run") {
    console.log(dim("Extracting locally — nothing is sent. This is the exact payload a sync would upload:"));
    const payload = await collectInsights();
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  const config = await loadConfig();
  if (!config) {
    console.error(red("Not enlisted — run `ccwarriors login` first."));
    process.exit(1);
  }
  if (sub === "on") {
    const res = await setInsightsConsent(config.token, true);
    if (!res.ok) {
      console.error(red(`Could not enable insights (status ${res.status}).`));
      process.exit(1);
    }
    console.log(green("Insights on."));
    console.log(dim("Extracting from your local sessions now — aggregate counts only, transcripts never leave this machine."));
    const machineId = await ensureMachineId(config);
    const payload = await collectInsights();
    if (payload) {
      const sent = await postInsights(config.token, machineId, payload);
      if (sent.ok) {
        await markSent();
        console.log(green(`Done — see your archetype at ${WEB_BASE}/u/${encodeURIComponent(config.login)}`));
      } else {
        console.error(red(`Upload failed (status ${sent.status}) — it will retry on the next sync.`));
      }
    } else {
      console.log(yellow("No local Claude Code sessions found in the last 40 days — your profile unlocks after you code."));
    }
    return;
  }
  if (sub === "off") {
    const res = await setInsightsConsent(config.token, false);
    if (!res.ok) {
      console.error(red(`Could not disable insights (status ${res.status}).`));
      process.exit(1);
    }
    console.log(green("Insights off — server-side behavioral data deleted."));
    return;
  }
  const status = await getInsightsConsent(config.token);
  console.log(`insights: ${status ? (status.consent ? "on" : "off") : "unknown (network error)"}`);
}
```

Register it in `main()` before the final unknown-command fallthrough:

```ts
  if (cmd === "insights") {
    await cmdInsights(args.slice(1));
    return;
  }
```

Add to `printHelp()` USAGE block:

```
  ccwarriors insights on|off|status   Behavioral insights for your profile page (opt in)
  ccwarriors insights --dry-run       Print exactly what would be sent — nothing uploads
```

- [ ] **Step 3: Daemon hook in `packages/cli/src/daemon.ts`**

Add imports: `collectInsights, shouldSend, markSent` from `./insights.js`, `postInsights` added to the `./core.js` import. In `syncNow`, inside the `if (res.data?.ok)` branch after `markUpdateSuccess();`:

```ts
        if (res.data.insightsRequested) {
          void (async () => {
            try {
              if (!(await shouldSend())) return;
              const payload = await collectInsights();
              if (!payload) return;
              const sent = await postInsights(token, machineId, payload);
              if (sent.ok) {
                await markSent();
                log("insights synced");
              }
            } catch {
              /* never break the daemon */
            }
          })();
        }
```

- [ ] **Step 4: End-to-end CLI verification against the dev server**

```bash
pnpm --filter claude-warriors build   # tsup bundle must still build clean
pnpm --filter claude-warriors typecheck && pnpm --filter claude-warriors test
```
Expected: clean, PASS.

Then verify the no-auth path (dry-run needs no login or server):

```bash
node packages/cli/dist/cli.js insights --dry-run
# expect: full JSON payload from your real ~/.claude/projects — every field a
# number or histogram, zero text fields. This is THE privacy check.
```

The authenticated on/off path is verified in Task 12's full e2e (it needs a server-side user; `devtoken` exists only there).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src
git commit -m "feat(cli): insights command, consent flow, post-sync extraction push"
```

---

### Task 8: Web — `/u/:login` route, data hook, page shell

**Files:**
- Create: `apps/web/src/useProfile.ts`
- Create: `apps/web/src/components/Profile/ProfilePage.tsx`
- Modify: `apps/web/src/App.tsx`
- Create: `apps/web/vercel.json`

- [ ] **Step 1: Create `apps/web/src/useProfile.ts`**

```ts
import { useEffect, useState } from "react";
import { API_HTTP } from "./api";

export interface ProfileAxes {
  planning: number;
  autonomy: number;
  steering: number;
  summoning: number;
  velocity: number;
}

export interface ProfileInsights {
  locked: false;
  scoresArePercentiles: boolean;
  population: number;
  axes: ProfileAxes;
  archetype: string;
  trait: string | null;
  habits: {
    shortPromptPct: number;
    planModeSessionsPct: number;
    maxParallelAgents: number;
    interruptsPer100Turns: number;
    longestSessionMinutes: number;
  };
  growthEdge: string;
}

export interface LockedInsights {
  locked: true;
  reason: "no_consent" | "private" | "forging";
}

export interface Profile {
  login: string;
  avatarUrl: string;
  xHandle: string | null;
  tier: string;
  cardScene: string;
  cost30d: number;
  costAllTime: number;
  rank30d: number | null;
  rankAllTime: number | null;
  underReview: boolean;
  memberSince: string | null;
  lastSyncedAt: string | null;
  orgs: string[];
  rhythm: { days: Array<{ day: string; cost: number }>; currentStreak: number; longestStreak: number };
  efficiency: {
    cacheReadRatio: number | null;
    opusShare: number;
    modelMix: Array<{ family: string; share: number }>;
    grade: string | null;
    estSavingsPerMonth: number | null;
    tokensPerActiveDay: number | null;
  } | null;
  insights: ProfileInsights | LockedInsights;
  owner?: { consent: boolean; visibility: "public" | "private"; machineCount: number };
}

export type ProfileState =
  | { status: "loading" }
  | { status: "notfound" }
  | { status: "ready"; profile: Profile };

export function useProfile(login: string, refreshKey = 0): ProfileState {
  const [state, setState] = useState<ProfileState>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetch(`${API_HTTP}/profile/${encodeURIComponent(login)}`, { credentials: "include" })
      .then(async (r) => {
        if (cancelled) return;
        if (r.status === 404) return setState({ status: "notfound" });
        if (!r.ok) throw new Error(String(r.status));
        setState({ status: "ready", profile: (await r.json()) as Profile });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "notfound" });
      });
    return () => {
      cancelled = true;
    };
  }, [login, refreshKey]);
  return state;
}
```

- [ ] **Step 2: Create `apps/web/src/components/Profile/ProfilePage.tsx` (shell; panels arrive in Tasks 9-10)**

```tsx
import { useState } from "react";
import { useProfile } from "../../useProfile";
import { ClawdLogo } from "../ClawdLogo";
import { InstallBlock } from "../InstallBlock";
import { ArchetypeCard } from "./ArchetypeCard";
import { HabitsPanel } from "./HabitsPanel";
import { EfficiencyPanel } from "./EfficiencyPanel";
import { RhythmPanel } from "./RhythmPanel";

function NotFound({ login }: { login: string }) {
  return (
    <div className="profile-404">
      <ClawdLogo className="empty-clawd" />
      <h2>No warrior named {login}.</h2>
      <p>Maybe a typo. Or maybe they have not enlisted yet. You can:</p>
      <InstallBlock />
      <a className="how-back" href="/">← Back to the board</a>
    </div>
  );
}

function ProfileSkeleton() {
  return <div className="profile-skel" aria-busy="true" />;
}

export function ProfilePage({ login }: { login: string }) {
  // Bump after consent changes so the page refetches with the new state.
  const [refreshKey, setRefreshKey] = useState(0);
  const state = useProfile(login, refreshKey);

  if (state.status === "loading") return <ProfileSkeleton />;
  if (state.status === "notfound") return <NotFound login={login} />;
  const p = state.profile;
  document.title = `${p.login} · CCWarriors`;

  return (
    <div className="profile">
      <div className="profile-grid">
        <ArchetypeCard profile={p} onConsentChanged={() => setRefreshKey((k) => k + 1)} />
        <div className="profile-side">
          <HabitsPanel profile={p} />
          <EfficiencyPanel profile={p} />
        </div>
      </div>
      <RhythmPanel profile={p} />
    </div>
  );
}
```

- [ ] **Step 3: Route it in `apps/web/src/App.tsx`**

After the `const isLegal = ...` line (line ~27), add:

```ts
const PROFILE_LOGIN: string | null = (() => {
  const m = path.match(/^\/u\/([A-Za-z0-9-]{1,39})$/);
  return m ? m[1]! : null;
})();
```

Add the import: `import { ProfilePage } from "./components/Profile/ProfilePage";`

In the JSX, extend the main branch (around line 171):

```tsx
          {PROFILE_LOGIN ? (
            <ProfilePage login={PROFILE_LOGIN} />
          ) : isHow ? (
            <HowItWorks />
          ) : isLegal ? (
```

And suppress the sponsor section on profile pages — change line ~214 to:

```tsx
        {!isHow && !isLegal && !PROFILE_LOGIN && <Sponsor />}
```

- [ ] **Step 4: Create `apps/web/vercel.json` (SPA fallback + bot OG routing)**

```json
{
  "rewrites": [
    {
      "source": "/u/:login",
      "has": [
        {
          "type": "header",
          "key": "user-agent",
          "value": ".*(Twitterbot|facebookexternalhit|Slackbot|LinkedInBot|Discordbot|WhatsApp|TelegramBot).*"
        }
      ],
      "destination": "https://api.ccwarriors.xyz/og/u/:login"
    },
    { "source": "/u/:login", "destination": "/index.html" },
    { "source": "/how", "destination": "/index.html" },
    { "source": "/legal", "destination": "/index.html" }
  ]
}
```

CAUTION: `/how` currently works in prod via Vercel project-level config. Adding `vercel.json` may take over routing entirely — after the deploy, manually verify `https://ccwarriors.xyz/how` still loads before announcing (it is in the Task 12 checklist).

- [ ] **Step 5: Verify shell renders (panels are stubs until Tasks 9-10 — create them as empty placeholders now so the build compiles)**

Create minimal placeholder files (each replaced in the next tasks):

`apps/web/src/components/Profile/ArchetypeCard.tsx`:
```tsx
import type { Profile } from "../../useProfile";
export function ArchetypeCard({ profile }: { profile: Profile; onConsentChanged?: () => void }) {
  return <div className="panel">{profile.login}</div>;
}
```
`apps/web/src/components/Profile/HabitsPanel.tsx`:
```tsx
import type { Profile } from "../../useProfile";
export function HabitsPanel(_: { profile: Profile }) {
  return null;
}
```
`apps/web/src/components/Profile/EfficiencyPanel.tsx`:
```tsx
import type { Profile } from "../../useProfile";
export function EfficiencyPanel(_: { profile: Profile }) {
  return null;
}
```
`apps/web/src/components/Profile/RhythmPanel.tsx`:
```tsx
import type { Profile } from "../../useProfile";
export function RhythmPanel(_: { profile: Profile }) {
  return null;
}
```

Run: `pnpm dev` then open `http://localhost:5173/u/torvaldsjr`
Expected: page shell with the login rendered (placeholder), `http://localhost:5173/u/zzz_nobody` shows the 404 enlist block. Vite serves SPA fallback for unknown paths in dev automatically.

Run: `pnpm --filter web typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): /u/:login route, profile data hook, page shell, vercel rewrites"
```

---

### Task 9: Web — ArchetypeCard (hero, axes, locked states, share)

**Files:**
- Replace: `apps/web/src/components/Profile/ArchetypeCard.tsx`

- [ ] **Step 1: Implement the hero card**

```tsx
import { useRef, useState } from "react";
import { getFontEmbedCSS, toPng } from "html-to-image";
import { API_HTTP } from "../../api";
import type { Profile, ProfileInsights } from "../../useProfile";
import { ClawdLogo } from "../ClawdLogo";
import { PixelGlyph } from "../PixelGlyph";
import { tierLabel } from "../../util";

const AXIS_ORDER = ["summoning", "steering", "velocity", "autonomy", "planning"] as const;
const AXIS_LABEL: Record<(typeof AXIS_ORDER)[number], string> = {
  summoning: "SUMMONING",
  steering: "STEERING",
  velocity: "VELOCITY",
  autonomy: "AUTONOMY",
  planning: "PLANNING",
};

function AxisBars({ insights }: { insights: ProfileInsights }) {
  // Sorted by score: terracotta intensity steps down the ranking (Paper Dossier).
  const sorted = [...AXIS_ORDER].sort((a, b) => insights.axes[b] - insights.axes[a]);
  return (
    <div className="axes mono">
      {sorted.map((axis, i) => (
        <div className="axis" key={axis}>
          <span className="axis-k">{AXIS_LABEL[axis]}</span>
          <span className="axis-track">
            <span className={`axis-fill f${Math.min(i, 2)}`} style={{ width: `${insights.axes[axis]}%` }} />
          </span>
          <b className="axis-v">{insights.axes[axis]}</b>
        </div>
      ))}
      <div className="axis-note">
        {insights.scoresArePercentiles
          ? `percentile among ${insights.population} warriors`
          : "calibrated scores. percentiles unlock as the legion grows"}
      </div>
    </div>
  );
}

function LockedPanel({ profile, onConsentChanged }: { profile: Profile; onConsentChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const locked = profile.insights as { locked: true; reason: string };
  const isOwner = !!profile.owner;

  const unlock = async () => {
    setBusy(true);
    try {
      const r = await fetch(`${API_HTTP}/insights/consent`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ consent: true }),
      });
      if (r.ok) onConsentChanged();
    } finally {
      setBusy(false);
    }
  };

  if (locked.reason === "forging") {
    return (
      <div className="arch-locked">
        <PixelGlyph name="diamond" size={13} />
        <p>Archetype forging. Under 10 sessions in the window so far. Keep coding.</p>
      </div>
    );
  }
  if (locked.reason === "private") {
    return (
      <div className="arch-locked">
        <PixelGlyph name="x" size={13} />
        <p>This warrior keeps their archetype hidden.</p>
      </div>
    );
  }
  // no_consent
  return (
    <div className="arch-locked">
      <PixelGlyph name="diamond" size={13} />
      {isOwner ? (
        <>
          <p>Your archetype is locked. Unlock reads aggregate counts from your local sessions. Transcripts never leave your machine.</p>
          <button className="btn x" onClick={unlock} disabled={busy}>
            {busy ? "Unlocking…" : "Unlock your archetype"}
          </button>
          <p className="arch-hint">Appears after your next sync. Run ccwarriors sync to skip the wait.</p>
        </>
      ) : (
        <p>This warrior has not revealed their archetype. Yours could be live in a minute: run the install command and `ccwarriors insights on`.</p>
      )}
    </div>
  );
}

export function ArchetypeCard({ profile, onConsentChanged }: { profile: Profile; onConsentChanged: () => void }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const unlocked = !profile.insights.locked;
  const insights = unlocked ? (profile.insights as ProfileInsights) : null;

  const shareOnX = () => {
    if (!insights) return;
    const top = [...AXIS_ORDER].sort((a, b) => insights.axes[b] - insights.axes[a]).slice(0, 2);
    const axisBit = top.map((a) => `${AXIS_LABEL[a].toLowerCase()} ${insights.axes[a]}`).join(" · ");
    const text = `I'm ${insights.archetype.toUpperCase()} on @ccwarriorsxyz. ${axisBit}. What class are you?`;
    const url = `https://ccwarriors.xyz/u/${encodeURIComponent(profile.login)}?ref=x_share`;
    window.open(
      `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
      "_blank",
      "noopener",
    );
  };

  const downloadCard = async () => {
    if (!cardRef.current || exporting) return;
    setExporting(true);
    try {
      const fontEmbedCSS = await getFontEmbedCSS(cardRef.current);
      const dataUrl = await toPng(cardRef.current, { pixelRatio: 4, cacheBust: true, fontEmbedCSS });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `ccwarriors-${profile.login}-archetype.png`;
      a.click();
    } catch (err) {
      console.error("card export failed", err);
      alert("Export failed. Try again once the avatar finishes loading.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="arch-wrap">
      <div className="arch-card" ref={cardRef}>
        <div className="arch-head">
          <div className="arch-id">
            <img className="arch-avatar" src={profile.avatarUrl} alt={profile.login} crossOrigin="anonymous" />
            <div>
              <div className="arch-login">{profile.login}</div>
              <div className="arch-rank mono">
                {profile.underReview ? "rank —" : profile.rank30d ? `rank #${profile.rank30d}` : "unranked"} ·{" "}
                <span className="arch-tier">{tierLabel(profile.tier)}</span>
              </div>
            </div>
          </div>
          <div className="arch-brand">
            <ClawdLogo />
          </div>
        </div>

        {insights ? (
          <>
            <div className="arch-name">{insights.archetype.toUpperCase()}</div>
            <div className="arch-trait">
              {insights.trait ? `${insights.trait} · ` : ""}
              {insights.growthEdge}
            </div>
            <AxisBars insights={insights} />
          </>
        ) : (
          <LockedPanel profile={profile} onConsentChanged={onConsentChanged} />
        )}

        <div className="arch-foot mono">
          <span>ccwarriors.xyz/u/{profile.login}</span>
          <span>extended from YC paxel</span>
        </div>
      </div>

      {insights && (
        <div className="arch-actions">
          <button className="btn x" onClick={shareOnX}>Share on X</button>
          <button className="btn g" onClick={downloadCard} disabled={exporting}>
            {exporting ? "Exporting…" : "Download card"}
          </button>
        </div>
      )}
      {profile.owner?.consent && (
        <div className="arch-owner mono">
          insights on · {profile.owner.machineCount} machine{profile.owner.machineCount === 1 ? "" : "s"} ·{" "}
          <button
            className="linklike"
            onClick={async () => {
              const next = profile.owner!.visibility === "public" ? "private" : "public";
              await fetch(`${API_HTTP}/insights/consent`, {
                method: "POST",
                credentials: "include",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ visibility: next }),
              });
              onConsentChanged();
            }}
          >
            make {profile.owner.visibility === "public" ? "private" : "public"}
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify in browser**

Run: `pnpm dev`. Check:
- `http://localhost:5173/u/torvaldsjr` — archetype name, trait+growth line, five sorted axis bars with values, footer. Share + Download buttons present.
- `http://localhost:5173/u/vibecoder` — locked panel, visitor copy (no unlock button without owner cookie).
- `http://localhost:5173/u/nightowl` — "keeps their archetype hidden" (private, non-owner).
Unstyled is fine — CSS lands in Task 11.

Run: `pnpm --filter web typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/Profile/ArchetypeCard.tsx
git commit -m "feat(web): archetype hero card — axes, locked states, consent toggle, share/export"
```

---

### Task 10: Web — Habits, Efficiency, Rhythm panels

**Files:**
- Replace: `apps/web/src/components/Profile/HabitsPanel.tsx`
- Replace: `apps/web/src/components/Profile/EfficiencyPanel.tsx`
- Replace: `apps/web/src/components/Profile/RhythmPanel.tsx`

- [ ] **Step 1: HabitsPanel**

```tsx
import type { Profile, ProfileInsights } from "../../useProfile";

export function HabitsPanel({ profile }: { profile: Profile }) {
  if (profile.insights.locked) return null;
  const h = (profile.insights as ProfileInsights).habits;
  const rows: Array<[string, string]> = [
    [`${h.shortPromptPct}%`, "of your prompts are under 10 words"],
    [`${h.planModeSessionsPct}%`, "of sessions open in plan mode"],
    [`${h.maxParallelAgents}`, "agents at peak, in parallel"],
    [`${h.interruptsPer100Turns}`, "interrupts per 100 agent turns"],
    [`${Math.round(h.longestSessionMinutes / 60 * 10) / 10}h`, "longest single session"],
  ];
  return (
    <div className="ppanel">
      <div className="seclabel">Habits</div>
      {rows.map(([v, label]) => (
        <div className="habit" key={label}>
          <b className="mono">{v}</b>
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: EfficiencyPanel**

```tsx
import type { Profile } from "../../useProfile";

export function EfficiencyPanel({ profile }: { profile: Profile }) {
  const e = profile.efficiency;
  if (!e || !e.grade) return null;
  return (
    <div className="ppanel">
      <div className="seclabel">Efficiency</div>
      <div className="eff-grade">
        <span className="eff-letter mono">{e.grade}</span>
        <span className="eff-sub">model mix grade</span>
      </div>
      {e.cacheReadRatio !== null && (
        <div className="habit">
          <b className="mono">{Math.round(e.cacheReadRatio * 100)}%</b>
          <span>of context served from cache</span>
        </div>
      )}
      {e.estSavingsPerMonth !== null && e.estSavingsPerMonth > 0 && (
        <div className="habit">
          <b className="mono">${e.estSavingsPerMonth}</b>
          <span>monthly saving if routine work moves to Sonnet</span>
        </div>
      )}
      {e.modelMix.length > 0 && (
        <div className="eff-mix mono">
          {e.modelMix.slice(0, 3).map((m) => (
            <span key={m.family}>
              {m.family} {Math.round(m.share * 100)}%
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: RhythmPanel — heatmap + streaks**

```tsx
import type { Profile } from "../../useProfile";

const WEEKS = 26; // ~6 months of columns

export function RhythmPanel({ profile }: { profile: Profile }) {
  const { days, currentStreak, longestStreak } = profile.rhythm;
  if (days.length === 0) return null;
  const byDay = new Map(days.map((d) => [d.day, d.cost]));
  const max = Math.max(...days.map((d) => d.cost), 1);

  // Build a GitHub-style grid: columns = weeks, rows = Sun..Sat, ending today.
  const today = new Date();
  const cells: Array<{ day: string; level: number }> = [];
  const start = new Date(today.getTime() - (WEEKS * 7 - 1) * 86_400_000);
  // Align the first column to Sunday.
  start.setDate(start.getDate() - start.getDay());
  for (let t = start.getTime(); t <= today.getTime(); t += 86_400_000) {
    const day = new Date(t).toISOString().slice(0, 10);
    const cost = byDay.get(day) ?? 0;
    const level = cost <= 0 ? 0 : Math.min(4, 1 + Math.floor((cost / max) * 3.99));
    cells.push({ day, level });
  }

  return (
    <div className="ppanel rhythm">
      <div className="seclabel">Rhythm</div>
      <div className="heatmap" role="img" aria-label="daily usage heatmap">
        {cells.map((c) => (
          <span key={c.day} className={`hm l${c.level}`} title={c.day} />
        ))}
      </div>
      <div className="rhythm-stats mono">
        <span>
          <b>{currentStreak}d</b> current streak
        </span>
        <span>
          <b>{longestStreak}d</b> longest streak
        </span>
        <span>
          <b>{days.filter((d) => d.cost > 0).length}</b> active days tracked
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify in browser**

Run: `pnpm dev` → `http://localhost:5173/u/torvaldsjr`
Expected: habits rows with real numbers, efficiency grade + cache %, heatmap grid (~35 filled cells trailing right edge), streak stats matching the API (`curl -s localhost:8787/profile/torvaldsjr | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['rhythm']['currentStreak'], d['efficiency']['grade'])"`).

Run: `pnpm --filter web typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/Profile
git commit -m "feat(web): habits, efficiency, rhythm panels"
```

---

### Task 11: Paper Dossier CSS (light signature + graphite twin)

**Files:**
- Modify: `apps/web/src/index.css` (append a `/* ── Profile page ── */` section)

- [ ] **Step 1: Append the profile styles to `apps/web/src/index.css`**

Uses existing tokens (`--bg --panel --line --ink --muted --or --bronze --segoff`) so org co-brands and dark mode inherit automatically. Append:

```css
/* ── Profile page (Paper Dossier) ───────────────────────────────────────── */
.profile{ padding:26px 0 40px; }
.profile-grid{ display:grid; grid-template-columns: minmax(0,1.25fr) minmax(0,1fr); gap:18px; align-items:start; }
@media (max-width: 760px){ .profile-grid{ grid-template-columns: 1fr; } }
.profile-side{ display:flex; flex-direction:column; gap:18px; }

.ppanel{ background:var(--panel); border:1px solid var(--line); padding:18px; }

/* Hero card: whiter than the page, one soft elevation shadow (Paper Dossier). */
.arch-card{ background:var(--panel); border:1px solid var(--line); padding:22px;
  box-shadow:0 1px 2px rgba(22,20,15,.04), 0 8px 24px rgba(22,20,15,.05); }
[data-theme="dark"] .arch-card{ background:linear-gradient(180deg,#17171a,#121215);
  box-shadow:0 1px 0 rgba(255,255,255,.04) inset, 0 16px 40px rgba(0,0,0,.5); }
.arch-head{ display:flex; justify-content:space-between; align-items:flex-start; }
.arch-id{ display:flex; gap:12px; align-items:center; }
.arch-avatar{ width:44px; height:44px; border:1px solid var(--line); background:var(--avbg); object-fit:cover; }
.arch-login{ font-weight:700; font-size:16px; }
.arch-rank{ font-size:11.5px; color:var(--muted); margin-top:2px; }
.arch-tier{ color:var(--bronze); font-weight:600; }
.arch-name{ font-family:'Pixelify Sans'; font-size:clamp(26px,5vw,34px); letter-spacing:.05em;
  color:var(--or); margin-top:18px; }
[data-theme="dark"] .arch-name{ color:var(--ink); }
.arch-trait{ font-size:12.5px; color:var(--muted); margin-top:4px; line-height:1.5; }

.axes{ margin-top:16px; font-size:11px; }
.axis{ display:flex; align-items:center; gap:10px; margin-top:7px; }
.axis-k{ width:78px; color:var(--muted); letter-spacing:.08em; }
.axis-track{ flex:1; height:7px; background:var(--segoff); overflow:hidden; }
.axis-fill{ display:block; height:100%; background:var(--or); opacity:.3; transition:width .6s ease; }
.axis-fill.f0{ opacity:1; } .axis-fill.f1{ opacity:.75; } .axis-fill.f2{ opacity:.5; }
.axis-v{ width:26px; text-align:right; font-weight:700; }
.axis-note{ margin-top:12px; font-size:10.5px; color:var(--muted); letter-spacing:.04em; }

.arch-foot{ display:flex; justify-content:space-between; margin-top:18px; padding-top:12px;
  border-top:1px dashed var(--line); font-size:10.5px; color:var(--muted); }
.arch-actions{ display:flex; gap:10px; margin-top:12px; }
.arch-owner{ margin-top:10px; font-size:11px; color:var(--muted); }
.linklike{ background:none; border:0; padding:0; font:inherit; color:var(--ink);
  text-decoration:underline; text-underline-offset:3px; cursor:pointer; }

.arch-locked{ margin-top:18px; border:1px dashed var(--line); padding:18px; color:var(--muted);
  font-size:13px; line-height:1.6; display:flex; flex-direction:column; gap:10px; align-items:flex-start; }
.arch-locked .btn{ margin-top:4px; }
.arch-hint{ font-size:11px; }

.habit{ display:flex; align-items:baseline; gap:10px; margin-top:10px; font-size:12.5px; color:var(--muted); }
.habit b{ font-size:16px; color:var(--ink); min-width:52px; }

.eff-grade{ display:flex; align-items:baseline; gap:10px; }
.eff-letter{ font-size:34px; font-weight:700; color:var(--or); }
.eff-sub{ font-size:11px; color:var(--muted); letter-spacing:.1em; text-transform:uppercase; }
.eff-mix{ display:flex; gap:14px; margin-top:12px; font-size:11px; color:var(--muted); }

.rhythm{ margin-top:18px; }
.heatmap{ display:grid; grid-auto-flow:column; grid-template-rows:repeat(7,10px); gap:3px; overflow-x:auto; padding-bottom:4px; }
.hm{ width:10px; height:10px; background:var(--segoff); }
.hm.l1{ background:var(--or); opacity:.25; } .hm.l2{ background:var(--or); opacity:.5; }
.hm.l3{ background:var(--or); opacity:.75; } .hm.l4{ background:var(--or); opacity:1; }
.rhythm-stats{ display:flex; gap:22px; margin-top:12px; font-size:11.5px; color:var(--muted); }
.rhythm-stats b{ color:var(--ink); }

.profile-404{ text-align:center; padding:60px 0; }
.profile-404 h2{ font-family:'Geist Mono'; font-size:22px; margin-bottom:8px; }
.profile-404 p{ color:var(--muted); margin-bottom:18px; }
.profile-skel{ min-height:420px; background:var(--segoff); animation:pulse 1.2s ease-in-out infinite; margin-top:26px; }
@keyframes pulse{ 0%,100%{ opacity:.55; } 50%{ opacity:.9; } }
```

NOTE: check how dark mode is keyed in this file first (`grep -n 'data-theme\|prefers-color-scheme' apps/web/src/index.css` — the `:root` override at line 7 will reveal the selector). Use the same selector the file already uses for dark overrides instead of `[data-theme="dark"]` if it differs.

- [ ] **Step 2: Visual verification (both modes, both viewports)**

Run: `pnpm dev` and check `http://localhost:5173/u/torvaldsjr`:
- Light: cream page, white hero card with soft shadow, terracotta archetype name, axis bars stepping down in intensity, bronze tier.
- Dark (toggle in header): graphite card with inner highlight, ink archetype name, terracotta confined to bars.
- Mobile (devtools, 390px): grid collapses to one column; heatmap scrolls horizontally.
- Locked profile `/u/vibecoder` and 404 page still look composed.

Screenshot each state for the verification record (project rule).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/index.css
git commit -m "feat(web): paper dossier styling for profile page, light + graphite dark"
```

---

### Task 12: Leaderboard links, OG bot route, full end-to-end

**Files:**
- Modify: `apps/web/src/components/Leaderboard.tsx` (row → profile link)
- Create: `apps/server/src/routes/og.ts`
- Modify: `apps/server/src/app.ts` (route og)

- [ ] **Step 1: Point leaderboard rows at profiles**

In `apps/web/src/components/Leaderboard.tsx`, the `Row` component's `.who` anchor (line ~102) currently links to GitHub. Change to the internal profile:

```tsx
      <a
        className="who"
        href={`/u/${encodeURIComponent(entry.githubLogin)}`}
        title={`${entry.githubLogin} on CCWarriors`}
      >
```

(The GitHub link remains reachable: the profile page header shows the avatar/login — add a small external link there if missed; acceptable v1.)

- [ ] **Step 2: Create `apps/server/src/routes/og.ts`**

```ts
import { Hono } from "hono";
import type { LeaderboardStore } from "../lib/leaderboard-store.js";
import type { DB } from "../db/index.js";
import { users } from "../db/schema.js";
import { sql } from "drizzle-orm";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Crawler-facing OG shell for /u/:login (Vercel routes bot UAs here).
    Static brand image, dynamic title/description; humans get redirected. */
export function ogRoute(db: DB, store: LeaderboardStore, webBaseUrl: string) {
  const app = new Hono();
  app.get("/u/:login", async (c) => {
    const raw = c.req.param("login");
    if (!/^[a-zA-Z0-9-]{1,39}$/.test(raw)) return c.text("not found", 404);
    const entry = store.getByLogin(raw);
    const [user] = await db
      .select({ login: users.githubLogin, archetype: users.archetype, visibility: users.insightsVisibility })
      .from(users)
      .where(sql`lower(${users.githubLogin}) = ${raw.toLowerCase()}`);
    if (!entry && !user) return c.text("not found", 404);
    const login = user?.login ?? entry!.githubLogin;
    const rank = entry ? store.getRank("30d", entry.id) : null;
    const archetype = user?.visibility === "public" ? user?.archetype : null;
    const title = archetype
      ? `${login} is ${archetype} on CCWarriors`
      : `${login} on CCWarriors`;
    const desc = rank
      ? `Rank #${rank} on the AI coding leaderboard. See the archetype, habits, and rhythm.`
      : `Warrior profile on the AI coding leaderboard.`;
    const url = `${webBaseUrl}/u/${encodeURIComponent(login)}`;
    return c.html(`<!doctype html>
<html><head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(webBaseUrl)}/og.png">
<meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0;url=${esc(url)}">
</head><body><a href="${esc(url)}">${esc(title)}</a></body></html>`);
  });
  return app;
}
```

Wire in `app.ts` (inside `if (deps)`, webBaseUrl comes from auth deps or default):

```ts
    app.route("/og", ogRoute(deps.db, deps.store, deps.auth?.webBaseUrl ?? "https://ccwarriors.xyz"));
```

(import `ogRoute` at top). Check `ls apps/web/public/og.png` — if it does not exist, pick the best-looking existing brand asset (`ls apps/web/public/*.png`) and copy it to `og.png`, or flag for a designed card before launch. Do not block on it.

- [ ] **Step 3: Full local end-to-end (the real verification)**

```bash
pnpm verify    # tests + typecheck + build across the monorepo — must be green
```

Then the real-data loop (your machine, real GitHub login):

```bash
# server with real-ish config but local DB
SEED_DEMO=true SEED_CLI_TOKEN=devtoken pnpm --filter server dev   # terminal 1
pnpm --filter web dev                                              # terminal 2

# consent on via CLI path (dev API):
CCWARRIORS_API=http://localhost:8787 node packages/cli/dist/cli.js insights --dry-run
# inspect payload: aggregate counts only — THE privacy check

curl -s -X POST localhost:8787/insights/consent -H "Authorization: Bearer devtoken" -H "content-type: application/json" -d '{"consent":true}'

# extract YOUR real payload and push it as devwarrior:
cd packages/cli && npx tsx -e "
import { collectInsights } from './src/insights.ts';
const p = await collectInsights();
const r = await fetch('http://localhost:8787/insights', { method:'POST', headers:{'content-type':'application/json', authorization:'Bearer devtoken'}, body: JSON.stringify({ machineId:'abcdef12', insights:p })});
console.log(r.status, await r.text());
" && cd ../..
# expect 200 {"ok":true,"archetype":"The ..."}

open http://localhost:5173/u/devwarrior
```

**Screenshot checklist (capture all, light + dark):**
1. Full unlocked profile (devwarrior with YOUR real extracted data)
2. Locked visitor view (`/u/vibecoder`)
3. Private view (`/u/nightowl`)
4. 404 (`/u/zzz_nobody`)
5. Mobile width (390px) of state 1
6. Downloaded share card PNG (click Download card)
7. Bot OG shell: `curl -s localhost:8787/og/u/torvaldsjr` shows og:title

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/Leaderboard.tsx apps/server/src
git commit -m "feat: leaderboard profile links + crawler OG shell for /u/*"
```

---

### Task 13: Launch sequencing notes (no code — release checklist)

- [ ] **Step 1: Pre-deploy review of the deploy-race rule**

Order is fixed by the spec (§8): **server deploys first** (Railway — accepts `/insights`, serves `/profile`), web second (Vercel — vercel.json rewrites + new page), CLI build last (the self-update fleet pulls it). The CLI build must not ship before the server accepts its POSTs.

- [ ] **Step 2: Verify the live rollout**

After deploys, on production:
- `curl -s https://api.ccwarriors.xyz/profile/<your-login>` → real payload
- `https://ccwarriors.xyz/how` still loads (vercel.json takeover check)
- `https://ccwarriors.xyz/u/<your-login>` renders; leaderboard rows link to it
- Run `ccwarriors insights on` on your machine → archetype appears
- `curl -s -A Twitterbot https://ccwarriors.xyz/u/<your-login>` → OG shell
- Self-update: a machine on the old build syncs → picks up the new build (watch `/telemetry` for `self_update_applied`); `CLI_UPDATE_ENABLED=0` is armed if anything looks wrong.

- [ ] **Step 3: Announce**

X post per spec §8 once your own profile is fully lit: paxel-extension story, archetype card PNG attached, profile link. All other profiles show live efficiency/rhythm + locked archetype nudge. No seeded data anywhere.

---

## Self-review notes (already applied)

- Spec coverage: §2 axes/archetypes → Task 2; §3 CLI/consent/payload → Tasks 6-7; §4 storage/API/OG → Tasks 1, 3, 5, 12; §5 UI/Dossier/Paper → Tasks 8-11; §6 edge cases → locked/private/forging/404/flagged paths in Tasks 5, 8-9; §7 verification → per-task verify steps + Task 12 checklist; §8 launch → Task 13.
- `insightsRequested` consistency: ingest result (Task 3) ↔ CLI `IngestResponse` (Task 7) — same key.
- `InsightsPayload` field names identical in server schema (Task 1), zod (Task 3), CLI (Task 6) — `planModeSessionsPct` everywhere (the spec draft's `planModeTurnsPct` was renamed: sessions-based is what the extractor measures).
- Demo logins collide with store seed ids by design; profile route never joins store ids to DB ids (documented in Tasks 4-5).
