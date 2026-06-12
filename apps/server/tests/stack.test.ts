import { describe, it, expect } from "vitest";
import { buildStack } from "../src/lib/stack.js";
import type { SessionRecord, GithubStats } from "../src/db/schema.js";

function makeSession(extensions: Record<string, number>): SessionRecord {
  return {
    startHour: 9,
    durationMinutes: 30,
    prompts: 2,
    interrupts: 0,
    usedPlanMode: false,
    exploreBeforeFirstEdit: false,
    hadEdits: true,
    subagentSpawns: 0,
    maxParallel: 1,
    editCalls: 3,
    assistantTurns: 5,
    wordBuckets: { "1-5": 1, "6-10": 1, "11-25": 0, "26+": 0 },
    model: "claude-opus-4-8",
    timing: { events: 5, medianGapMs: 800, p10GapMs: 100, subSecondFraction: 0.1 },
    git: null,
    extensions,
  };
}

describe("buildStack", () => {
  it("folds extensions across sessions and computes shares", () => {
    const sessions = [
      makeSession({ ts: 100, js: 50 }),
      makeSession({ ts: 100, py: 50 }),
    ];
    const result = buildStack(sessions, null, null);
    expect(result).not.toBeNull();
    const langs = result!.languages;
    // ts: 200, js: 50 → TypeScript, JavaScript, Python: total 300
    const ts = langs.find((l) => l.name === "TypeScript")!;
    const js = langs.find((l) => l.name === "JavaScript")!;
    const py = langs.find((l) => l.name === "Python")!;
    expect(ts.share).toBe(Math.round((200 / 300) * 100));
    expect(js.share).toBe(Math.round((50 / 300) * 100));
    expect(py.share).toBe(Math.round((50 / 300) * 100));
    // sorted descending
    expect(langs.at(0)?.name).toBe("TypeScript");
  });

  it("omits unknown extensions", () => {
    const sessions = [makeSession({ ts: 80, xyz: 200, abc: 999 })];
    const result = buildStack(sessions, null, null);
    expect(result).not.toBeNull();
    const langs = result!.languages;
    // only TypeScript should appear — xyz and abc are unknown
    expect(langs).toHaveLength(1);
    expect(langs.at(0)?.name).toBe("TypeScript");
    expect(langs.at(0)?.share).toBe(100);
  });

  it("caps at top 6 languages", () => {
    // 8 different known extensions
    const extensions: Record<string, number> = {
      ts: 100, py: 90, rs: 80, go: 70, rb: 60, java: 50, kt: 40, swift: 30,
    };
    const sessions = [makeSession(extensions)];
    const result = buildStack(sessions, null, null);
    expect(result!.languages).toHaveLength(6);
    // top 6 in desc order: ts, py, rs, go, rb, java
    expect(result!.languages.at(0)?.name).toBe("TypeScript");
    expect(result!.languages.at(5)?.name).toBe("Java");
  });

  it("maps tsx and ts both to TypeScript (counts merged)", () => {
    const sessions = [makeSession({ ts: 60, tsx: 40 })];
    const result = buildStack(sessions, null, null);
    expect(result!.languages).toHaveLength(1);
    expect(result!.languages.at(0)?.name).toBe("TypeScript");
    expect(result!.languages.at(0)?.share).toBe(100);
  });

  it("passes through modelMix top 3", () => {
    const modelMix = [
      { family: "opus", share: 0.8 },
      { family: "sonnet", share: 0.15 },
      { family: "haiku", share: 0.04 },
      { family: "other", share: 0.01 },
    ];
    const result = buildStack(null, modelMix, null);
    // no sessions/gh but modelMix present — non-null
    expect(result).not.toBeNull();
    expect(result!.models).toHaveLength(3);
    expect(result!.models.at(0)?.family).toBe("opus");
    expect(result!.models.at(2)?.family).toBe("haiku");
  });

  it("passes through ghLanguages top 3", () => {
    const github = {
      topLanguages: [
        { name: "TypeScript", repos: 10 },
        { name: "Rust", repos: 5 },
        { name: "Python", repos: 3 },
        { name: "Go", repos: 1 },
      ],
    } as unknown as GithubStats;
    const result = buildStack(null, null, github);
    expect(result).not.toBeNull();
    expect(result!.ghLanguages).toEqual(["TypeScript", "Rust", "Python"]);
  });

  it("returns null when ALL three sources are empty", () => {
    expect(buildStack(null, null, null)).toBeNull();
    expect(buildStack([], [], null)).toBeNull();
    expect(buildStack([], null, { topLanguages: [] } as unknown as GithubStats)).toBeNull();
  });

  it("returns null when sessions have no extensions", () => {
    const sessions = [makeSession({})];
    const result = buildStack(sessions, null, null);
    expect(result).toBeNull();
  });

  it("returns non-null when only ghLanguages are present", () => {
    const github = { topLanguages: [{ name: "Go", repos: 2 }] } as unknown as GithubStats;
    const result = buildStack(null, null, github);
    expect(result).not.toBeNull();
    expect(result!.ghLanguages).toEqual(["Go"]);
    expect(result!.languages).toHaveLength(0);
    expect(result!.models).toHaveLength(0);
  });
});
