import { describe, it, expect } from "vitest";
import { parseSessionLines, aggregateSessions, type SessionStats } from "../src/insights.js";

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

  it("returns null for empty/attachment-only files", async () => {
    expect(await parseSessionLines([line({ type: "file-history-snapshot" })])).toBeNull();
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
