import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// New deep-mode signals (Paxel parity + #52): politeness, exact word counts,
// error-loop recovery, file-extension breadth, concurrent sessions, and the
// go-to prompt (the first TEXT that ever leaves the machine — redacted, short,
// and only under consent v2).

let cleanup: string[] = [];

beforeEach(() => {
  cleanup = [];
  vi.resetModules();
});

afterEach(() => {
  for (const dir of cleanup) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
  delete process.env["CCWARRIORS_CLAUDE_DIR"];
  delete process.env["CCWARRIORS_HOME"];
});

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanup.push(dir);
  return dir;
}

const ts = (minAgo: number) => new Date(Date.now() - minAgo * 60_000).toISOString();

function user(content: unknown, minAgo: number): string {
  return JSON.stringify({ type: "user", message: { content }, timestamp: ts(minAgo) });
}
function assistant(blocks: unknown[], minAgo: number): string {
  return JSON.stringify({ type: "assistant", message: { model: "claude-opus-4-7", content: blocks }, timestamp: ts(minAgo) });
}
function toolResult(isError: boolean, minAgo: number): string {
  return JSON.stringify({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: isError, content: "x" }] },
    timestamp: ts(minAgo),
  });
}

describe("parseSessionLines — new signals", () => {
  it("counts thank-yous and total prompt words", async () => {
    const { parseSessionLines } = await import("../src/insights.js");
    const stats = (await parseSessionLines([
      user("thanks, that worked perfectly", 30),
      assistant([{ type: "text", text: "ok" }], 29),
      user("now refactor the auth module please", 28),
      assistant([{ type: "text", text: "ok" }], 27),
      user("thank you!", 26),
    ]))!;
    expect(stats.thankYous).toBe(2);
    expect(stats.wordTotal).toBe(4 + 6 + 2); // words per prompt summed
  });

  it("detects error loops and median breakout time (recovery)", async () => {
    const { parseSessionLines } = await import("../src/insights.js");
    // 3 consecutive error tool_results starting 60min ago, broken out 50min ago
    // by a successful result → one loop, breakout ≈ 10min.
    const stats = (await parseSessionLines([
      user("run the tests", 61),
      toolResult(true, 60),
      assistant([{ type: "text", text: "retry" }], 58),
      toolResult(true, 56),
      assistant([{ type: "text", text: "retry again" }], 54),
      toolResult(true, 52),
      toolResult(false, 50),
      assistant([{ type: "text", text: "fixed" }], 49),
    ]))!;
    expect(stats.recoveryLoops).toBe(1);
    expect(stats.recoveryBreakoutMs.length).toBe(1);
    expect(stats.recoveryBreakoutMs[0]).toBeGreaterThan(9 * 60_000);
    expect(stats.recoveryBreakoutMs[0]).toBeLessThan(11 * 60_000);
  });

  it("two errors in a row are not a loop; three are", async () => {
    const { parseSessionLines } = await import("../src/insights.js");
    const two = (await parseSessionLines([
      user("go", 30),
      toolResult(true, 29),
      toolResult(true, 28),
      toolResult(false, 27),
    ]))!;
    expect(two.recoveryLoops).toBe(0);
    const three = (await parseSessionLines([
      user("go", 30),
      toolResult(true, 29),
      toolResult(true, 28),
      toolResult(true, 27),
      user("stop, let me look", 26),
    ]))!;
    expect(three.recoveryLoops).toBe(1);
  });

  it("collects a file-extension histogram from agent edits", async () => {
    const { parseSessionLines } = await import("../src/insights.js");
    const stats = (await parseSessionLines([
      user("build it", 30),
      assistant(
        [
          { type: "tool_use", name: "Edit", input: { file_path: "/p/src/app.ts" } },
          { type: "tool_use", name: "Write", input: { file_path: "/p/src/db.ts" } },
          { type: "tool_use", name: "Edit", input: { file_path: "/p/scripts/run.py" } },
          { type: "tool_use", name: "Edit", input: { file_path: "/p/Makefile" } },
        ],
        29,
      ),
    ]))!;
    expect(stats.extensions).toEqual({ ts: 2, py: 1 }); // extensionless files skipped
  });

  it("collects short prompts as go-to candidates (LOCAL-ONLY until consent v2)", async () => {
    const { parseSessionLines } = await import("../src/insights.js");
    const long = "x".repeat(120);
    const stats = (await parseSessionLines([
      user("implement the plan", 30),
      assistant([{ type: "text", text: "ok" }], 29),
      user(long, 28),
      assistant([{ type: "text", text: "ok" }], 27),
      user("implement the plan", 26),
    ]))!;
    expect(stats.shortPrompts).toEqual(["implement the plan", "implement the plan"]);
  });
});

