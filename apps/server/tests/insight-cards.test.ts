import { describe, it, expect } from "vitest";
import { buildInsightCards, selectDeck, DECK_LIMIT, friendlyModel, type InsightCard } from "../src/lib/insight-cards.js";
import { deriveAggregate } from "../src/lib/deep.js";
import type { SessionRecord, SessionGitOutcome, GithubStats } from "../src/db/schema.js";

function ghStats(over: Partial<GithubStats> = {}): GithubStats {
  return {
    login: "x",
    accountCreatedAt: "2018-03-01T00:00:00Z",
    followers: 10,
    publicRepos: 20,
    totalStars: 340,
    topLanguages: [
      { name: "TypeScript", repos: 9 },
      { name: "Rust", repos: 3 },
      { name: "Go", repos: 2 },
    ],
    mergedPublicPrs: 41,
    reviewsLastYear: 12,
    commitsLastYear: 500,
    contributionsLastYear: 800,
    currentStreakDays: 4,
    longestStreakDays: 30,
    reposContributedTo: 6,
    windowCommits: 25,
    windowPrs: 9,
    ...over,
  };
}

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

describe("buildInsightCards — zero-signal fixture (emit only on real data)", () => {
  // 3 sessions with NO model and NO git: cards whose signal is absent must not
  // emit — but cards whose signal exists (hours, prompts, plan mode) now do,
  // from session #1. Floors are gone; the no-fabrication doctrine is not.
  const sessions = [session(), session(), session()].map((s) => ({ ...s, model: null, git: null }));
  const merged = deriveAggregate(sessions, 30);
  const cards = buildInsightCards({ sessions, merged, efficiency: null, archetype: null, pillars: null });
  const m = byKey(cards);

  it("does NOT fabricate cards whose signal is absent", () => {
    expect(m.has("ships_on")).toBe(false); // no commitDows
    expect(m.has("commits_at_night")).toBe(false); // no commitHours
    expect(m.has("model")).toBe(false); // no session has a model
    expect(m.has("you_test")).toBe(false); // no shipping sessions
    expect(m.has("shipped")).toBe(false); // no commits
    expect(m.has("archetype")).toBe(false); // null archetype
  });
  it("DOES emit cards whose real signal exists at small n", () => {
    expect(m.has("night_owl")).toBe(true); // hour histogram has data
    expect(m.has("plan_mode")).toBe(true); // plan-mode rate is real
    expect(m.has("prompt_length")).toBe(true); // word buckets are real
    expect(m.has("course_correction")).toBe(true); // interrupt rate is real
  });
});

describe("buildInsightCards — single session (bare computable floor)", () => {
  const sessions = [session({ durationMinutes: 95 })];
  const merged = deriveAggregate(sessions, 30);
  const cards = buildInsightCards({
    sessions,
    merged,
    efficiency: null,
    archetype: "The Tactician",
    pillars: null,
  });
  const m = byKey(cards);

  it("emits every card whose signal a single session carries", () => {
    expect(m.has("archetype")).toBe(true);
    expect(m.get("model")?.headline).toBe("You love Opus 4.7");
    expect(m.has("night_owl")).toBe(true);
    expect(m.has("plan_mode")).toBe(true);
    expect(m.has("prompt_length")).toBe(true);
    expect(m.has("course_correction")).toBe(true);
    expect(m.has("agents")).toBe(true);
    expect(m.get("longest_run")?.headline).toBe("1h 35m");
    expect(m.get("shipped")?.body).toBe("Across 2 commits this window");
    expect(m.has("you_test")).toBe(true); // 1 shipping session with tests
  });
  it("still suppresses commit-timing cards without histograms", () => {
    expect(m.has("ships_on")).toBe(false);
    expect(m.has("commits_at_night")).toBe(false);
  });
  it("headlines read sanely at n=1 (real numbers, no fabrication)", () => {
    expect(m.get("you_test")?.body).toBe("100% of your shipping sessions added tests");
    expect(m.get("prompt_length")?.body).toBe("80% of your prompts are under 10 words");
  });
});

