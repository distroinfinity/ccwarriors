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

    // Each fresh session needs ~115k chars to fill the 425k greedy budget with 4 sessions.
    // Use "work " repeated to avoid the 48-char base64 redaction pattern.
    // 60 prompts × ~1900 chars each ≈ 115k chars/session serialized.
    // 4 sessions × 115k ≈ 460k, which overflows the 425k RECENT_BUDGET_SHARE (0.85×500k),
    // so only ~3-4 sessions fit in the greedy pass, exhausting it.
    // Then the 35-day-old session can only appear via the stratified leftover pass.
    const freshWord = "work ".repeat(380).trim(); // ~1900 chars, short words — no redaction
    for (let i = 0; i < 5; i++) {
      const lines: string[] = [];
      for (let p = 0; p < 60; p++) {
        lines.push(JSON.stringify({ type: "user", message: { content: `fresh${i} p${p} ${freshWord}` }, timestamp: ts(5 + i + 60 - p + 1) }));
        lines.push(JSON.stringify({ type: "assistant", message: { model: "m", content: [{ type: "text", text: "ok" }] }, timestamp: ts(5 + i + 60 - p) }));
      }
      writeSession(projects, `fresh${i}.jsonl`, lines, "active-proj");
    }

    // One substantive session ~35 days ago — must fall in an old stratum.
    // Use a small session so it fits in leftover budget after the greedy pass fills up.
    writeSession(projects, "old.jsonl", substantiveLines("ancient wisdom", 35 * 24 * 60), "active-proj");
    setFileMtime(projects, "old.jsonl", 35, "active-proj");

    process.env["CCWARRIORS_CLAUDE_DIR"] = projects;
    process.env["CCWARRIORS_HOME"] = home;
    const { collectTranscripts, STORY_CHAR_BUDGET } = await import("../src/transcripts.js");

    const payload = (await collectTranscripts())!;

    // RECENT_BUDGET_SHARE = 0.85, so the greedy pass budget = 425k chars.
    // With 5 fresh sessions × ~115k chars each ≈ 575k total, only ~3-4 fit in the greedy pass.
    // The old session (small, 35 days old) cannot be picked by the greedy pass
    // because the greedy pass is full — it can only enter via the stratified leftover pass.
    // Verify the budget was stressed: used > 90% of greedy budget (0.85 × 500k × 0.9 ≈ 382k).
    const serialized = JSON.stringify(payload.sessions);
    expect(serialized.length).toBeGreaterThan(STORY_CHAR_BUDGET * 0.85 * 0.9);

    // The old session must still appear — it entered via the stratified leftover pass.
    const prompts = payload.sessions.flatMap((s) => s.prompts);
    expect(prompts).toContain("ancient wisdom");
  });

  it("stale-project deprioritization: when budget is tight, stale single-session project loses to active", async () => {
    const projects = tmp("ccw-tr-projects-");
    const home = tmp("ccw-tr-home-");

    // Budget math (all sizes ≈ serialized JSON chars):
    //   - Active session: 40 prompts × ~1900 chars ≈ 77k chars each
    //   - Greedy budget: 0.85 × 500k = 425k → fits 5 sessions (5 × 77k = 386k)
    //   - Stratified pass picks 1 leftover active session → 386k + 77k = 463k used
    //   - Remaining budget: 500k − 463k = 37k
    //   - Stale session: 60 prompts × ~1900 chars ≈ 120k → 120k > 37k, cannot fit
    // Therefore the stale session is absent from the payload.
    //
    // Active project: 6 recent sessions each with 40 prompts × ~1900 chars ≈ 77k each.
    // Use short-word repetition to avoid the 48-char base64 redaction pattern.
    const activeWord = "code ".repeat(380).trim(); // ~1900 chars, short words
    for (let i = 0; i < 6; i++) {
      const lines: string[] = [];
      for (let p = 0; p < 40; p++) {
        lines.push(JSON.stringify({ type: "user", message: { content: `active session ${i} prompt ${p} ${activeWord}` }, timestamp: ts(10 + i + 40 - p + 1) }));
        lines.push(JSON.stringify({ type: "assistant", message: { model: "m", content: [{ type: "tool_use", name: "Edit", input: {} }] }, timestamp: ts(10 + i + 40 - p) }));
      }
      writeSession(projects, `active${i}.jsonl`, lines, "active-proj");
    }

    // Stale project: single session ~20 days ago (> STALE_PROJECT_DAYS=14, count=1<=2).
    // Made large (60 prompts × ~1900 chars ≈ 120k) so it cannot fit in the ~37k remaining
    // budget after the greedy pass + stratified active leftovers have been picked.
    // Use a unique marker to identify it in the payload.
    const staleWord = "stale ".repeat(380).trim(); // ~1900 chars, short words
    const staleLines: string[] = [];
    for (let p = 0; p < 60; p++) {
      staleLines.push(JSON.stringify({ type: "user", message: { content: `STALE_UNIQUE_MARKER prompt ${p} ${staleWord}` }, timestamp: ts(20 * 24 * 60 + 60 - p + 1) }));
      staleLines.push(JSON.stringify({ type: "assistant", message: { model: "m", content: [{ type: "text", text: "ok" }] }, timestamp: ts(20 * 24 * 60 + 60 - p) }));
    }
    writeSession(projects, "stale.jsonl", staleLines, "stale-proj");
    setFileMtime(projects, "stale.jsonl", 20, "stale-proj");

    process.env["CCWARRIORS_CLAUDE_DIR"] = projects;
    process.env["CCWARRIORS_HOME"] = home;
    const { collectTranscripts, STORY_CHAR_BUDGET } = await import("../src/transcripts.js");
    const payload = (await collectTranscripts())!;

    // Total budget respected.
    expect(JSON.stringify(payload.sessions).length).toBeLessThanOrEqual(STORY_CHAR_BUDGET);

    // Active sessions must be present (they are picked by recency-greedy first).
    const hasActiveSession = payload.sessions.some((s) =>
      s.prompts.some((p) => p.includes("active session")),
    );
    expect(hasActiveSession).toBe(true);

    // The budget must have been substantially consumed by active sessions (>85% used).
    // With 5 active sessions × ~115k each the greedy pass fills to 425k and the
    // stratified pass picks the next leftover active session — together they push
    // well past 85% of the 500k budget.
    const serializedLen = JSON.stringify(payload.sessions).length;
    expect(serializedLen).toBeGreaterThan(STORY_CHAR_BUDGET * 0.85);

    // The stale session must NOT appear — budget was exhausted before the stratified
    // pass could fit it in. This is the key assertion: stale-project truly deprioritized.
    const stalePresent = payload.sessions.some((s) =>
      s.prompts.some((p) => p.includes("STALE_UNIQUE_MARKER")),
    );
    expect(stalePresent).toBe(false);
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
