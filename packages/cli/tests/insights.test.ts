import { describe, it, expect } from "vitest";
import { parseSessionLines, aggregateSessions, timingSummary, isValidSessionStats, type SessionStats } from "../src/insights.js";

const line = (o: object) => JSON.stringify(o);

describe("parseSessionLines", () => {
  it("counts prompts, plan mode, interrupts, tools", async () => {
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
    const s = (await parseSessionLines(lines))!;
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

  it("captures cwd, gitBranch, model (most-frequent), editedFiles, startMs/endMs, gaps", async () => {
    const lines = [
      line({ type: "user", message: { content: "start the work please now" }, cwd: "/home/me/proj", gitBranch: "feature/x", timestamp: "2026-06-07T22:10:00.000Z" }),
      line({ type: "assistant", message: { model: "claude-opus-4-7", content: [{ type: "tool_use", name: "Edit", input: { file_path: "/home/me/proj/a.ts" } }] }, cwd: "/home/me/proj", gitBranch: "feature/x", timestamp: "2026-06-07T22:10:00.500Z" }),
      line({ type: "assistant", message: { model: "claude-opus-4-7", content: [{ type: "tool_use", name: "Write", input: { file_path: "/home/me/proj/b.ts" } }, { type: "tool_use", name: "Edit", input: { file_path: "/home/me/proj/a.ts" } }] }, timestamp: "2026-06-07T22:10:30.000Z" }),
      line({ type: "assistant", message: { model: "claude-sonnet-4-5", content: [{ type: "text", text: "hmm" }] }, timestamp: "2026-06-07T22:11:30.000Z" }),
    ];
    const s = (await parseSessionLines(lines))!;
    expect(s.cwd).toBe("/home/me/proj");
    expect(s.gitBranch).toBe("feature/x");
    expect(s.model).toBe("claude-opus-4-7"); // 2 turns vs sonnet's 1
    expect(s.editedFiles.sort()).toEqual(["/home/me/proj/a.ts", "/home/me/proj/b.ts"]); // deduped
    expect(s.startMs).toBe(new Date("2026-06-07T22:10:00.000Z").getTime());
    expect(s.endMs).toBe(new Date("2026-06-07T22:11:30.000Z").getTime());
    // gaps: 500ms, 29500ms, 60000ms
    expect(s.eventGapsMs).toEqual([500, 29_500, 60_000]);
  });

  it("returns null for empty/attachment-only files", async () => {
    expect(await parseSessionLines([line({ type: "file-history-snapshot" })])).toBeNull();
  });

  it("tags tool=claude and counts Skill invocations by name (never args)", async () => {
    const lines = [
      line({ type: "user", message: { content: "use tdd to add the parser" }, timestamp: "2026-06-07T09:00:00.000Z" }),
      line({
        type: "assistant",
        message: {
          model: "claude-opus-4-8",
          content: [
            { type: "tool_use", name: "Skill", input: { skill: "test-driven-development", args: "secret args" } },
            { type: "tool_use", name: "Skill", input: { skill: "test-driven-development" } },
            { type: "tool_use", name: "Skill", input: { skill: "brainstorming" } },
          ],
        },
        timestamp: "2026-06-07T09:00:05.000Z",
      }),
    ];
    const s = (await parseSessionLines(lines))!;
    expect(s.tool).toBe("claude");
    expect(s.skillSpawns).toBe(3);
    expect(s.skillsUsed).toEqual({ "test-driven-development": 2, brainstorming: 1 });
    // Skill ARGS must never be captured anywhere in the stats.
    expect(JSON.stringify(s)).not.toContain("secret args");
  });

  it("joins only string text blocks across a multi-block prompt", async () => {
    const s = (await parseSessionLines([
      line({
        type: "user",
        message: { content: [{ type: "text", text: "two words" }, { type: "text" }, { type: "image" }] },
        timestamp: "2026-06-07T10:00:00.000Z",
      }),
    ]))!;
    expect(s.prompts).toBe(1);
    expect(s.wordBuckets["1-5"]).toBe(1); // "two words" — no "undefined" inflation
  });
});

describe("aggregateSessions", () => {
  it("builds the payload shape", () => {
    const s: SessionStats = {
      prompts: 10, interrupts: 1, usedPlanMode: true, exploreBeforeFirstEdit: true, hadEdits: true,
      subagentSpawns: 2, maxParallel: 2, editCalls: 12, assistantTurns: 40, startHour: 14,
      durationMinutes: 60, wordBuckets: { "1-5": 4, "6-10": 3, "11-25": 2, "26+": 1 },
      startMs: null, endMs: null, cwd: null, gitBranch: null, model: null, editedFiles: [], eventGapsMs: [],
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

describe("timingSummary", () => {
  it("returns zeros for fewer than 2 events", () => {
    expect(timingSummary([])).toEqual({ events: 1, medianGapMs: 0, p10GapMs: 0, subSecondFraction: 0 });
  });

  it("computes median, p10 and sub-second fraction", () => {
    // 10 gaps: nine at 100ms (sub-second) and one at 5000ms.
    const gaps = [100, 100, 100, 100, 100, 100, 100, 100, 100, 5000];
    const t = timingSummary(gaps);
    expect(t.events).toBe(11); // gaps + 1
    expect(t.medianGapMs).toBe(100);
    expect(t.p10GapMs).toBe(100);
    expect(t.subSecondFraction).toBe(0.9); // 9 of 10 below 1000ms
  });

  it("median takes the lower-middle on sorted gaps", () => {
    const t = timingSummary([3000, 1000, 2000]); // sorted: 1000,2000,3000
    expect(t.medianGapMs).toBe(2000);
    expect(t.subSecondFraction).toBe(0);
  });
});

describe("isValidSessionStats", () => {
  it("accepts a full stats object and rejects one missing the new tool/skill fields", async () => {
    const full = (await parseSessionLines([
      line({ type: "user", message: { content: "do the thing now please" }, timestamp: "2026-06-07T09:00:00.000Z" }),
    ]))!;
    expect(isValidSessionStats(full)).toBe(true);

    const stale: Record<string, unknown> = { ...full };
    delete stale["tool"];
    delete stale["skillSpawns"];
    delete stale["skillsUsed"];
    expect(isValidSessionStats(stale)).toBe(false);
  });
});