describe("buildInsightCards — GitHub cards", () => {
  const base = {
    sessions: [session()],
    merged: deriveAggregate([session()], 30),
    efficiency: null,
    archetype: null,
    pillars: null,
  };

  it("emits the full GitHub strip from a rich footprint", () => {
    const m = byKey(buildInsightCards({ ...base, github: ghStats() }));
    expect(m.get("gh_merged_prs")?.headline).toBe("41 public PRs merged");
    expect(m.get("gh_prs_worked")?.headline).toBe("9 PRs this window");
    expect(m.get("gh_stars")?.stat).toBe("★ 340");
    expect(m.get("gh_languages")?.headline).toBe("Polyglot");
    expect(m.get("gh_languages")?.body).toContain("TypeScript");
    expect(m.get("gh_streak")?.headline).toBe("30-day streak");
    expect(m.get("gh_reviews")?.body).toContain("12");
    expect(m.get("gh_footprint")?.body).toContain("6");
    expect(m.get("gh_veteran")?.headline).toBe("Shipping since 2018");
  });

  it("every gh card self-guards on its own zero", () => {
    const m = byKey(
      buildInsightCards({
        ...base,
        github: ghStats({
          mergedPublicPrs: 0,
          totalStars: 0,
          topLanguages: [],
          longestStreakDays: 1,
          reviewsLastYear: 0,
          reposContributedTo: 0,
          accountCreatedAt: new Date().toISOString(), // brand-new account
        }),
      }),
    );
    for (const k of ["gh_merged_prs", "gh_stars", "gh_languages", "gh_streak", "gh_reviews", "gh_footprint", "gh_veteran"]) {
      expect(m.has(k)).toBe(false);
    }
  });

  it("github: null leaves the deck exactly as before", () => {
    const withNull = buildInsightCards({ ...base, github: null });
    const without = buildInsightCards(base);
    expect(withNull.map((c) => c.key)).toEqual(without.map((c) => c.key));
    expect(withNull.some((c) => c.key.startsWith("gh_"))).toBe(false);
  });

  it("single language is named, not called polyglot", () => {
    const m = byKey(
      buildInsightCards({ ...base, github: ghStats({ topLanguages: [{ name: "Rust", repos: 4 }] }) }),
    );
    expect(m.get("gh_languages")?.headline).toBe("Rust country");
  });
});