describe("aggregate-level signals", () => {
  function writeSession(projects: string, name: string, lines: string[]): void {
    const dir = join(projects, "proj");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), lines.join("\n") + "\n");
  }

  it("maxConcurrentSessions counts overlapping session windows", async () => {
    const projects = tmp("ccw-sig-projects-");
    const home = tmp("ccw-sig-home-");
    // Three sessions: A 100→40min ago, B 80→60min ago (inside A), C 30→10min ago (no overlap).
    writeSession(projects, "a.jsonl", [user("a start", 100), assistant([{ type: "text", text: "ok" }], 40)]);
    writeSession(projects, "b.jsonl", [user("b start", 80), assistant([{ type: "text", text: "ok" }], 60)]);
    writeSession(projects, "c.jsonl", [user("c start", 30), assistant([{ type: "text", text: "ok" }], 10)]);
    process.env["CCWARRIORS_CLAUDE_DIR"] = projects;
    process.env["CCWARRIORS_HOME"] = home;

    const { collectDeepInsights } = await import("../src/insights.js");
    const result = await collectDeepInsights("salt", { textExtracts: true });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");
    expect(result.payload.maxConcurrentSessions).toBe(2);
  });

  it("finds the go-to prompt with count, only under textExtracts consent", async () => {
    const projects = tmp("ccw-sig-projects-");
    const home = tmp("ccw-sig-home-");
    const fave = (n: number, offset: number) =>
      writeSession(projects, `s${offset}.jsonl`, [
        user("implement the plan", 100 - offset),
        assistant([{ type: "text", text: "ok" }], 99 - offset),
        ...(n > 1 ? [user("implement the plan", 98 - offset), assistant([{ type: "text", text: "ok" }], 97 - offset)] : []),
      ]);
    fave(2, 0);
    fave(1, 10);
    process.env["CCWARRIORS_CLAUDE_DIR"] = projects;
    process.env["CCWARRIORS_HOME"] = home;

    const { collectDeepInsights } = await import("../src/insights.js");
    const withText = await collectDeepInsights("salt", { textExtracts: true });
    if (withText.status !== "ok") throw new Error("unreachable");
    expect(withText.payload.topPrompt).toEqual({ text: "implement the plan", count: 3, sessions: 2 });

    vi.resetModules();
    process.env["CCWARRIORS_CLAUDE_DIR"] = projects;
    process.env["CCWARRIORS_HOME"] = home;
    const { collectDeepInsights: collect2 } = await import("../src/insights.js");
    const withoutText = await collect2("salt"); // default: no text extracts
    if (withoutText.status !== "ok") throw new Error("unreachable");
    expect(withoutText.payload.topPrompt).toBeUndefined();
    // The records still carry the numeric signals either way.
    expect(JSON.stringify(withoutText.payload)).not.toContain("implement the plan");
  });

  it("topPrompt needs at least 3 repeats — one-offs never upload", async () => {
    const projects = tmp("ccw-sig-projects-");
    const home = tmp("ccw-sig-home-");
    writeSession(projects, "s.jsonl", [
      user("do the thing", 30),
      assistant([{ type: "text", text: "ok" }], 29),
      user("do the thing", 28),
      assistant([{ type: "text", text: "ok" }], 27),
    ]);
    process.env["CCWARRIORS_CLAUDE_DIR"] = projects;
    process.env["CCWARRIORS_HOME"] = home;
    const { collectDeepInsights } = await import("../src/insights.js");
    const result = await collectDeepInsights("salt", { textExtracts: true });
    if (result.status !== "ok") throw new Error("unreachable");
    expect(result.payload.topPrompt).toBeNull();
  });
});
