import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// collectDeepInsights reads PROJECTS_DIR / HOME from env at module load, so we
// set both BEFORE importing the module (dynamic import inside the test).

let cleanup: string[] = [];

function mkrepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "ccw-deep-repo-"));
  cleanup.push(dir);
  const g = (args: string[], dateIso?: string) => {
    const env = { ...process.env };
    if (dateIso) {
      env["GIT_AUTHOR_DATE"] = dateIso;
      env["GIT_COMMITTER_DATE"] = dateIso;
    }
    execFileSync("git", ["-C", dir, ...args], { env, stdio: ["ignore", "pipe", "ignore"] });
  };
  g(["init", "-q", "-b", "main"]);
  g(["config", "user.email", "test@ccwarriors.xyz"]);
  g(["config", "user.name", "CCW Test"]);
  g(["config", "commit.gpgsign", "false"]);
  return dir;
}

beforeEach(() => {
  cleanup = [];
  // Reset the module registry so each test re-evaluates module-level constants
  // (PROJECTS_DIR, HOME) from the current process.env values set in the test.
  vi.resetModules();
  // Isolate the Codex source by default: point it at a path that does not
  // exist so collectCodexSessions yields [] unless a test opts in.
  process.env["CCWARRIORS_CODEX_DIR"] = join(tmpdir(), "ccw-codex-absent-DO-NOT-CREATE");
});

afterEach(() => {
  for (const dir of cleanup) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
  cleanup = [];
  // Clear the env each test set, so a later test (e.g. Plan 2's per-agent
  // source tests) that forgets to set them can't silently inherit a prior
  // test's now-removed temp dirs via vi.resetModules() re-reading the env.
  delete process.env["CCWARRIORS_CLAUDE_DIR"];
  delete process.env["CCWARRIORS_HOME"];
  delete process.env["CCWARRIORS_CODEX_DIR"];
});

