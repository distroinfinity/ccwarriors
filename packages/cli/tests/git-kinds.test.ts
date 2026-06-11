import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readGitOutcome, classifyCommitSubject } from "../src/git.js";

// Commit-kind classification (Paxel's "Mostly features: 315 features, 178
// fixes"). Counts only — the subjects themselves never leave the machine.

let cleanup: string[] = [];

beforeEach(() => {
  cleanup = [];
});
afterEach(() => {
  for (const d of cleanup) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

describe("classifyCommitSubject", () => {
  it.each([
    ["fix: resolve crash on login", "fix"],
    ["bugfix in payment flow", "fix"],
    ["hotfix for prod", "fix"],
    ["feat: add story page", "feature"],
    ["Add dark mode toggle", "feature"],
    ["implement webhook retries", "feature"],
    ["refactor(auth): split token logic", "refactor"],
    ["cleanup unused imports", "refactor"],
    ["docs: update readme", "other"],
    ["chore: bump deps", "other"],
    ["wip", "other"],
  ])("%s → %s", (subject, kind) => {
    expect(classifyCommitSubject(subject)).toBe(kind);
  });
});

describe("readGitOutcome commitKinds", () => {
  it("counts fixes/features/refactors among in-window commits", async () => {
    const repo = mkdtempSync(join(tmpdir(), "ccw-kinds-"));
    cleanup.push(repo);
    const g = (args: string[], dateIso: string) => {
      const env = { ...process.env, GIT_AUTHOR_DATE: dateIso, GIT_COMMITTER_DATE: dateIso };
      execFileSync("git", ["-C", repo, ...args], { env, stdio: ["ignore", "pipe", "ignore"] });
    };
    execFileSync("git", ["-C", repo, "init", "-q", "-b", "main"], { stdio: "ignore" });
    execFileSync("git", ["-C", repo, "config", "user.email", "t@t.t"], { stdio: "ignore" });
    execFileSync("git", ["-C", repo, "config", "user.name", "T"], { stdio: "ignore" });
    execFileSync("git", ["-C", repo, "config", "commit.gpgsign", "false"], { stdio: "ignore" });

    const now = Date.now();
    const mid = new Date(now - 5 * 60_000).toISOString();
    const commits = ["feat: add cards", "fix: null crash", "Add pins endpoint", "refactor: tidy"];
    for (let i = 0; i < commits.length; i++) {
      writeFileSync(join(repo, `f${i}.ts`), `export const x${i} = ${i};\n`);
      g(["add", "-A"], mid);
      g(["commit", "-q", "-m", commits[i]!], mid);
    }

    const outcome = (await readGitOutcome({
      cwd: repo,
      branch: "main",
      startMs: now - 10 * 60_000,
      endMs: now,
      aiEditedFiles: [],
      salt: "s",
    }))!;
    expect(outcome.commitKinds).toEqual({ fixes: 1, features: 2, refactors: 1, other: 0 });
  });
});
