import { describe, it, expect } from "vitest";
import { apportionWindowCost } from "../../src/lib/coach/apportion.js";
import type { SessionRecord } from "../../src/db/schema.js";

function rec(over: Partial<SessionRecord> = {}): SessionRecord {
  return {
    startHour: 10, durationMinutes: 30, prompts: 4, interrupts: 0, usedPlanMode: false,
    exploreBeforeFirstEdit: false, hadEdits: true, subagentSpawns: 0, maxParallel: 0,
    editCalls: 4, assistantTurns: 8, wordBuckets: { "1-5": 1, "6-10": 0, "11-25": 0, "26+": 0 },
    model: "claude-opus-4-7",
    timing: { events: 9, medianGapMs: 1000, p10GapMs: 100, subSecondFraction: 0 },
    git: null, ...over,
  };
}

describe("apportionWindowCost", () => {
  it("splits a tool's window cost across its sessions by turn weight", () => {
    const sessions = [
      rec({ tool: "claude", assistantTurns: 30 }),
      rec({ tool: "claude", assistantTurns: 10 }),
    ];
    const out = apportionWindowCost(sessions, new Map([["claude", 40]]));
    expect(out[0]!.estimatedCost).toBeCloseTo(30, 5); // 40 * 30/40
    expect(out[1]!.estimatedCost).toBeCloseTo(10, 5); // 40 * 10/40
    expect(out.every((s) => s.tool === "claude")).toBe(true);
  });

  it("defaults a missing tool to claude and isolates cost per tool", () => {
    const sessions = [
      rec({ tool: undefined, assistantTurns: 1 }),   // -> claude
      rec({ tool: "codex", assistantTurns: 1 }),
    ];
    const out = apportionWindowCost(sessions, new Map([["claude", 5], ["codex", 9]]));
    const byTool = Object.fromEntries(out.map((s) => [s.tool, s.estimatedCost]));
    expect(byTool["claude"]).toBeCloseTo(5, 5);
    expect(byTool["codex"]).toBeCloseTo(9, 5);
  });

  it("gives zero cost to a tool with no window usage and floors zero-turn weight", () => {
    const sessions = [rec({ tool: "aider", assistantTurns: 0 }), rec({ tool: "aider", assistantTurns: 0 })];
    const out = apportionWindowCost(sessions, new Map([["aider", 8]]));
    expect(out[0]!.estimatedCost).toBeCloseTo(4, 5); // even split via max(1,turns)
    expect(out[1]!.estimatedCost).toBeCloseTo(4, 5);
    const none = apportionWindowCost([rec({ tool: "gemini", assistantTurns: 5 })], new Map());
    expect(none[0]!.estimatedCost).toBe(0);
  });
});