describe("buildInsightCards — usage/rhythm/git cards from existing data", () => {
  const efficiency = {
    cacheReadRatio: 0.93,
    opusShare: 0.8,
    modelMix: [
      { family: "opus", share: 0.8 },
      { family: "sonnet", share: 0.2 },
    ],
    grade: "A",
    estSavingsPerMonth: null,
    tokensPerActiveDay: 1000,
  };
  const rhythm = { weekendShare: 0.5, currentStreak: 3, longestStreak: 9, activeDays: 14 };
  const base = {
    sessions: [session()],
    merged: deriveAggregate([session()], 30),
    efficiency: null,
    archetype: null,
    pillars: null,
  };

  it("cache_warm from the cache-read ratio", () => {
    const m = byKey(buildInsightCards({ ...base, efficiency }));
    expect(m.get("cache_warm")?.headline).toBe("93% from cache");
  });
  it("model_mix needs at least two families", () => {
    const m = byKey(buildInsightCards({ ...base, efficiency }));
    expect(m.get("model_mix")?.headline).toBe("2 models in rotation");
    const single = byKey(
      buildInsightCards({ ...base, efficiency: { ...efficiency, modelMix: [{ family: "opus", share: 1 }] } }),
    );
    expect(single.has("model_mix")).toBe(false);
  });
  it("weekend_warrior flips its headline above 40% weekend share", () => {
    const hot = byKey(buildInsightCards({ ...base, rhythm }));
    expect(hot.get("weekend_warrior")?.headline).toBe("Weekend warrior");
    const cool = byKey(buildInsightCards({ ...base, rhythm: { ...rhythm, weekendShare: 0.1 } }));
    expect(cool.get("weekend_warrior")?.headline).toBe("Weekdays do the work");
    const zero = byKey(buildInsightCards({ ...base, rhythm: { ...rhythm, weekendShare: 0 } }));
    expect(zero.has("weekend_warrior")).toBe(false);
  });
  it("grind_streak from the longest active-day run", () => {
    const m = byKey(buildInsightCards({ ...base, rhythm }));
    expect(m.get("grind_streak")?.headline).toBe("9 days straight");
    const one = byKey(buildInsightCards({ ...base, rhythm: { ...rhythm, longestStreak: 1 } }));
    expect(one.has("grind_streak")).toBe(false);
  });
  it("marathoner classifies by mean session length", () => {
    const long = [session({ durationMinutes: 120 })];
    const m = byKey(buildInsightCards({ ...base, sessions: long, merged: deriveAggregate(long, 30) }));
    expect(m.get("marathoner")?.headline).toBe("Marathoner");
    const short = [session({ durationMinutes: 10 })];
    const s = byKey(buildInsightCards({ ...base, sessions: short, merged: deriveAggregate(short, 30) }));
    expect(s.get("marathoner")?.headline).toBe("Sprinter");
  });
  it("explore_first only when the ratio is real", () => {
    const m = byKey(buildInsightCards(base)); // session() explores before editing
    expect(m.get("explore_first")?.headline).toBe("You read before you write");
    const blind = [session({ exploreBeforeFirstEdit: false })];
    const b = byKey(buildInsightCards({ ...base, sessions: blind, merged: deriveAggregate(blind, 30) }));
    expect(b.has("explore_first")).toBe(false);
  });
  it("ai_commits counts agent-linked commits", () => {
    const m = byKey(buildInsightCards(base)); // git() has aiLinkedCommits: 2
    expect(m.get("ai_commits")?.body).toContain("2");
    const unlinked = [session({ git: git({ aiLinkedCommits: 0 }) })];
    const u = byKey(buildInsightCards({ ...base, sessions: unlinked, merged: deriveAggregate(unlinked, 30) }));
    expect(u.has("ai_commits")).toBe(false);
  });
  it("local_repos needs at least two distinct repos", () => {
    const two = [session({ git: git({ repoIdHash: "ra" }) }), session({ git: git({ repoIdHash: "rb" }) })];
    const m = byKey(buildInsightCards({ ...base, sessions: two, merged: deriveAggregate(two, 30) }));
    expect(m.get("local_repos")?.headline).toBe("2 repos deep");
    expect(byKey(buildInsightCards(base)).has("local_repos")).toBe(false);
  });
  it("clean_history when rebases or squash merges show up", () => {
    const tidy = [session({ git: git({ rebaseDetected: true }) })];
    const m = byKey(buildInsightCards({ ...base, sessions: tidy, merged: deriveAggregate(tidy, 30) }));
    expect(m.get("clean_history")?.headline).toBe("You curate history");
    expect(byKey(buildInsightCards(base)).has("clean_history")).toBe(false);
  });
});

