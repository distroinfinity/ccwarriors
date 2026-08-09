import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { skillsRoute, clearSkillOutcomesCache } from "../src/routes/skills.js";
import { makeDb, seedUser } from "./helpers/db.js";
import { users, userDeepSessions } from "../src/db/schema.js";

beforeEach(() => clearSkillOutcomesCache());

describe("GET /skills/outcomes", () => {
  async function seed(db: Awaited<ReturnType<typeof makeDb>>, login: string, skills: Record<string, number> | undefined, reverted: number) {
    await seedUser(db, { login, token: `t-${login}`, githubId: login });
    await db.update(users).set({ insightsConsent: true, insightsVisibility: "public", insightsMode: "deep" }).where(eq(users.githubLogin, login));
    const [u] = await db.select().from(users).where(eq(users.githubLogin, login));
    await db.insert(userDeepSessions).values({
      userId: u!.id, machineId: "m", windowDays: 30,
      sessions: [{ startHour: 9, durationMinutes: 10, prompts: 1, interrupts: 0, usedPlanMode: false, exploreBeforeFirstEdit: false, hadEdits: true, subagentSpawns: 0, maxParallel: 0, editCalls: 1, assistantTurns: 3, wordBuckets: { "1-5": 1, "6-10": 0, "11-25": 0, "26+": 0 }, model: "claude-opus-4-7", timing: { events: 2, medianGapMs: 1, p10GapMs: 1, subSecondFraction: 0 }, tool: "claude", skillsUsed: skills, git: { repoIdHash: "r", branchHash: "b", commitsInWindow: 1, linesAdded: 100, linesDeleted: 0, filesChanged: 1, testFilesTouched: 0, aiLinkedCommits: 1, revertedLinesWithin14d: reverted, squashMergeDetected: false, rebaseDetected: false, isMonorepo: false, hasRemote: true } }],
    });
  }

  it("returns a ranked skills array", async () => {
    const db = await makeDb();
    // Both cohort sides must clear the k-anonymity floor (>=5) for a skill to surface.
    for (let i = 0; i < 6; i++) await seed(db, `tdd${i}`, { "test-driven-development": 1 }, 10);
    for (let i = 0; i < 6; i++) await seed(db, `base${i}`, undefined, 40);
    const res = await skillsRoute(db).request("/outcomes");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { skills: unknown[] };
    expect(Array.isArray(body.skills)).toBe(true);
    expect(body.skills.some((s: unknown) => (s as { skill: string }).skill === "test-driven-development")).toBe(true);
  });
});