describe("collectDeepInsights", () => {
  it("builds per-session records with a populated git outcome and leaks no paths", async () => {
    const repo = mkrepo();
    const EDITED = "craft-widget.ts"; // basename we'll also commit, to link
    const now = Date.now();
    const startIso = new Date(now - 10 * 60_000).toISOString();
    const midIso = new Date(now - 9 * 60_000).toISOString();
    const endIso = new Date(now - 8 * 60_000).toISOString();

    // A real commit inside the session window, touching the AI-edited file.
    const env = { ...process.env, GIT_AUTHOR_DATE: midIso, GIT_COMMITTER_DATE: midIso };
    writeFileSync(join(repo, EDITED), "export const x = 1;\nexport const y = 2;\n");
    execFileSync("git", ["-C", repo, "add", "-A"], { stdio: "ignore" });
    execFileSync("git", ["-C", repo, "commit", "-q", "-m", "add widget"], { env, stdio: "ignore" });

    // Synthetic projects dir + a session JSONL whose cwd is the real repo.
    const projects = mkdtempSync(join(tmpdir(), "ccw-deep-projects-"));
    cleanup.push(projects);
    const home = mkdtempSync(join(tmpdir(), "ccw-deep-home-"));
    cleanup.push(home);
    const sessDir = join(projects, "proj-encoded");
    mkdirSync(sessDir, { recursive: true });
    const editedAbs = join(repo, EDITED);
    const lines = [
      JSON.stringify({ type: "user", message: { content: "build the craft widget feature now" }, cwd: repo, gitBranch: "main", timestamp: startIso }),
      JSON.stringify({ type: "assistant", message: { model: "claude-opus-4-7", content: [{ type: "tool_use", name: "Edit", input: { file_path: editedAbs } }] }, cwd: repo, gitBranch: "main", timestamp: midIso }),
      JSON.stringify({ type: "user", message: { content: "looks good, commit it" }, cwd: repo, gitBranch: "main", timestamp: endIso }),
    ];
    writeFileSync(join(sessDir, "session.jsonl"), lines.join("\n") + "\n");

    // A SECOND session in the SAME repo (same cwd) — exercises the repo-known
    // memoization / concurrency pool path. It has no commit in its own window,
    // so its git outcome is a real-but-zero-commit outcome (repo identity still
    // resolves), while session one stays linked to its commit.
    const s2Start = new Date(now - 4 * 60_000).toISOString();
    const s2End = new Date(now - 3 * 60_000).toISOString();
    const lines2 = [
      JSON.stringify({ type: "user", message: { content: "small follow up tweak please" }, cwd: repo, gitBranch: "main", timestamp: s2Start }),
      JSON.stringify({ type: "assistant", message: { model: "claude-opus-4-7", content: [{ type: "text", text: "ok" }] }, cwd: repo, gitBranch: "main", timestamp: s2End }),
    ];
    writeFileSync(join(sessDir, "session2.jsonl"), lines2.join("\n") + "\n");

    process.env["CCWARRIORS_CLAUDE_DIR"] = projects;
    process.env["CCWARRIORS_HOME"] = home;

    const { collectDeepInsights } = await import("../src/insights.js");
    const result = await collectDeepInsights("testsalt");

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");
    const payload = result.payload;
    expect(payload.windowDays).toBeGreaterThan(0);
    expect(payload.sessions.length).toBe(2);

    // Find the session linked to the commit (order across files is not fixed).
    const linked = payload.sessions.find((r) => r.git && r.git.commitsInWindow === 1);
    const other = payload.sessions.find((r) => r !== linked);
    expect(linked).toBeDefined();
    expect(other).toBeDefined();

    const rec = linked!;
    expect(rec.model).toBe("claude-opus-4-7");
    expect(rec.git).not.toBeNull();
    expect(rec.git!.repoIdHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rec.git!.commitsInWindow).toBe(1);
    expect(rec.git!.aiLinkedCommits).toBe(1); // basename match on craft-widget.ts
    expect(rec.timing.events).toBe(3);

    // Memoization sanity: both sessions resolved the SAME repo identity.
    expect(other!.git).not.toBeNull();
    expect(other!.git!.repoIdHash).toBe(rec.git!.repoIdHash);
    expect(other!.git!.commitsInWindow).toBe(0);

    // PRIVACY ASSERTION: the uploaded JSON must contain no local paths/branches.
    const json = JSON.stringify(payload);
    expect(json).not.toContain(repo);
    expect(json).not.toContain(editedAbs);
    expect(json).not.toContain(EDITED);
    expect(json).not.toContain("main"); // gitBranch never travels
    expect(json).not.toContain("/"); // no filesystem path separators at all
  });

  it("stamps tool=claude and carries skill usage onto uploaded records", async () => {
    const repo = mkrepo();
    const now = Date.now();
    const startIso = new Date(now - 6 * 60_000).toISOString();
    const endIso = new Date(now - 5 * 60_000).toISOString();

    const projects = mkdtempSync(join(tmpdir(), "ccw-deep-skill-projects-"));
    cleanup.push(projects);
    const home = mkdtempSync(join(tmpdir(), "ccw-deep-skill-home-"));
    cleanup.push(home);
    const sessDir = join(projects, "proj-skill");
    mkdirSync(sessDir, { recursive: true });
    const lines = [
      JSON.stringify({ type: "user", message: { content: "use tdd please now" }, cwd: repo, gitBranch: "main", timestamp: startIso }),
      JSON.stringify({ type: "assistant", message: { model: "claude-opus-4-8", content: [{ type: "tool_use", name: "Skill", input: { skill: "test-driven-development", args: "secret" } }] }, cwd: repo, gitBranch: "main", timestamp: endIso }),
    ];
    writeFileSync(join(sessDir, "session.jsonl"), lines.join("\n") + "\n");

    process.env["CCWARRIORS_CLAUDE_DIR"] = projects;
    process.env["CCWARRIORS_HOME"] = home;

    const { collectDeepInsights } = await import("../src/insights.js");
    const result = await collectDeepInsights("testsalt");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");
    const rec = result.payload.sessions[0]!;
    expect(rec.tool).toBe("claude");
    expect(rec.skillSpawns).toBe(1);
    expect(rec.skillsUsed).toEqual({ "test-driven-development": 1 });
    expect(JSON.stringify(result.payload)).not.toContain("secret");
  });

  it("collects Codex rollout sessions with tool=codex and a git outcome", async () => {
    const repo = mkrepo();
    const now = Date.now();
    const startIso = new Date(now - 8 * 60_000).toISOString();
    const midIso = new Date(now - 7 * 60_000).toISOString();
    const endIso = new Date(now - 6 * 60_000).toISOString();

    // A commit inside the Codex session window (editedFiles is [] for Codex, so
    // attribution is time-window only: commitsInWindow counts it, aiLinked is 0).
    const env = { ...process.env, GIT_AUTHOR_DATE: midIso, GIT_COMMITTER_DATE: midIso };
    writeFileSync(join(repo, "thing.ts"), "export const a = 1;\n");
    execFileSync("git", ["-C", repo, "add", "-A"], { stdio: "ignore" });
    execFileSync("git", ["-C", repo, "commit", "-q", "-m", "feat: add thing"], { env, stdio: "ignore" });

    // Synthetic Codex sessions dir with the real nested YYYY/MM/DD/rollout-*.jsonl shape.
    const codex = mkdtempSync(join(tmpdir(), "ccw-codex-"));
    cleanup.push(codex);
    const dayDir = join(codex, "2026", "06", "29");
    mkdirSync(dayDir, { recursive: true });
    const lines = [
      JSON.stringify({ type: "session_meta", timestamp: startIso, payload: { session_id: "s1", cwd: repo } }),
      JSON.stringify({ type: "turn_context", timestamp: startIso, payload: { cwd: repo, model: "gpt-5.5" } }),
      JSON.stringify({ type: "event_msg", timestamp: startIso, payload: { type: "user_message", message: "do it" } }),
      JSON.stringify({ type: "response_item", timestamp: endIso, payload: { type: "message", role: "assistant", content: [] } }),
    ];
    writeFileSync(join(dayDir, "rollout-2026-06-29T12-00-00-abc.jsonl"), lines.join("\n") + "\n");

    // Isolate Claude (empty) so ONLY Codex contributes; point Codex at our dir.
    const projects = mkdtempSync(join(tmpdir(), "ccw-codex-claude-"));
    cleanup.push(projects);
    const home = mkdtempSync(join(tmpdir(), "ccw-codex-home-"));
    cleanup.push(home);
    process.env["CCWARRIORS_CLAUDE_DIR"] = projects;
    process.env["CCWARRIORS_HOME"] = home;
    process.env["CCWARRIORS_CODEX_DIR"] = codex;

    const { collectDeepInsights } = await import("../src/insights.js");
    const result = await collectDeepInsights("salt");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");
    expect(result.payload.sessions.length).toBe(1);
    const rec = result.payload.sessions[0]!;
    expect(rec.tool).toBe("codex");
    expect(rec.model).toBe("gpt-5.5");
    expect(rec.git).not.toBeNull();
    expect(rec.git!.commitsInWindow).toBe(1);
    // PRIVACY: no path/branch leaks.
    expect(JSON.stringify(result.payload)).not.toContain(repo);
  });
});
