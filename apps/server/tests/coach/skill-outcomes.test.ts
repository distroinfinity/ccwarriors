import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { loadSkillOutcomes } from "../../src/lib/coach/skill-outcomes.js";
import { makeDb, seedUser } from "../helpers/db.js";
import { users, userDeepSessions } from "../../src/db/schema.js";

const NOW = Date.UTC(2026, 6, 1);

// A consenting-public user with one deep session carrying git + optional skill use.
async function pubUser(db: Awaited<ReturnType<typeof makeDb>>, login: string, added: number, reverted: number, skills: Record<string, number> | undefined) {
  await seedUser(db, { login, token: `t-${login}`, githubId: login });
  await db.update(users).set({ insightsConsent: true, insightsVisibility: "public", insightsMode: "deep" }).where(eq(users.githubLogin, login));
  const [u] = await db.select().from(users).where(eq(users.githubLogin, login));
  await db.insert(userDeepSessions).values({
    userId: u!.id, machineId: "m", windowDays: 30,
    sessions: [{
      startHour: 9, durationMinutes: 10, prompts: 1, interrupts: 0, usedPlanMode: false,
      exploreBeforeFirstEdit: false, hadEdits: true, subagentSpawns: 0, maxParallel: 0,
      editCalls: 1, assistantTurns: 3, wordBuckets: { "1-5": 1, "6-10": 0, "11-25": 0, "26+": 0 },
      model: "claude-opus-4-7", timing: { events: 2, medianGapMs: 1, p10GapMs: 1, subSecondFraction: 0 },
      tool: "claude", skillsUsed: skills,
      git: { repoIdHash: "r", branchHash: "b", commitsInWindow: 1, linesAdded: added, linesDeleted: 0, filesChanged: 1, testFilesTouched: 0, aiLinkedCommits: 1, revertedLinesWithin14d: reverted, squashMergeDetected: false, rebaseDetected: false, isMonorepo: false, hasRemote: true },
    }],
  });
}

describe("loadSkillOutcomes", () => {
  it("ranks a skill's adopters vs non-adopters by median revert, flags calibration", async () => {
    const db = await makeDb();
    // 6 adopters of "tdd" revert 10%; 6 non-adopters revert 40%.
    for (let i = 0; i < 6; i++) await pubUser(db, `tdd${i}`, 100, 10, { "test-driven-development": 1 });
    for (let i = 0; i < 6; i++) await pubUser(db, `no${i}`, 100, 40, undefined);

    const out = await loadSkillOutcomes(db, NOW);
    const tdd = out.find((s) => s.skill === "test-driven-development")!;
    expect(tdd.adopters).toBe(6);
    expect(tdd.nonAdopters).toBe(6);
    expect(tdd.medianRevertWith).toBeCloseTo(0.1, 5);
    expect(tdd.medianRevertWithout).toBeCloseTo(0.4, 5);
    expect(tdd.relativeDelta).toBeCloseTo(0.75, 5); // (0.4-0.1)/0.4
    expect(tdd.calibrated).toBe(false);             // 6 < 30
  });

  it("omits a skill below the report floor (n<5)", async () => {
    const db = await makeDb();
    for (let i = 0; i < 3; i++) await pubUser(db, `rare${i}`, 100, 5, { "rare-skill": 1 });
    for (let i = 0; i < 6; i++) await pubUser(db, `base${i}`, 100, 20, undefined);
    const out = await loadSkillOutcomes(db, NOW);
    expect(out.find((s) => s.skill === "rare-skill")).toBeUndefined();
  });
});