describe("buildInsightCards — Paxel-parity cards (new deep signals)", () => {
  const base = {
    sessions: [session()],
    merged: deriveAggregate([session()], 30),
    efficiency: null,
    archetype: null,
    pillars: null,
  };
  const enriched = (over: Partial<SessionRecord> = {}) =>
    session({ thankYous: 1, wordTotal: 24, recovery: { loops: 0, medianBreakoutMs: 0 }, extensions: { ts: 3 }, ...over });

  it("total_hours sums session durations", () => {
    const sessions = [session({ durationMinutes: 120 }), session({ durationMinutes: 60 }), session({ durationMinutes: 45 })];
    const m = byKey(buildInsightCards({ ...base, sessions, merged: deriveAggregate(sessions, 30) }));
    const c = m.get("total_hours")!;
    expect(c.headline).toBe("3.8 hours");
    expect(c.body).toBe("Across 3 sessions this window");
  });

  it("dialogue classifies the working style", () => {
    const chatty = [session({ prompts: 8, assistantTurns: 24 })];
    const m = byKey(buildInsightCards({ ...base, sessions: chatty, merged: deriveAggregate(chatty, 30) }));
    expect(m.get("dialogue")?.headline).toBe("A back-and-forth");
    const fire = [session({ prompts: 1, assistantTurns: 40 })];
    const f = byKey(buildInsightCards({ ...base, sessions: fire, merged: deriveAggregate(fire, 30) }));
    expect(f.get("dialogue")?.headline).toBe("Fire and forget");
  });

  it("burst_profile detects burst builders and deep divers", () => {
    const bursts = Array.from({ length: 4 }, () => session({ durationMinutes: 8 }));
    const m = byKey(buildInsightCards({ ...base, sessions: bursts, merged: deriveAggregate(bursts, 30) }));
    expect(m.get("burst_profile")?.headline).toBe("Burst builder");
    const deep = [session({ durationMinutes: 200, interrupts: 0 }), session({ durationMinutes: 150, interrupts: 0 })];
    const d = byKey(buildInsightCards({ ...base, sessions: deep, merged: deriveAggregate(deep, 30) }));
    expect(d.get("burst_profile")?.headline).toBe("Deep diver");
  });

  it("thank_yous emits only when the signal exists", () => {
    const polite = [enriched({ thankYous: 4 }), enriched({ thankYous: 2 })];
    const m = byKey(buildInsightCards({ ...base, sessions: polite, merged: deriveAggregate(polite, 30) }));
    expect(m.get("thank_yous")?.headline).toBe("6 thank-yous");
    // Old payloads (field absent) → no card, never a fabricated zero.
    expect(byKey(buildInsightCards(base)).has("thank_yous")).toBe(false);
    const rude = [enriched({ thankYous: 0 })];
    expect(byKey(buildInsightCards({ ...base, sessions: rude, merged: deriveAggregate(rude, 30) })).has("thank_yous")).toBe(false);
  });

  it("avg_prompt_words from exact word totals", () => {
    const sessions = [enriched({ wordTotal: 100, prompts: 4 }), enriched({ wordTotal: 60, prompts: 4 })];
    const m = byKey(buildInsightCards({ ...base, sessions, merged: deriveAggregate(sessions, 30) }));
    expect(m.get("avg_prompt_words")?.headline).toBe("20 words per prompt");
  });

  it("recovery emits on real breakout signal", () => {
    const stuck = [enriched({ recovery: { loops: 2, medianBreakoutMs: 4 * 60_000 } }), enriched({ recovery: { loops: 1, medianBreakoutMs: 2 * 60_000 } })];
    const m = byKey(buildInsightCards({ ...base, sessions: stuck, merged: deriveAggregate(stuck, 30) }));
    const c = m.get("recovery")!;
    expect(c.headline).toBe("3 error loops broken");
    expect(byKey(buildInsightCards(base)).has("recovery")).toBe(false);
  });

  it("breadth_local from edited file extensions", () => {
    const poly = [enriched({ extensions: { ts: 10, py: 4, css: 2 } })];
    const m = byKey(buildInsightCards({ ...base, sessions: poly, merged: deriveAggregate(poly, 30) }));
    expect(m.get("breadth_local")?.headline).toBe("3 languages this window");
    const mono = [enriched({ extensions: { ts: 10 } })];
    expect(byKey(buildInsightCards({ ...base, sessions: mono, merged: deriveAggregate(mono, 30) })).has("breadth_local")).toBe(false);
  });

  it("fixes_features splits commit kinds", () => {
    const sessions = [
      session({ git: git({ commitKinds: { fixes: 2, features: 5, refactors: 1, other: 0 } }) }),
      session({ git: git({ commitKinds: { fixes: 1, features: 2, refactors: 0, other: 1 } }) }),
    ];
    const m = byKey(buildInsightCards({ ...base, sessions, merged: deriveAggregate(sessions, 30) }));
    const c = m.get("fixes_features")!;
    expect(c.headline).toBe("Mostly features");
    expect(c.body).toBe("7 features and 3 fixes in your commits");
  });

  it("first_try measures clean shipped sessions", () => {
    const sessions = [
      session({ interrupts: 0, git: git({ commitsInWindow: 1, revertedLinesWithin14d: 0 }) }),
      session({ interrupts: 0, git: git({ commitsInWindow: 1, revertedLinesWithin14d: 0 }) }),
      session({ interrupts: 3, git: git({ commitsInWindow: 1, revertedLinesWithin14d: 50 }) }),
    ];
    const m = byKey(buildInsightCards({ ...base, sessions, merged: deriveAggregate(sessions, 30) }));
    const c = m.get("first_try")!;
    expect(c.headline).toBe("Lands it first try");
    expect(c.body).toContain("67%");
  });

  it("task_model_fit needs two model families and enough sessions", () => {
    const sessions = [
      session({ model: "claude-opus-4-8", editCalls: 30, assistantTurns: 60 }),
      session({ model: "claude-opus-4-8", editCalls: 25, assistantTurns: 50 }),
      session({ model: "claude-haiku-4-5", editCalls: 2, assistantTurns: 5 }),
      session({ model: "claude-haiku-4-5", editCalls: 1, assistantTurns: 4 }),
    ];
    const m = byKey(buildInsightCards({ ...base, sessions, merged: deriveAggregate(sessions, 30) }));
    expect(m.get("task_model_fit")?.headline).toBe("Right blade for the fight");
    expect(byKey(buildInsightCards(base)).has("task_model_fit")).toBe(false);
  });

  it("max_concurrent and go_to_prompt come from payload extras", () => {
    const m = byKey(
      buildInsightCards({
        ...base,
        extras: { maxConcurrentSessions: 12, topPrompt: { text: "implement the plan", count: 6, sessions: 3 } },
      }),
    );
    expect(m.get("max_concurrent")?.headline).toBe("12 at once");
    const go = m.get("go_to_prompt")!;
    expect(go.headline).toBe("“implement the plan”");
    expect(go.body).toBe("You sent it 6 times across 3 sessions");
    // 1 concurrent session is just... a session.
    const single = byKey(buildInsightCards({ ...base, extras: { maxConcurrentSessions: 1 } }));
    expect(single.has("max_concurrent")).toBe(false);
    expect(single.has("go_to_prompt")).toBe(false);
  });
});

