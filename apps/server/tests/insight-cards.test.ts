import { describe, it, expect } from "vitest";
import { buildInsightCards, friendlyModel, type InsightCard } from "../src/lib/insight-cards.js";
import { deriveAggregate } from "../src/lib/deep.js";
import type { SessionRecord, SessionGitOutcome } from "../src/db/schema.js";

function git(over: Partial<SessionGitOutcome> = {}): SessionGitOutcome {
  return {
    repoIdHash: "repo1",
    branchHash: "br1",
    commitsInWindow: 2,
    linesAdded: 100,
    linesDeleted: 10,
    filesChanged: 5,
    testFilesTouched: 1,
    aiLinkedCommits: 2,
    revertedLinesWithin14d: 0,
    squashMergeDetected: false,
    rebaseDetected: false,
    isMonorepo: false,
    hasRemote: true,
    ...over,
  };
}

function session(over: Partial<SessionRecord> = {}): SessionRecord {
  return {
    startHour: 23,
    durationMinutes: 40,
    prompts: 5,
    interrupts: 1,
    usedPlanMode: true,
    exploreBeforeFirstEdit: true,
    hadEdits: true,
    subagentSpawns: 1,
    maxParallel: 2,
    editCalls: 4,
    assistantTurns: 20,
    wordBuckets: { "1-5": 2, "6-10": 2, "11-25": 1, "26+": 0 },
    model: "claude-opus-4-7",
    timing: { events: 10, medianGapMs: 1000, p10GapMs: 200, subSecondFraction: 0.1 },
    git: git(),
    ...over,
  };
}

function byKey(cards: InsightCard[]): Map<string, InsightCard> {
  return new Map(cards.map((c) => [c.key, c]));
}

describe("friendlyModel", () => {
  it("prettifies claude families", () => {
    expect(friendlyModel("claude-opus-4-7")).toBe("Opus 4.7");
    expect(friendlyModel("claude-sonnet-4-5")).toBe("Sonnet 4.5");
    expect(friendlyModel("claude-3-5-haiku-20241022")).toBe("Haiku 3.5");
    expect(friendlyModel("claude-opus-4-1-20250805")).toBe("Opus 4.1");
  });
  it("handles openai gpt + o-series", () => {
    expect(friendlyModel("gpt-4o")).toBe("GPT-4o");
    expect(friendlyModel("gpt-5")).toBe("GPT-5");
    expect(friendlyModel("o3")).toBe("GPT-o3");
  });
  it("falls back to the raw id", () => {
    expect(friendlyModel("some-weird-model")).toBe("some-weird-model");
  });
});

describe("buildInsightCards — rich fixture", () => {
  // 20 sessions: 15 opus, 5 sonnet. Mostly plan mode, night-start, shipping.
  const sessions: SessionRecord[] = [];
  for (let i = 0; i < 20; i++) {
    sessions.push(
      session({
        model: i < 15 ? "claude-opus-4-7" : "claude-sonnet-4-5",
        startHour: 23,
        usedPlanMode: i % 2 === 0, // 10/20 = 50% plan
        maxParallel: i === 0 ? 5 : 2,
        durationMinutes: i === 0 ? 185 : 40, // longest = 3h 5m
        interrupts: 2, // 2 interrupts / 20 turns = 10 per 100
        assistantTurns: 20,
        wordBuckets: { "1-5": 4, "6-10": 3, "11-25": 2, "26+": 1 }, // 7/10 short = 70%
        git: git({
          commitsInWindow: 2,
          linesAdded: 100,
          revertedLinesWithin14d: 0,
          testFilesTouched: i < 12 ? 1 : 0, // 12/20 shipping w/ tests = 60%
          repoIdHash: i < 10 ? "repoA" : "repoB",
        }),
      }),
    );
  }
  const merged = deriveAggregate(sessions, 30);
  const cards = buildInsightCards({
    sessions,
    merged,
    efficiency: null,
    archetype: "The Tactician",
    pillars: { direction: 50 },
  });
  const m = byKey(cards);

  it("emits archetype card", () => {
    expect(m.get("archetype")?.headline).toBe("THE TACTICIAN");
    expect(m.get("archetype")?.body).toMatch(/plan/i);
  });
  it("model card: top opus 75%, sonnet 25%", () => {
    const c = m.get("model")!;
    expect(c.headline).toBe("You love Opus 4.7");
    expect(c.body).toBe("75% of your sessions ran Opus 4.7, Sonnet 4.5 25%");
  });
  it("night_owl with peak 11 PM", () => {
    const c = m.get("night_owl")!;
    expect(c.headline).toBe("Night owl");
    expect(c.stat).toBe("11 PM");
  });
  it("plan_mode at 50%", () => {
    expect(m.get("plan_mode")?.headline).toBe("50% in plan mode");
  });
  it("agents card reports peak 5 across repos", () => {
    const c = m.get("agents")!;
    expect(c.headline).toBe("5 agents in parallel");
    expect(c.body).toBe("across 2 repos");
  });
  it("prompt_length: 70% under 10 words", () => {
    const c = m.get("prompt_length")!;
    expect(c.headline).toBe("Straight to the point");
    expect(c.body).toBe("70% of your prompts are under 10 words");
  });
  it("course_correction at ~10 per 100", () => {
    const c = m.get("course_correction")!;
    expect(c.headline).toBe("You steer hard");
    expect(c.body).toBe("About 10 course-corrections per 100 agent turns");
  });
  it("longest_run 3h 5m", () => {
    expect(m.get("longest_run")?.headline).toBe("3h 5m");
  });
  it("shipped card: surviving LOC + commits", () => {
    const c = m.get("shipped")!;
    // 20 sessions * 100 LOC = 2,000; 20 * 2 commits = 40.
    expect(c.headline).toBe("2,000 lines");
    expect(c.body).toBe("Across 40 commits this window");
  });
  it("you_test at 60%", () => {
    const c = m.get("you_test")!;
    expect(c.headline).toBe("You actually test");
    expect(c.body).toBe("60% of your shipping sessions added tests");
  });
  it("every card has a shareText with the attribution tail", () => {
    for (const c of cards) expect(c.shareText).toMatch(/@ccwarriorsxyz/);
  });
});

