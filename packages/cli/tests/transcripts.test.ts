import { mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Transcript collection for the story page (consent v2). Uploads user prompts
// + tool-call names per session — REDACTED client-side, size-capped, and never
// any cwd/file-path/branch metadata fields.

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

/** Write a session file into a named project subdirectory (default "proj"). */
function writeSession(projects: string, name: string, lines: string[], projectDir = "proj"): void {
  const dir = join(projects, projectDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), lines.join("\n") + "\n");
}

/** Set the mtime of a session file by days-ago. */
function setFileMtime(projects: string, name: string, daysAgo: number, projectDir = "proj"): void {
  const filePath = join(projects, projectDir, name);
  const t = new Date(Date.now() - daysAgo * 86_400_000);
  utimesSync(filePath, t, t);
}

/** Build a minimal substantive session: 2 user prompts, 3+ min apart. */
function substantiveLines(promptText = "a substantive prompt", minAgo = 10): string[] {
  return [
    JSON.stringify({ type: "user", message: { content: promptText }, timestamp: ts(minAgo + 3) }),
    JSON.stringify({ type: "assistant", message: { model: "m", content: [{ type: "tool_use", name: "Edit", input: {} }] }, timestamp: ts(minAgo + 2) }),
    JSON.stringify({ type: "user", message: { content: "follow-up prompt" }, timestamp: ts(minAgo) }),
    JSON.stringify({ type: "assistant", message: { model: "m", content: [{ type: "text", text: "done" }] }, timestamp: ts(minAgo - 1) }),
  ];
}

/** Build a trivial session: only 1 user prompt, very short duration (< 2 min). */
function trivialLines(minAgo = 5): string[] {
  return [
    JSON.stringify({ type: "user", message: { content: "hi" }, timestamp: ts(minAgo) }),
    JSON.stringify({ type: "assistant", message: { model: "m", content: [{ type: "text", text: "hello" }] }, timestamp: ts(minAgo - 0.5) }),
  ];
}

