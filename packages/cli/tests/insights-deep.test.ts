import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
    const payload = (await collectDeepInsights("testsalt"))!;

    expect(payload).not.toBeNull();
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
});