describe("buildInsightCards — sparse fixture (emit only on real data)", () => {
  // 3 sessions, no commit histograms, no git timing → thin cards must not emit.
  const sessions = [session(), session(), session()].map((s) => ({ ...s, model: null, git: null }));
  const merged = deriveAggregate(sessions, 30);
  const cards = buildInsightCards({ sessions, merged, efficiency: null, archetype: null, pillars: null });
  const m = byKey(cards);

  it("does NOT fabricate ships_on without commitDows", () => {
    expect(m.has("ships_on")).toBe(false);
  });
  it("does NOT fabricate commits_at_night without commitHours", () => {
    expect(m.has("commits_at_night")).toBe(false);
  });
  it("min-data guards suppress thin cards", () => {
    expect(m.has("model")).toBe(false); // <5 with model
    expect(m.has("night_owl")).toBe(false); // <10 sessions
    expect(m.has("plan_mode")).toBe(false); // <5 sessions
    expect(m.has("prompt_length")).toBe(false); // <20 prompts
    expect(m.has("course_correction")).toBe(false); // <5 sessions
    expect(m.has("you_test")).toBe(false); // <5 shipping
    expect(m.has("shipped")).toBe(false); // no commits
    expect(m.has("archetype")).toBe(false); // null archetype
  });
});

describe("buildInsightCards — full commit-timing fixture", () => {
  // commitDows peaked on Friday (index 5), commitHours night-heavy.
  const dows = [1, 0, 2, 1, 1, 8, 1]; // Friday = 8, total 14
  const hours = Array(24).fill(0) as number[];
  hours[23] = 5;
  hours[0] = 4;
  hours[1] = 3; // night = 12
  hours[14] = 2; // total 14, night share 12/14 ≈ 0.857
  const sessions = Array.from({ length: 12 }, () =>
    session({ git: git({ commitHours: hours, commitDows: dows }) }),
  );
  const merged = deriveAggregate(sessions, 30);

  it("ships_on appears with peak weekday and commits_at_night after dark", () => {
    // Single session carries the full histogram so summed totals stay ≥10
    // without multiplying the per-session counts. Use one rich session + guards.
    const one = [session({ git: git({ commitHours: hours, commitDows: dows }) })];
    // Pad to satisfy other guards but keep only one session carrying the timing.
    const padded = [...one, ...Array.from({ length: 11 }, () => session({ git: git({ commitsInWindow: 0 }) }))];
    const cards = buildInsightCards({
      sessions: padded,
      merged: deriveAggregate(padded, 30),
      efficiency: null,
      archetype: null,
      pillars: null,
    });
    const m = byKey(cards);
    expect(m.get("ships_on")?.headline).toBe("Fridays");
    expect(m.get("ships_on")?.body).toBe("Your biggest push lands on Friday");
    const night = m.get("commits_at_night")!;
    expect(night.headline).toBe("After dark");
    expect(night.body).toBe("86% of your commits land between 10 PM and 2 AM");
  });

  it("sums commit histograms across multiple sessions", () => {
    // Each of 12 sessions carries dows totaling 14 → summed total 168, peak Friday.
    const cards = buildInsightCards({ sessions, merged, efficiency: null, archetype: null, pillars: null });
    expect(byKey(cards).get("ships_on")?.headline).toBe("Fridays");
  });
});