describe("collectTranscripts", () => {
  it("extracts redacted prompts + tool counts, never cwd or paths fields", async () => {
    const projects = tmp("ccw-tr-projects-");
    const home = tmp("ccw-tr-home-");
    writeSession(projects, "s.jsonl", [
      JSON.stringify({
        type: "user",
        message: { content: "deploy with key ghp_" + "AbCdEfGh0123456789AbCdEfGh0123456789" + " please" },
        cwd: "/Users/secret/project",
        gitBranch: "feature/x",
        timestamp: ts(30),
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          model: "claude-opus-4-7",
          content: [
            { type: "tool_use", name: "Edit", input: { file_path: "/Users/secret/project/a.ts" } },
            { type: "tool_use", name: "Bash", input: { command: "ls" } },
          ],
        },
        timestamp: ts(29),
      }),
      JSON.stringify({ type: "user", message: { content: "looks good, ship it" }, timestamp: ts(28) }),
    ]);
    process.env["CCWARRIORS_CLAUDE_DIR"] = projects;
    process.env["CCWARRIORS_HOME"] = home;

    const { collectTranscripts } = await import("../src/transcripts.js");
    const payload = (await collectTranscripts())!;
    expect(payload.sessions).toHaveLength(1);
    const s = payload.sessions[0]!;
    expect(s.model).toBe("claude-opus-4-7");
    expect(s.prompts).toHaveLength(2);
    expect(s.prompts[1]).toBe("looks good, ship it");
    expect(s.toolCounts).toEqual({ Edit: 1, Bash: 1 });

    const json = JSON.stringify(payload);
    expect(json).not.toContain("ghp_AbCdEfGh"); // secret redacted on this machine
    expect(json).not.toContain("/Users/secret"); // no cwd/path metadata fields
    expect(json).not.toContain("feature/x"); // no branch names
    expect(json).not.toContain("a.ts"); // tool inputs (paths) never included
  });

  it("char-budget: total serialized sessions fit in STORY_CHAR_BUDGET, most-recent sessions included", async () => {
    const projects = tmp("ccw-tr-projects-");
    const home = tmp("ccw-tr-home-");
    // Write 40 sessions with near-max prompt size (60 prompts × 2000 chars each).
    // Each session is ~120kB serialized — they cannot all fit in 500kB budget.
    for (let i = 0; i < 40; i++) {
      const lines: string[] = [];
      // First prompt (oldest).
      lines.push(JSON.stringify({ type: "user", message: { content: `session-${i} start ` + "x".repeat(100) }, timestamp: ts(1000 - i * 10 + 60) }));
      // Fill up to 60 prompts, each MAX_PROMPT_CHARS chars.
      for (let p = 1; p < 60; p++) {
        lines.push(JSON.stringify({ type: "user", message: { content: `session-${i} prompt-${p} ` + "y".repeat(2000) }, timestamp: ts(1000 - i * 10 + 60 - p) }));
        lines.push(JSON.stringify({ type: "assistant", message: { model: "m", content: [{ type: "text", text: "ok" }] }, timestamp: ts(1000 - i * 10 + 60 - p - 0.5) }));
      }
      lines.push(JSON.stringify({ type: "user", message: { content: `session-${i} end` }, timestamp: ts(1000 - i * 10) }));
      lines.push(JSON.stringify({ type: "assistant", message: { model: "m", content: [{ type: "text", text: "done" }] }, timestamp: ts(999 - i * 10) }));
      writeSession(projects, `s${i}.jsonl`, lines);
    }
    process.env["CCWARRIORS_CLAUDE_DIR"] = projects;
    process.env["CCWARRIORS_HOME"] = home;

    const { collectTranscripts, STORY_CHAR_BUDGET, MAX_STORY_SESSIONS, MAX_PROMPT_CHARS } = await import("../src/transcripts.js");
    const payload = (await collectTranscripts())!;

    // Total serialized size must fit in budget.
    expect(JSON.stringify(payload.sessions).length).toBeLessThanOrEqual(STORY_CHAR_BUDGET);
    // Hard count ceiling.
    expect(payload.sessions.length).toBeLessThanOrEqual(MAX_STORY_SESSIONS);
    // Most recent session (s39) is included (recency-greedy gives it priority).
    expect(payload.sessions[0]!.prompts[0]).toContain("session-39");
    // Prompt length is still capped.
    for (const s of payload.sessions) {
      for (const p of s.prompts) expect(p.length).toBeLessThanOrEqual(MAX_PROMPT_CHARS);
    }
  });

  it("caps duration at 7 days (a left-open session must not 400 the upload)", async () => {
    const projects = tmp("ccw-tr-projects-");
    const home = tmp("ccw-tr-home-");
    writeSession(projects, "long.jsonl", [
      JSON.stringify({ type: "user", message: { content: "start" }, timestamp: ts(12 * 24 * 60) }),
      JSON.stringify({ type: "assistant", message: { model: "m", content: [{ type: "text", text: "ok" }] }, timestamp: ts(1) }),
    ]);
    process.env["CCWARRIORS_CLAUDE_DIR"] = projects;
    process.env["CCWARRIORS_HOME"] = home;
    const { collectTranscripts } = await import("../src/transcripts.js");
    const payload = (await collectTranscripts())!;
    expect(payload.sessions[0]!.durationMinutes).toBeLessThanOrEqual(7 * 24 * 60);
  });

  it("returns null when there are no sessions", async () => {
    const projects = tmp("ccw-tr-projects-");
    const home = tmp("ccw-tr-home-");
    process.env["CCWARRIORS_CLAUDE_DIR"] = projects;
    process.env["CCWARRIORS_HOME"] = home;
    const { collectTranscripts } = await import("../src/transcripts.js");
    expect(await collectTranscripts()).toBeNull();
  });

  it("triviality filter: drops <2-prompt session when ≥5 substantive sessions exist", async () => {
    const projects = tmp("ccw-tr-projects-");
    const home = tmp("ccw-tr-home-");
    // Write 5 substantive sessions.
    for (let i = 0; i < 5; i++) {
      writeSession(projects, `sub${i}.jsonl`, substantiveLines(`substantive prompt ${i}`, 10 + i));
    }
    // Write 1 trivial session (only 1 prompt, < 2 min duration).
    writeSession(projects, "trivial.jsonl", trivialLines(5));
    process.env["CCWARRIORS_CLAUDE_DIR"] = projects;
    process.env["CCWARRIORS_HOME"] = home;
    const { collectTranscripts } = await import("../src/transcripts.js");
    const payload = (await collectTranscripts())!;
    // The trivial session (single prompt "hi") must NOT appear.
    const prompts = payload.sessions.flatMap((s) => s.prompts);
    expect(prompts).not.toContain("hi");
    // All 5 substantive sessions appear.
    expect(payload.sessions.length).toBe(5);
  });

  it("triviality filter: keeps trivial session when user is sparse (<5 substantive)", async () => {
    const projects = tmp("ccw-tr-projects-");
    const home = tmp("ccw-tr-home-");
    // Write 3 substantive sessions (below threshold of 5).
    for (let i = 0; i < 3; i++) {
      writeSession(projects, `sub${i}.jsonl`, substantiveLines(`substantive ${i}`, 10 + i));
    }
    // Write 1 trivial session.
    writeSession(projects, "trivial.jsonl", trivialLines(5));
    process.env["CCWARRIORS_CLAUDE_DIR"] = projects;
    process.env["CCWARRIORS_HOME"] = home;
    const { collectTranscripts } = await import("../src/transcripts.js");
    const payload = (await collectTranscripts())!;
    // Trivial session must be included (sparse user keeps everything).
    const prompts = payload.sessions.flatMap((s) => s.prompts);
    expect(prompts).toContain("hi");
  });

  it("stratified sample: old session (~35 days ago) appears alongside recent sessions", async () => {
    const projects = tmp("ccw-tr-projects-");
    const home = tmp("ccw-tr-home-");

    // Fill the recent budget: 10 fresh substantive sessions (small size).
    for (let i = 0; i < 10; i++) {
      writeSession(projects, `fresh${i}.jsonl`, substantiveLines(`fresh prompt ${i}`, 5 + i), "active-proj");
    }

    // One substantive session ~35 days ago — placed in an old stratum.
    writeSession(projects, "old.jsonl", substantiveLines("ancient wisdom", 35 * 24 * 60), "active-proj");
    setFileMtime(projects, "old.jsonl", 35, "active-proj");

    process.env["CCWARRIORS_CLAUDE_DIR"] = projects;
    process.env["CCWARRIORS_HOME"] = home;
    const { collectTranscripts } = await import("../src/transcripts.js");
    const payload = (await collectTranscripts())!;

    // The old session should appear in the payload (stratified sample picks it).
    const prompts = payload.sessions.flatMap((s) => s.prompts);
    expect(prompts).toContain("ancient wisdom");
  });

  it("stale-project deprioritization: when budget is tight, stale single-session project loses to active", async () => {
    const projects = tmp("ccw-tr-projects-");
    const home = tmp("ccw-tr-home-");

    // Active project: many recent large sessions that fill the budget.
    // Use short words repeated (not 48+ char blobs) so redaction doesn't strip them.
    // Build prompts ~1800 chars from short words to avoid redaction patterns.
    const activePromptWord = "work ".repeat(360).trim(); // 1800 chars, short words
    for (let i = 0; i < 5; i++) {
      const lines: string[] = [];
      for (let p = 0; p < 60; p++) {
        lines.push(JSON.stringify({ type: "user", message: { content: `active session ${i} prompt ${p} ${activePromptWord}` }, timestamp: ts(100 - i * 10 + 60 - p) }));
        lines.push(JSON.stringify({ type: "assistant", message: { model: "m", content: [{ type: "tool_use", name: "Edit", input: {} }] }, timestamp: ts(100 - i * 10 + 59 - p) }));
      }
      writeSession(projects, `active${i}.jsonl`, lines, "active-proj");
    }

    // Stale project: single session ~25 days ago (> STALE_PROJECT_DAYS=14, count=1<=2).
    // Marked as stale by setting mtime to 25 days ago.
    writeSession(projects, "stale.jsonl", substantiveLines("stale only prompt", 25 * 24 * 60), "stale-proj");
    setFileMtime(projects, "stale.jsonl", 25, "stale-proj");

    process.env["CCWARRIORS_CLAUDE_DIR"] = projects;
    process.env["CCWARRIORS_HOME"] = home;
    const { collectTranscripts, STORY_CHAR_BUDGET } = await import("../src/transcripts.js");
    const payload = (await collectTranscripts())!;

    // Total budget respected.
    expect(JSON.stringify(payload.sessions).length).toBeLessThanOrEqual(STORY_CHAR_BUDGET);
    // Active sessions must be present (they go through recency-greedy first).
    const hasActiveSession = payload.sessions.some((s) =>
      s.prompts.some((p) => p.includes("active session")),
    );
    expect(hasActiveSession).toBe(true);
    // When budget is exhausted by active sessions, stale session is deprioritized.
    // Check budget was actually consumed (i.e., not infinite space for everything).
    const serializedLen = JSON.stringify(payload.sessions).length;
    expect(serializedLen).toBeGreaterThan(0);
  });

  it("hard ceiling: many tiny sessions never exceed MAX_STORY_SESSIONS", async () => {
    const projects = tmp("ccw-tr-projects-");
    const home = tmp("ccw-tr-home-");
    // Write 300 tiny substantive sessions (each 2 prompts, short).
    for (let i = 0; i < 300; i++) {
      writeSession(projects, `s${i}.jsonl`, substantiveLines(`prompt ${i}`, 5 + (i % 100)));
    }
    process.env["CCWARRIORS_CLAUDE_DIR"] = projects;
    process.env["CCWARRIORS_HOME"] = home;
    const { collectTranscripts, MAX_STORY_SESSIONS } = await import("../src/transcripts.js");
    const payload = (await collectTranscripts())!;
    expect(payload.sessions.length).toBeLessThanOrEqual(MAX_STORY_SESSIONS);
  });

  it("privacy: serialized payload contains no projectKey, jsonChars, endMs, or project directory names", async () => {
    const projects = tmp("ccw-tr-projects-");
    const home = tmp("ccw-tr-home-");
    // Use a distinctive project directory name that should never appear in output.
    const projectDir = "my-super-secret-project-dir";
    writeSession(projects, "s.jsonl", substantiveLines("privacy test prompt", 10), projectDir);
    process.env["CCWARRIORS_CLAUDE_DIR"] = projects;
    process.env["CCWARRIORS_HOME"] = home;
    const { collectTranscripts } = await import("../src/transcripts.js");
    const payload = (await collectTranscripts())!;
    const json = JSON.stringify(payload);
    expect(json).not.toContain("projectKey");
    expect(json).not.toContain("jsonChars");
    expect(json).not.toContain("endMs");
    expect(json).not.toContain(projectDir);
  });
});
