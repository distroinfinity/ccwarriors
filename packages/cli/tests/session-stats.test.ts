import { describe, it, expect } from "vitest";
import { blankSessionStats } from "../src/session-stats.js";
import { isValidSessionStats, type SessionStats } from "../src/insights.js";

describe("blankSessionStats", () => {
  it("returns a structurally valid, neutral SessionStats stamped with the tool", () => {
    const s: SessionStats = blankSessionStats("codex");
    expect(isValidSessionStats(s)).toBe(true);
    expect(s.tool).toBe("codex");
    // Neutral defaults — a parser fills only what it can observe.
    expect(s.prompts).toBe(0);
    expect(s.assistantTurns).toBe(0);
    expect(s.hadEdits).toBe(false);
    expect(s.editedFiles).toEqual([]);
    expect(s.eventGapsMs).toEqual([]);
    expect(s.skillsUsed).toEqual({});
    expect(s.cwd).toBeNull();
    expect(s.model).toBeNull();
    expect(s.startMs).toBeNull();
    expect(s.endMs).toBeNull();
  });

  it("re-exports SessionStats from insights for backward-compatible imports", async () => {
    // Importing the type from insights.js must still resolve (re-export).
    const mod = await import("../src/insights.js");
    expect(typeof mod.isValidSessionStats).toBe("function");
  });
});
