import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { loadWindowUsageByTool, computeBurn, buildCoachContext, COACH_WINDOW_DAYS } from "../../src/lib/coach/context.js";
import { makeBenchmarks } from "../../src/lib/coach/benchmark.js";
import { makeDb, seedUser } from "../helpers/db.js";
import { users, usageDays } from "../../src/db/schema.js";

const NOW = Date.UTC(2026, 5, 15, 12, 0, 0); // 2026-06-15

async function freshUser(db: Awaited<ReturnType<typeof makeDb>>, login: string, mode = "deep") {
  await seedUser(db, { login, token: `tok-${login}`, githubId: login });
  await db.update(users).set({ insightsConsent: true, insightsMode: mode }).where(eq(users.githubLogin, login));
  const [u] = await db.select().from(users).where(eq(users.githubLogin, login));
  return u!;
}

describe("loadWindowUsageByTool", () => {
  it("sums cost and tokens per tool inside the window, ignoring older rows", async () => {
    const db = await makeDb();
    const u = await freshUser(db, "byTool");
    await db.insert(usageDays).values([
      { userId: u.id, machineId: "m", tool: "claude", day: "2026-06-10", inputTokens: 100, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 900, cost: "4" },
      { userId: u.id, machineId: "m", tool: "codex", day: "2026-06-11", inputTokens: 50, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 50, cost: "3" },
      { userId: u.id, machineId: "m", tool: "claude", day: "2026-01-01", inputTokens: 999, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, cost: "99" }, // out of window
    ]);
    const byTool = await loadWindowUsageByTool(db, u.id, NOW);
    const claude = byTool.find((t) => t.tool === "claude")!;
    expect(claude.cost).toBe(4);
    expect(claude.cacheReadTokens).toBe(900);
    expect(byTool.find((t) => t.tool === "codex")!.cost).toBe(3);
    expect(byTool.some((t) => t.cost === 99)).toBe(false);
  });
});

describe("computeBurn", () => {
  it("projects month spend from window run-rate and reports prior month", () => {
    const rows = [
      { day: "2026-06-01", cost: 10 }, { day: "2026-06-15", cost: 20 }, // current month
      { day: "2026-05-20", cost: 30 },                                   // prior month
    ];
    const burn = computeBurn(rows, NOW);
    expect(burn.runRatePerDay).toBeCloseTo(60 / COACH_WINDOW_DAYS, 5); // window-cost / windowDays
    expect(burn.projectedMonthUsd).toBeCloseTo((60 / COACH_WINDOW_DAYS) * 30, 5);
    expect(burn.priorMonthUsd).toBe(30);
  });

  it("returns null prior month when there are no prior-month rows", () => {
    expect(computeBurn([{ day: "2026-06-10", cost: 5 }], NOW).priorMonthUsd).toBeNull();
  });
});

describe("buildCoachContext", () => {
  it("assembles a deep-mode context with apportioned sessions", async () => {
    const db = await makeDb();
    const u = await freshUser(db, "ctx", "deep");
    await db.insert(usageDays).values({ userId: u.id, machineId: "m", tool: "claude", day: "2026-06-10", inputTokens: 1000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 9000, cost: "8", modelBreakdown: [{ modelName: "claude-opus-4-7", inputTokens: 1000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 9000 }] });
    await db.insert((await import("../../src/db/schema.js")).userDeepSessions).values({
      userId: u.id, machineId: "m", windowDays: 40,
      sessions: [
        { startHour: 9, durationMinutes: 10, prompts: 1, interrupts: 0, usedPlanMode: false, exploreBeforeFirstEdit: false, hadEdits: true, subagentSpawns: 0, maxParallel: 0, editCalls: 1, assistantTurns: 3, wordBuckets: { "1-5": 1, "6-10": 0, "11-25": 0, "26+": 0 }, model: "claude-opus-4-7", timing: { events: 2, medianGapMs: 1, p10GapMs: 1, subSecondFraction: 0 }, git: null, tool: "claude" },
        { startHour: 9, durationMinutes: 10, prompts: 1, interrupts: 0, usedPlanMode: false, exploreBeforeFirstEdit: false, hadEdits: true, subagentSpawns: 0, maxParallel: 0, editCalls: 1, assistantTurns: 1, wordBuckets: { "1-5": 1, "6-10": 0, "11-25": 0, "26+": 0 }, model: "claude-opus-4-7", timing: { events: 2, medianGapMs: 1, p10GapMs: 1, subSecondFraction: 0 }, git: null, tool: "claude" },
      ],
    });
    const ctx = await buildCoachContext(db, u, true, NOW, makeBenchmarks({}));
    expect(ctx.deepMode).toBe(true);
    expect(ctx.windowCostUsd).toBe(8);
    expect(ctx.deepSessions).toHaveLength(2);
    expect(ctx.deepSessions[0]!.estimatedCost).toBeCloseTo(6, 5); // 8 * 3/4
    expect(ctx.efficiency?.cacheReadRatio).toBeCloseTo(0.9, 5);
  });

  it("yields no deep sessions when the user is not in deep mode", async () => {
    const db = await makeDb();
    const u = await freshUser(db, "shallow", "off");
    await db.insert(usageDays).values({ userId: u.id, machineId: "m", tool: "claude", day: "2026-06-10", inputTokens: 1000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, cost: "2" });
    const ctx = await buildCoachContext(db, u, false, NOW, makeBenchmarks({}));
    expect(ctx.deepMode).toBe(false);
    expect(ctx.deepSessions).toEqual([]);
  });
});
