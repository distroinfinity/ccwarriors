import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isTestPath, readGitOutcome } from "../src/git.js";

// ---------------------------------------------------------------------------
// Temp-repo helpers. Every commit is dated via GIT_AUTHOR_DATE/COMMITTER_DATE
// so we can place commits precisely inside or outside a session window.
// ---------------------------------------------------------------------------

let repos: string[] = [];

function mkrepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "ccw-git-"));
  repos.push(dir);
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "test@ccwarriors.xyz"]);
  git(dir, ["config", "user.name", "CCW Test"]);
  // Keep gc/auto noise out and avoid signing prompts.
  git(dir, ["config", "commit.gpgsign", "false"]);
  return dir;
}

function git(dir: string, args: string[], dateIso?: string): string {
  const env = { ...process.env };
  if (dateIso) {
    env["GIT_AUTHOR_DATE"] = dateIso;
    env["GIT_COMMITTER_DATE"] = dateIso;
  }
  return execFileSync("git", ["-C", dir, ...args], {
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
}

function writeAndCommit(
  dir: string,
  files: Record<string, string>,
  message: string,
  dateMs: number,
): void {
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", message], new Date(dateMs).toISOString());
}

// A fixed window: 2026-06-01T00:00:00Z .. 2026-06-01T02:00:00Z
const START = Date.UTC(2026, 5, 1, 0, 0, 0);
const END = Date.UTC(2026, 5, 1, 2, 0, 0);
const IN_WINDOW = Date.UTC(2026, 5, 1, 1, 0, 0); // 01:00, inside
const BEFORE_WINDOW = Date.UTC(2026, 4, 1, 0, 0, 0); // a month before

beforeEach(() => {
  repos = [];
});

afterEach(() => {
  for (const dir of repos) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
  repos = [];
});

describe("isTestPath", () => {
  it("matches test directories and filename patterns", () => {
    expect(isTestPath("src/test/foo.ts")).toBe(true);
    expect(isTestPath("src/tests/foo.ts")).toBe(true);
    expect(isTestPath("src/__tests__/foo.ts")).toBe(true);
    expect(isTestPath("foo.test.ts")).toBe(true);
    expect(isTestPath("foo.spec.js")).toBe(true);
    expect(isTestPath("pkg/bar_test.go")).toBe(true);
    expect(isTestPath("test_thing.py")).toBe(true);
    expect(isTestPath("a/b/test_thing.py")).toBe(true);
  });

  it("does not match ordinary source files", () => {
    expect(isTestPath("src/foo.ts")).toBe(false);
    expect(isTestPath("README.md")).toBe(false);
    expect(isTestPath("contest.ts")).toBe(false); // not /test/
    expect(isTestPath("latest.ts")).toBe(false);
  });
});

describe("readGitOutcome", () => {
  const SALT = "secret-salt";

  it("returns null for a non-git directory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ccw-notgit-"));
    repos.push(dir);
    const out = await readGitOutcome({
      cwd: dir,
      branch: "main",
      startMs: START,
      endMs: END,
      aiEditedFiles: [],
      salt: SALT,
    });
    expect(out).toBeNull();
  });

  it("counts commits inside the window with correct LOC and files", async () => {
    const dir = mkrepo();
    writeAndCommit(dir, { "a.ts": "1\n2\n3\n" }, "add a", IN_WINDOW);
    writeAndCommit(dir, { "b.ts": "1\n2\n" }, "add b", IN_WINDOW + 60_000);

    const out = await readGitOutcome({
      cwd: dir,
      branch: "main",
      startMs: START,
      endMs: END,
      aiEditedFiles: [],
      salt: SALT,
    });
    expect(out).not.toBeNull();
    expect(out!.commitsInWindow).toBe(2);
    expect(out!.linesAdded).toBe(5); // 3 + 2
    expect(out!.linesDeleted).toBe(0);
    expect(out!.filesChanged).toBe(2); // a.ts, b.ts
  });

  it("does not count commits dated before the window", async () => {
    const dir = mkrepo();
    writeAndCommit(dir, { "old.ts": "1\n" }, "old", BEFORE_WINDOW);
    writeAndCommit(dir, { "new.ts": "1\n2\n" }, "new", IN_WINDOW);

    const out = await readGitOutcome({
      cwd: dir,
      branch: "main",
      startMs: START,
      endMs: END,
      aiEditedFiles: [],
      salt: SALT,
    });
    expect(out!.commitsInWindow).toBe(1);
    expect(out!.linesAdded).toBe(2);
  });

  it("flags test files via testFilesTouched", async () => {
    const dir = mkrepo();
    writeAndCommit(dir, { "foo.test.ts": "1\n" }, "test", IN_WINDOW);
    const out = await readGitOutcome({
      cwd: dir,
      branch: "main",
      startMs: START,
      endMs: END,
      aiEditedFiles: [],
      salt: SALT,
    });
    expect(out!.testFilesTouched).toBeGreaterThanOrEqual(1);
  });

  it("does not flag plain source files as tests", async () => {
    const dir = mkrepo();
    writeAndCommit(dir, { "foo.ts": "1\n" }, "src", IN_WINDOW);
    const out = await readGitOutcome({
      cwd: dir,
      branch: "main",
      startMs: START,
      endMs: END,
      aiEditedFiles: [],
      salt: SALT,
    });
    expect(out!.testFilesTouched).toBe(0);
  });

  it("links commits to AI-edited files by basename", async () => {
    const dir = mkrepo();
    writeAndCommit(dir, { "foo.ts": "1\n" }, "foo", IN_WINDOW);

    const linked = await readGitOutcome({
      cwd: dir,
      branch: "main",
      startMs: START,
      endMs: END,
      aiEditedFiles: ["/abs/path/foo.ts"],
      salt: SALT,
    });
    expect(linked!.aiLinkedCommits).toBeGreaterThanOrEqual(1);

    const unrelated = await readGitOutcome({
      cwd: dir,
      branch: "main",
      startMs: START,
      endMs: END,
      aiEditedFiles: ["something-else.ts"],
      salt: SALT,
    });
    expect(unrelated!.aiLinkedCommits).toBe(0);
  });

  it("produces stable, salt-sensitive repoIdHash and handles null branch", async () => {
    const dir = mkrepo();
    writeAndCommit(dir, { "a.ts": "1\n" }, "a", IN_WINDOW);

    const base = {
      cwd: dir,
      startMs: START,
      endMs: END,
      aiEditedFiles: [],
    };
    const a = await readGitOutcome({ ...base, branch: "main", salt: "salt-A" });
    const aAgain = await readGitOutcome({ ...base, branch: "main", salt: "salt-A" });
    const b = await readGitOutcome({ ...base, branch: "main", salt: "salt-B" });

    expect(a!.repoIdHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a!.repoIdHash).toBe(aAgain!.repoIdHash); // stable
    expect(a!.repoIdHash).not.toBe(b!.repoIdHash); // salt-sensitive
    expect(a!.branchHash).toMatch(/^[0-9a-f]{64}$/);

    const nullBranch = await readGitOutcome({ ...base, branch: null, salt: "salt-A" });
    expect(nullBranch!.branchHash).toBe("");
  });

  it("reports hasRemote false for a fresh repo", async () => {
    const dir = mkrepo();
    writeAndCommit(dir, { "a.ts": "1\n" }, "a", IN_WINDOW);
    const out = await readGitOutcome({
      cwd: dir,
      branch: "main",
      startMs: START,
      endMs: END,
      aiEditedFiles: [],
      salt: SALT,
    });
    expect(out!.hasRemote).toBe(false);
  });

  it("never leaks paths or messages — output is numbers and hex only", async () => {
    const dir = mkrepo();
    writeAndCommit(dir, { "secret-file.ts": "1\n" }, "secret message", IN_WINDOW);
    const out = await readGitOutcome({
      cwd: dir,
      branch: "main",
      startMs: START,
      endMs: END,
      aiEditedFiles: [],
      salt: SALT,
    });
    const json = JSON.stringify(out);
    expect(json).not.toContain("secret-file");
    expect(json).not.toContain("secret message");
    for (const [key, value] of Object.entries(out!)) {
      if (key.endsWith("Hash")) {
        expect(typeof value === "string" && /^([0-9a-f]{64})?$/.test(value)).toBe(true);
      } else if (typeof value === "boolean") {
        // booleans are fine
      } else if (Array.isArray(value)) {
        // commitHours / commitDows — must be arrays of non-negative integers only
        for (const item of value as unknown[]) {
          expect(typeof item).toBe("number");
          expect(Number.isInteger(item)).toBe(true);
          expect(item as number).toBeGreaterThanOrEqual(0);
        }
      } else if (key === "commitKinds") {
        // fix/feature/refactor/other classification — counts only, never subjects
        for (const n of Object.values(value as Record<string, unknown>)) {
          expect(typeof n).toBe("number");
          expect(Number.isInteger(n)).toBe(true);
          expect(n as number).toBeGreaterThanOrEqual(0);
        }
      } else {
        expect(typeof value).toBe("number");
      }
    }
  });

  it("commitHours bucket matches local hour of commit date; sum equals commitsInWindow", async () => {
    const dir = mkrepo();
    // Use IN_WINDOW as the commit date — derive expected bucket from the same Date object
    // so the test is zone-independent (passes in any TZ).
    const commitDate = new Date(IN_WINDOW);
    const expectedHour = commitDate.getHours();
    writeAndCommit(dir, { "a.ts": "1\n" }, "one commit", IN_WINDOW);

    const out = await readGitOutcome({
      cwd: dir,
      branch: "main",
      startMs: START,
      endMs: END,
      aiEditedFiles: [],
      salt: SALT,
    });
    expect(out).not.toBeNull();
    expect(out!.commitHours).toHaveLength(24);
    expect(out!.commitHours[expectedHour]).toBe(1);
    // Every other bucket is 0.
    const sum = out!.commitHours.reduce((acc, n) => acc + n, 0);
    expect(sum).toBe(out!.commitsInWindow);
  });

  it("commitDows bucket matches local day-of-week of commit date; sum equals commitsInWindow", async () => {
    const dir = mkrepo();
    const commitDate = new Date(IN_WINDOW);
    const expectedDow = commitDate.getDay();
    writeAndCommit(dir, { "b.ts": "1\n" }, "one commit", IN_WINDOW);

    const out = await readGitOutcome({
      cwd: dir,
      branch: "main",
      startMs: START,
      endMs: END,
      aiEditedFiles: [],
      salt: SALT,
    });
    expect(out).not.toBeNull();
    expect(out!.commitDows).toHaveLength(7);
    expect(out!.commitDows[expectedDow]).toBe(1);
    const sum = out!.commitDows.reduce((acc, n) => acc + n, 0);
    expect(sum).toBe(out!.commitsInWindow);
  });

  it("multiple in-window commits accumulate correctly across hours and days", async () => {
    const dir = mkrepo();
    // Two commits at the same IN_WINDOW instant → same hour and DoW buckets get +2.
    writeAndCommit(dir, { "c.ts": "1\n" }, "commit one", IN_WINDOW);
    writeAndCommit(dir, { "d.ts": "1\n" }, "commit two", IN_WINDOW + 60_000);

    const out = await readGitOutcome({
      cwd: dir,
      branch: "main",
      startMs: START,
      endMs: END,
      aiEditedFiles: [],
      salt: SALT,
    });
    expect(out!.commitsInWindow).toBe(2);
    const hourSum = out!.commitHours.reduce((acc, n) => acc + n, 0);
    const dowSum = out!.commitDows.reduce((acc, n) => acc + n, 0);
    expect(hourSum).toBe(2);
    expect(dowSum).toBe(2);
  });

  it("out-of-window commits do not appear in commitHours or commitDows", async () => {
    const dir = mkrepo();
    writeAndCommit(dir, { "old.ts": "1\n" }, "before window", BEFORE_WINDOW);
    writeAndCommit(dir, { "new.ts": "1\n" }, "in window", IN_WINDOW);

    const out = await readGitOutcome({
      cwd: dir,
      branch: "main",
      startMs: START,
      endMs: END,
      aiEditedFiles: [],
      salt: SALT,
    });
    expect(out!.commitsInWindow).toBe(1);
    const hourSum = out!.commitHours.reduce((acc, n) => acc + n, 0);
    const dowSum = out!.commitDows.reduce((acc, n) => acc + n, 0);
    expect(hourSum).toBe(1);
    expect(dowSum).toBe(1);
  });
});