describe("selectDeck — curation layer (Wrapped-sized, not everything-bagel)", () => {
  function fullDeck() {
    const sessions = Array.from({ length: 12 }, (_, i) =>
      session({
        durationMinutes: i === 0 ? 120 : 8, // burst-heavy + one long
        git: git({
          repoIdHash: i % 2 ? "ra" : "rb",
          rebaseDetected: i === 0,
          commitKinds: { fixes: 1, features: 2, refactors: 0, other: 0 },
          commitHours: (() => { const h = Array(24).fill(0) as number[]; h[23] = 1; return h; })(),
          commitDows: [0, 0, 0, 0, 0, 1, 0],
        }),
        thankYous: 1,
        wordTotal: 30,
        recovery: { loops: 1, medianBreakoutMs: 120000 },
        extensions: { ts: 4, py: 2 },
      }),
    );
    return buildInsightCards({
      sessions,
      merged: deriveAggregate(sessions, 30),
      efficiency: {
        cacheReadRatio: 0.9,
        opusShare: 0.7,
        modelMix: [{ family: "opus", share: 0.7 }, { family: "sonnet", share: 0.3 }],
        grade: "A",
        estSavingsPerMonth: null,
        tokensPerActiveDay: 1000,
      },
      archetype: "The Tactician",
      pillars: { direction: 50 },
      github: ghStats(),
      rhythm: { weekendShare: 0.5, currentStreak: 2, longestStreak: 5, activeDays: 10 },
      extras: { maxConcurrentSessions: 6, topPrompt: { text: "implement the plan", count: 6, sessions: 3 } },
    });
  }

  it("caps a maximal deck at DECK_LIMIT", () => {
    const all = fullDeck();
    expect(all.length).toBeGreaterThan(20); // the bagel exists pre-selection
    const picked = selectDeck(all, []);
    expect(picked.length).toBeLessThanOrEqual(DECK_LIMIT);
  });

  it("keeps the headliners and drops near-duplicates", () => {
    const keys = selectDeck(fullDeck(), []).map((c) => c.key);
    for (const must of ["archetype", "go_to_prompt", "total_hours", "max_concurrent"]) {
      expect(keys).toContain(must);
    }
    // One per dedupe family, never both.
    expect(keys.includes("model") && keys.includes("model_mix")).toBe(false);
    expect(keys.includes("avg_prompt_words") && keys.includes("prompt_length")).toBe(false);
    expect(keys.includes("burst_profile") && keys.includes("marathoner")).toBe(false);
    expect(keys.includes("night_owl") && keys.includes("commits_at_night")).toBe(false);
    expect(keys.includes("gh_streak") && keys.includes("grind_streak")).toBe(false);
  });

  it("pinned cards bypass both the cap and the dedupe", () => {
    const picked = selectDeck(fullDeck(), ["model_mix", "marathoner"]);
    const keys = picked.map((c) => c.key);
    expect(keys).toContain("model_mix");
    expect(keys).toContain("marathoner");
    expect(picked.length).toBeLessThanOrEqual(DECK_LIMIT + 2);
  });

  it("preserves the original deck order and passes small decks through", () => {
    const all = fullDeck();
    const picked = selectDeck(all, []);
    const indices = picked.map((c) => all.findIndex((a) => a.key === c.key));
    expect([...indices].sort((a, b) => a - b)).toEqual(indices);
    const tiny = all.slice(0, 3);
    expect(selectDeck(tiny, [])).toEqual(tiny);
  });
});

