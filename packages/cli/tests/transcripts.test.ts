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

  it("stratified sample: old active session (~35 days ago) is picked by stratified pass when greedy budget is full", async () => {
    // Scenario: 4 fresh sessions fill the greedy pass (≤ 425k = 0.85 × 500k).
    // Session O at ~35 days old is in the SAME project ("active-proj") as the fresh
    // sessions, so it is NOT stale (project has recent activity). O is sorted after
    // the fresh sessions in the greedy pass (by endMs desc) and is skipped because
    // used + O.jsonChars would exceed 425k. O then goes to the stratified leftover
    // pool. Stratum index for 35-day-old session: floor((40-35)/10) = 0 (oldest
    // stratum), so round-robin picks it first. used + O ≤ 500k → O is picked.
    //
    // Discrimination: if the stratified loop were removed, O would never appear.
    //
    // Size budget (all values computed from actual JSON.stringify):
    //   Fresh session: 51 prompts × ~1928 chars → ~98.6k chars each
    //   4 fresh total: ~394.5k ≤ 425k (greedy picks all 4)
    //   O: 25 prompts × ~1953 chars → ~48.4k chars
    //   4 fresh + O: ~442.9k > 425k (O skipped by greedy) AND ≤ 500k (O fits stratified)
    const projects = tmp("ccw-tr-projects-");
    const home = tmp("ccw-tr-home-");
    const filler = "work ".repeat(385).trim(); // 1924 chars — short words, no redaction pattern
    for (let i = 0; i < 4; i++) {
      // Session i is (i+1) days old: endMs ≈ now − (i+1)*24*60 min.
      const daysAgoMin = (i + 1) * 24 * 60;
      const lines: string[] = [];
      for (let p = 0; p < 51; p++) {
        // First prompt is the earliest; last prompt drives endMs.
        const minAgo = daysAgoMin + (51 - p);
        lines.push(JSON.stringify({ type: "user", message: { content: `fp${p} ${filler}` }, timestamp: ts(minAgo + 1) }));
        lines.push(JSON.stringify({ type: "assistant", message: { model: "m", content: [{ type: "text", text: "ok" }] }, timestamp: ts(minAgo) }));
      }
      writeSession(projects, `fresh${i}.jsonl`, lines, "active-proj");
    }

    // O: 35 days old, same project dir → NOT stale (project has fresh sessions).
    // 25 prompts with a unique marker so we can assert it appears in the payload.
    const oMinAgo = 35 * 24 * 60;
    const oldLines: string[] = [];
    for (let p = 0; p < 25; p++) {
      const minAgo = oMinAgo + (25 - p);
      oldLines.push(JSON.stringify({ type: "user", message: { content: p === 0 ? `OLD_STRATIFIED_MARKER unique ${filler}` : `op${p} ${filler}` }, timestamp: ts(minAgo + 1) }));
      oldLines.push(JSON.stringify({ type: "assistant", message: { model: "m", content: [{ type: "text", text: "ok" }] }, timestamp: ts(minAgo) }));
    }
    writeSession(projects, "old.jsonl", oldLines, "active-proj");
    setFileMtime(projects, "old.jsonl", 35, "active-proj");

    process.env["CCWARRIORS_CLAUDE_DIR"] = projects;
    process.env["CCWARRIORS_HOME"] = home;
    const { collectTranscripts, STORY_CHAR_BUDGET } = await import("../src/transcripts.js");
    const payload = (await collectTranscripts())!;

    // The total payload must fit within the hard budget.
    expect(JSON.stringify(payload.sessions).length).toBeLessThanOrEqual(STORY_CHAR_BUDGET);

    // O's unique marker must be present — it can ONLY arrive via the stratified pass.
    // If the stratified loop is removed, this assertion fails.
    const allPrompts = payload.sessions.flatMap((s) => s.prompts);
    expect(allPrompts.some((p) => p.includes("OLD_STRATIFIED_MARKER"))).toBe(true);
  });

  it("stale-project deprioritization: stale session is excluded while old-but-active session is included", async () => {
    // Scenario: 3 fresh sessions + 1 old-but-active session A fill the greedy pass.
    // A stale session S (single-session project, 16 days idle > 14d threshold) is
    // placed in the stale pool, bypasses the greedy pass, then cannot fit in the
    // stratified pass because the budget is already exhausted.
    //
    // WITH stale logic (current code):
    //   Greedy active pool (endMs desc): fresh1(1d), fresh2(2d), fresh3(3d), A(18d)
    //   fresh1+2+3 = ~290k; +A = ~406k ≤ 425k → A PICKED by greedy.
    //   Stale pool: [S]. Stratified: 406k + 97k = ~503k > 500k → S EXCLUDED.
    //   Payload contains A, not S. ← current behaviour
    //
    // WITHOUT stale logic (if stale split were removed):
    //   Greedy pool (endMs desc): fresh1(1d), fresh2(2d), fresh3(3d), S(16d), A(18d)
    //   fresh1+2+3 = ~290k; +S = ~387k ≤ 425k → S PICKED instead.
    //   A: 387k + 116k = ~503k > 425k → A SKIPPED by greedy.
    //   Stratified: 387k + 116k = ~503k > 500k → A EXCLUDED.
    //   Payload contains S, not A. ← opposite result
    //
    // Asserting BOTH A present AND S absent is the discriminator: it flips if
    // the stale pool split is removed.
    //
    // Size budget (all values from actual JSON.stringify):
    //   Fresh session: 50 prompts × ~1928 chars → ~96.7k chars each
    //   3 fresh total: ~290.1k ≤ 425k
    //   A: 60 prompts → ~116k chars
    //   3 fresh + A: ~406.1k ≤ 425k (A fits greedy, WITH stale)
    //   S: 50 prompts → ~96.7k chars
    //   3 fresh + A + S: ~502.8k > 500k (S excluded from stratified)
    //   3 fresh + S: ~386.8k ≤ 425k (S fits greedy, WITHOUT stale)
    //   3 fresh + S + A: ~502.8k > 425k (A skipped, WITHOUT stale)
    //   3 fresh + S + A: ~502.8k > 500k (A excluded from stratified, WITHOUT stale)
    const projects = tmp("ccw-tr-projects-");
    const home = tmp("ccw-tr-home-");
    const filler = "work ".repeat(385).trim(); // 1924 chars — short words, no redaction

    // 3 fresh sessions: 1, 2, 3 days old in "active-proj".
    for (let i = 0; i < 3; i++) {
      const daysAgoMin = (i + 1) * 24 * 60;
      const lines: string[] = [];
      for (let p = 0; p < 50; p++) {
        const minAgo = daysAgoMin + (50 - p);
        lines.push(JSON.stringify({ type: "user", message: { content: `gp${p} ${filler}` }, timestamp: ts(minAgo + 1) }));
        lines.push(JSON.stringify({ type: "assistant", message: { model: "m", content: [{ type: "text", text: "ok" }] }, timestamp: ts(minAgo) }));
      }
      writeSession(projects, `fresh${i}.jsonl`, lines, "active-proj");
    }

    // A: 18 days old, same "active-proj" (4 sessions total → NOT stale: project is active).
    // 60 prompts with unique marker OLDACTIVE_MARKER.
    const aMinAgo = 18 * 24 * 60;
    const aLines: string[] = [];
    for (let p = 0; p < 60; p++) {
      const minAgo = aMinAgo + (60 - p);
      aLines.push(JSON.stringify({ type: "user", message: { content: p === 0 ? `OLDACTIVE_MARKER_18d unique ${filler}` : `ap${p} ${filler}` }, timestamp: ts(minAgo + 1) }));
      aLines.push(JSON.stringify({ type: "assistant", message: { model: "m", content: [{ type: "text", text: "ok" }] }, timestamp: ts(minAgo) }));
    }
    writeSession(projects, "active-old.jsonl", aLines, "active-proj");
    setFileMtime(projects, "active-old.jsonl", 18, "active-proj");

    // S: 16 days old, in its own project "stale-proj" (only 1 session → stale:
    //   now − lastEndMs = 16d > STALE_PROJECT_DAYS=14d AND count=1 ≤ 2).
    // 50 prompts with unique marker STALE_MARKER.
    const sMinAgo = 16 * 24 * 60;
    const sLines: string[] = [];
    for (let p = 0; p < 50; p++) {
      const minAgo = sMinAgo + (50 - p);
      sLines.push(JSON.stringify({ type: "user", message: { content: p === 0 ? `STALE_MARKER_16d unique ${filler}` : `sp${p} ${filler}` }, timestamp: ts(minAgo + 1) }));
      sLines.push(JSON.stringify({ type: "assistant", message: { model: "m", content: [{ type: "text", text: "ok" }] }, timestamp: ts(minAgo) }));
    }
    writeSession(projects, "stale.jsonl", sLines, "stale-proj");
    setFileMtime(projects, "stale.jsonl", 16, "stale-proj");

    process.env["CCWARRIORS_CLAUDE_DIR"] = projects;
    process.env["CCWARRIORS_HOME"] = home;
    const { collectTranscripts, STORY_CHAR_BUDGET } = await import("../src/transcripts.js");
    const payload = (await collectTranscripts())!;

    // Total budget respected.
    expect(JSON.stringify(payload.sessions).length).toBeLessThanOrEqual(STORY_CHAR_BUDGET);

    // A must be present: it is in the active pool and picked by the greedy pass.
    // Without stale logic, S would be picked instead of A — this assertion flips.
    const aPresent = payload.sessions.some((s) => s.prompts.some((p) => p.includes("OLDACTIVE_MARKER_18d")));
    expect(aPresent).toBe(true);

    // S must be absent: it is in the stale pool and the budget is exhausted before
    // the stratified pass can fit it.
    // Without stale logic, S would appear instead of A — this assertion flips.
    const sPresent = payload.sessions.some((s) => s.prompts.some((p) => p.includes("STALE_MARKER_16d")));
    expect(sPresent).toBe(false);
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
