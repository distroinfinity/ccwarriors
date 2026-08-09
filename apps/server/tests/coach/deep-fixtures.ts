import type { SessionGitOutcome, SessionRecord } from "../../src/db/schema.js";
import type { CoachSession } from "../../src/lib/coach/types.js";

/** A complete SessionGitOutcome with sane zeros; override any field. */
export function git(over: Partial<SessionGitOutcome> = {}): SessionGitOutcome {
  return {
    repoIdHash: "r", branchHash: "b", commitsInWindow: 0, linesAdded: 0, linesDeleted: 0,
    filesChanged: 0, testFilesTouched: 0, aiLinkedCommits: 0, revertedLinesWithin14d: 0,
    squashMergeDetected: false, rebaseDetected: false, isMonorepo: false, hasRemote: false,
    ...over,
  };
}

/** A complete CoachSession (SessionRecord + tool + estimatedCost); override any field. */
export function sess(over: Partial<CoachSession> = {}): CoachSession {
  const base: SessionRecord = {
    startHour: 9, durationMinutes: 10, prompts: 1, interrupts: 0, usedPlanMode: false,
    exploreBeforeFirstEdit: false, hadEdits: true, subagentSpawns: 0, maxParallel: 0,
    editCalls: 1, assistantTurns: 3, wordBuckets: { "1-5": 1, "6-10": 0, "11-25": 0, "26+": 0 },
    model: "claude-opus-4-7", timing: { events: 2, medianGapMs: 1, p10GapMs: 1, subSecondFraction: 0 },
    git: null, tool: "claude",
  };
  return { ...base, tool: "claude", estimatedCost: 0, ...over };
}