describe("buildInsightCards — kitchen sink", () => {
  it("a fully-populated input emits each key exactly once, in deck order", () => {
    const sessions = Array.from({ length: 12 }, (_, i) =>
      session({
        git: git({
          repoIdHash: i % 2 ? "ra" : "rb",
          rebaseDetected: i === 0,
          commitHours: (() => {
            const h = Array(24).fill(0) as number[];
            h[23] = 1;
            return h;
          })(),
          commitDows: [0, 0, 0, 0, 0, 1, 0],
        }),
      }),
    );
    const cards = buildInsightCards({
      sessions,
      merged: deriveAggregate(sessions, 30),
      efficiency: {
        cacheReadRatio: 0.9,
        opusShare: 0.7,
        modelMix: [
          { family: "opus", share: 0.7 },
          { family: "sonnet", share: 0.3 },
        ],
        grade: "A",
        estSavingsPerMonth: null,
        tokensPerActiveDay: 1000,
      },
      archetype: "The Tactician",
      pillars: { direction: 50 },
      github: ghStats(),
      rhythm: { weekendShare: 0.5, currentStreak: 2, longestStreak: 5, activeDays: 10 },
    });
    const keys = cards.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length); // each at most once
    // Behavioral cards lead, GitHub strip follows, usage/rhythm close.
    expect(keys.indexOf("archetype")).toBe(0);
    expect(keys.indexOf("gh_merged_prs")).toBeGreaterThan(keys.indexOf("you_test"));
    expect(keys.indexOf("cache_warm")).toBeGreaterThan(keys.indexOf("gh_veteran"));
    for (const k of ["marathoner", "explore_first", "ai_commits", "local_repos", "clean_history", "weekend_warrior", "grind_streak"]) {
      expect(keys).toContain(k);
    }
  });
});

