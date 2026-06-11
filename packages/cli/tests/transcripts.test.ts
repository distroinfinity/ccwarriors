import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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

function writeSession(projects: string, name: string, lines: string[]): void {
  const dir = join(projects, "proj");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), lines.join("\n") + "\n");
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

  it("caps sessions (most recent first) and prompt length", async () => {
    const projects = tmp("ccw-tr-projects-");
    const home = tmp("ccw-tr-home-");
    for (let i = 0; i < 40; i++) {
      writeSession(projects, `s${i}.jsonl`, [
        JSON.stringify({ type: "user", message: { content: `prompt ${i} ` + "x".repeat(5000) }, timestamp: ts(1000 - i) }),
        JSON.stringify({ type: "assistant", message: { model: "m", content: [{ type: "text", text: "ok" }] }, timestamp: ts(999 - i) }),
      ]);
    }
    process.env["CCWARRIORS_CLAUDE_DIR"] = projects;
    process.env["CCWARRIORS_HOME"] = home;

    const { collectTranscripts, MAX_STORY_SESSIONS, MAX_PROMPT_CHARS } = await import("../src/transcripts.js");
    const payload = (await collectTranscripts())!;
    expect(payload.sessions.length).toBeLessThanOrEqual(MAX_STORY_SESSIONS);
    // Most recent sessions win (s39 was the most recent).
    expect(payload.sessions[0]!.prompts[0]).toContain("prompt 39");
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
});
