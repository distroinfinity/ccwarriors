import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { skillsRoute, clearSkillOutcomesCache } from "../src/routes/skills.js";
import { makeDb, seedUser } from "./helpers/db.js";
import { users, userDeepSessions } from "../src/db/schema.js";

beforeEach(() => clearSkillOutcomesCache());

describe("GET /skills/outcomes", () => {
  it("returns a ranked skills array", async () => {
    const db = await makeDb();
    for (let i = 0; i < 6; i++) {
      await seedUser(db, { login: `u${i}`, token: `t${i}`, githubId: `u${i}` });
      await db.update(users).set({ insightsConsent: true, insightsVisibility: "public", insightsMode: "deep" }).where(eq(users.githubLogin, `u${i}`));
      const [u] = await db.select().from(users).where(eq(users.githubLogin, `u${i}`));
      await db.insert(userDeepSessions).values({
        userId: u!.id, machineId: "m", windowDays: 30,
        sessions: [{ startHour: 9, durationMinutes: 10, prompts: 1, interrupts: 0, usedPlanMode: false, exploreBeforeFirstEdit: false, hadEdits: true, subagentSpawns: 0, maxParallel: 0, editCalls: 1, assistantTurns: 3, wordBuckets: { "1-5": 1, "6-10": 0, "11-25": 0, "26+": 0 }, model: "claude-opus-4-7", timing: { events: 2, medianGapMs: 1, p10GapMs: 1, subSecondFraction: 0 }, tool: "claude", skillsUsed: { "test-driven-development": 1 }, git: { repoIdHash: "r", branchHash: "b", commitsInWindow: 1, linesAdded: 100, linesDeleted: 0, filesChanged: 1, testFilesTouched: 0, aiLinkedCommits: 1, revertedLinesWithin14d: 10, squashMergeDetected: false, rebaseDetected: false, isMonorepo: false, hasRemote: true } }],
      });
    }
    const res = await skillsRoute(db).request("/outcomes");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { skills: unknown[] };
    expect(Array.isArray(body.skills)).toBe(true);
    expect(body.skills.some((s: unknown) => (s as { skill: string }).skill === "test-driven-development")).toBe(true);
  });
});