describe("buildInsightCards — commit-timing cards at bare floor", () => {
  it("emits ships_on and commits_at_night from a single commit's histograms", () => {
    const dows = [0, 0, 0, 0, 0, 1, 0]; // one Friday commit
    const hours = Array(24).fill(0) as number[];
    hours[23] = 1;
    const one = [session({ git: git({ commitHours: hours, commitDows: dows, commitsInWindow: 1 }) })];
    const cards = buildInsightCards({
      sessions: one,
      merged: deriveAggregate(one, 30),
      efficiency: null,
      archetype: null,
      pillars: null,
    });
    const m = byKey(cards);
    expect(m.get("ships_on")?.headline).toBe("Fridays");
    expect(m.get("commits_at_night")?.headline).toBe("After dark");
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

describe("buildInsightCards — outcome_per_dollar card", () => {
  const base = {
    sessions: [session()],
    merged: deriveAggregate([session()], 30),
    efficiency: null,
    archetype: null,
    pillars: null,
  };

  it("emits when both ratios are non-null (costPerSurvivingLoc preferred)", () => {
    const m = byKey(
      buildInsightCards({
        ...base,
        economics: {
          survivingLoc: 200,
          shippedCommits: 10,
          windowCostUsd: 50,
          costPerSurvivingLoc: 0.25,
          commitsPer100Usd: 20.0,
        },
      }),
    );
    const c = m.get("outcome_per_dollar")!;
    expect(c).toBeDefined();
    expect(c.question).toBe("What does a dollar buy?");
    expect(c.headline).toBe("$0.25 per surviving line");
    expect(c.stat).toBe("$0.25");
    expect(c.body).toContain("20 commits per $100");
    expect(c.body).toContain("200");
    expect(c.shareText).toMatch(/@ccwarriorsxyz/);
  });

  it("falls back to commitsPer100Usd headline when costPerSurvivingLoc is null", () => {
    const m = byKey(
      buildInsightCards({
        ...base,
        economics: {
          survivingLoc: 10, // below 50 threshold
          shippedCommits: 5,
          windowCostUsd: 20,
          costPerSurvivingLoc: null,
          commitsPer100Usd: 25.0,
        },
      }),
    );
    const c = m.get("outcome_per_dollar")!;
    expect(c).toBeDefined();
    expect(c.headline).toBe("25 commits per $100");
    expect(c.stat).toBe("25");
  });

  it("does NOT emit when both ratios are null (below thresholds)", () => {
    const m = byKey(
      buildInsightCards({
        ...base,
        economics: {
          survivingLoc: 10,
          shippedCommits: 2,
          windowCostUsd: 0.5,
          costPerSurvivingLoc: null,
          commitsPer100Usd: null,
        },
      }),
    );
    expect(m.has("outcome_per_dollar")).toBe(false);
  });

  it("does NOT emit when economics is null (no deep data)", () => {
    const m = byKey(buildInsightCards({ ...base, economics: null }));
    expect(m.has("outcome_per_dollar")).toBe(false);
  });

  it("does NOT emit when economics is absent (older caller)", () => {
    const m = byKey(buildInsightCards(base));
    expect(m.has("outcome_per_dollar")).toBe(false);
  });

  it("formats sub-cent costPerSurvivingLoc without losing precision", () => {
    const m = byKey(
      buildInsightCards({
        ...base,
        economics: {
          survivingLoc: 300,
          shippedCommits: 5,
          windowCostUsd: 1,
          costPerSurvivingLoc: 0.0033,
          commitsPer100Usd: null,
        },
      }),
    );
    const c = m.get("outcome_per_dollar")!;
    expect(c.headline).toBe("$0.0033 per surviving line");
  });
});
