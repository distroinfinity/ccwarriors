import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// House style mirrors ccusage.ts: promisified execFile, IS_WIN handling,
// a hard timeout and a bounded maxBuffer on every spawn.
const IS_WIN = process.platform === "win32";
const GIT_TIMEOUT_MS = 15_000;
const GIT_MAX_BUFFER = 16 * 1024 * 1024;

// Commits often land moments after the last AI event (the human reviews, then
// commits). Extend the window 30 min past endMs so those still count.
const GRACE_MS = 30 * 60 * 1000;

// How far back (from now) we look for reverts of this session's work.
const REVERT_SCAN_DAYS = 14;
const REVERT_SCAN_MS = REVERT_SCAN_DAYS * 24 * 60 * 60 * 1000;

export interface GitOutcomeInput {
  cwd: string; // session working dir (from JSONL)
  branch: string | null; // gitBranch from JSONL, may be null
  startMs: number; // session first event epoch ms
  endMs: number; // session last event epoch ms
  aiEditedFiles: string[]; // absolute or repo-relative paths the AI Edited/Wrote this session
  salt: string; // per-user secret for hashing (caller provides; stable per machine)
}

export type CommitKind = "fix" | "feature" | "refactor" | "other";

export interface CommitKinds {
  fixes: number;
  features: number;
  refactors: number;
  other: number;
}

/**
 * Classify a commit subject into fix/feature/refactor/other. Conventional
 * prefixes first, keyword fallback second. Counts only ever leave the machine
 * — never the subjects themselves.
 */
export function classifyCommitSubject(subject: string): CommitKind {
  const s = subject.trim().toLowerCase();
  // Conventional-commit prefixes (with optional scope).
  const conv = s.match(/^([a-z]+)(?:\([^)]*\))?[:!]/);
  if (conv) {
    const type = conv[1]!;
    if (type === "fix" || type === "hotfix" || type === "bugfix") return "fix";
    if (type === "feat" || type === "feature") return "feature";
    if (type === "refactor" || type === "perf" || type === "style") return "refactor";
    return "other"; // chore, docs, test, ci, build...
  }
  if (/\b(fix|fixes|fixed|bugfix|hotfix|bug)\b/.test(s)) return "fix";
  if (/^(add|adds|added|implement|implements|introduce|create|new)\b/.test(s) || /\b(feature)\b/.test(s)) return "feature";
  if (/\b(refactor|cleanup|clean up|tidy|simplify|restructure)\b/.test(s)) return "refactor";
  if (/\b(docs?|chore|bump|wip|merge)\b/.test(s)) return "other";
  return "other";
}

export interface SessionGitOutcome {
  repoIdHash: string; // sha256(salt + repoRoot), hex; "" if not a git repo
  branchHash: string; // sha256(salt + branch), hex; "" if branch null
  commitsInWindow: number;
  linesAdded: number;
  linesDeleted: number;
  filesChanged: number;
  testFilesTouched: number; // commits' files matching test globs
  aiLinkedCommits: number; // commits whose changed files intersect aiEditedFiles (basename match)
  revertedLinesWithin14d: number; // lines from in-window commits later reverted (trailing 14d scan)
  squashMergeDetected: boolean;
  rebaseDetected: boolean;
  isMonorepo: boolean; // >1 distinct top-level dir among changed files
  hasRemote: boolean;
  commitHours: number[]; // length 24; count of in-window commits per local hour-of-day (0-23)
  commitDows: number[]; // length 7; count of in-window commits per local day-of-week (0=Sun..6=Sat)
  commitKinds?: CommitKinds; // fix/feature/refactor/other counts from commit subjects (counts only)
}

function sha256(salt: string, value: string): string {
  return createHash("sha256")
    .update(salt + value)
    .digest("hex");
}

/**
 * A path is a "test file" if it lives under a test directory or its basename
 * matches a conventional test naming pattern. Exported for unit testing.
 */
export function isTestPath(path: string): boolean {
  const p = path.replace(/\\/g, "/");
  if (p.includes("/test/") || p.includes("/tests/") || p.includes("/__tests__/")) return true;
  // also handle a leading segment with no slash prefix (e.g. "tests/foo.ts")
  if (/^(test|tests|__tests__)\//.test(p)) return true;
  const base = p.slice(p.lastIndexOf("/") + 1);
  if (/\.test\./.test(base)) return true;
  if (/\.spec\./.test(base)) return true;
  if (/_test\./.test(base)) return true;
  if (/^test_.*\.py$/.test(base)) return true;
  return false;
}

function basename(path: string): string {
  const p = path.replace(/\\/g, "/");
  return p.slice(p.lastIndexOf("/") + 1);
}

function topSegment(path: string): string {
  const p = path.replace(/\\/g, "/").replace(/^\/+/, "");
  const i = p.indexOf("/");
  return i === -1 ? "" : p.slice(0, i);
}

/** Run a git command; return stdout, or null on ANY failure. Never throws. */
async function git(root: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", root, ...args], {
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
      shell: IS_WIN,
      windowsHide: true,
    });
    return stdout;
  } catch {
    return null;
  }
}

interface ParsedCommit {
  sha: string;
  dateMs: number;
  message: string;
  files: string[];
  added: number;
  deleted: number;
}

// We tag each log line so the parser can't confuse a header with a numstat row
// even if a commit message somehow resembled one. %x09 is a literal TAB.
const HDR = "\x01C\x01"; // unlikely sentinel prefix for header lines
const LOG_FORMAT = `${HDR}%H%x09%aI%x09%s`;

/**
 * Parse `git log --numstat --format=<LOG_FORMAT>` output into commit blocks.
 * Header line:  <HDR>SHA \t author-ISO \t subject
 * Numstat line: added \t deleted \t path   (binary files show "-")
 */
function parseLog(stdout: string): ParsedCommit[] {
  const commits: ParsedCommit[] = [];
  let cur: ParsedCommit | null = null;
  for (const line of stdout.split("\n")) {
    if (line.startsWith(HDR)) {
      if (cur) commits.push(cur);
      const rest = line.slice(HDR.length);
      const parts = rest.split("\t");
      const sha = parts[0] ?? "";
      const iso = parts[1] ?? "";
      const message = parts.slice(2).join("\t");
      const t = Date.parse(iso);
      cur = {
        sha,
        dateMs: Number.isFinite(t) ? t : 0,
        message,
        files: [],
        added: 0,
        deleted: 0,
      };
      continue;
    }
    if (!cur || line === "") continue;
    const cols = line.split("\t");
    if (cols.length < 3) continue;
    const a = cols[0] ?? "";
    const d = cols[1] ?? "";
    const path = cols.slice(2).join("\t");
    if (!path) continue;
    // "-" marks a binary file; count it as a changed file, 0 LOC.
    const addN = a === "-" ? 0 : Number.parseInt(a, 10);
    const delN = d === "-" ? 0 : Number.parseInt(d, 10);
    if (Number.isFinite(addN)) cur.added += addN;
    if (Number.isFinite(delN)) cur.deleted += delN;
    cur.files.push(path);
  }
  if (cur) commits.push(cur);
  return commits;
}

function zeroOutcome(repoIdHash: string, branchHash: string, hasRemote: boolean): SessionGitOutcome {
  return {
    repoIdHash,
    branchHash,
    commitsInWindow: 0,
    linesAdded: 0,
    linesDeleted: 0,
    filesChanged: 0,
    testFilesTouched: 0,
    aiLinkedCommits: 0,
    revertedLinesWithin14d: 0,
    squashMergeDetected: false,
    rebaseDetected: false,
    isMonorepo: false,
    hasRemote,
    commitHours: Array(24).fill(0) as number[],
    commitDows: Array(7).fill(0) as number[],
  };
}

/**
 * Read LOCAL git outcomes for one coding session. Offline, never throws.
 *
 * Privacy contract: the returned object contains ONLY numbers, booleans, and
 * salted sha256 hex hashes. No code, diffs, paths, commit messages, or SHAs
 * ever leave this function.
 *
 * Returns null when cwd is not inside a git repo (caller treats as no-outcome).
 */
export async function readGitOutcome(input: GitOutcomeInput): Promise<SessionGitOutcome | null> {
  try {
    const { cwd, branch, startMs, endMs, aiEditedFiles, salt } = input;

    // Resolve repo root. Failure here means "not a git repo" → null.
    const topRaw = await git(cwd, ["rev-parse", "--show-toplevel"]);
    if (topRaw === null) return null;
    const root = topRaw.trim();
    if (!root) return null;

    const repoIdHash = sha256(salt, root);
    const branchHash = branch ? sha256(salt, branch) : "";

    // hasRemote: any configured remote.
    const remoteOut = await git(root, ["remote"]);
    const hasRemote = remoteOut !== null && remoteOut.trim().length > 0;

    // Choose the ref: the session's branch if it resolves, else HEAD.
    let ref = "HEAD";
    if (branch) {
      const verify = await git(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
      if (verify !== null && verify.trim().length > 0) ref = branch;
    }

    const sinceIso = new Date(startMs).toISOString();
    const untilIso = new Date(endMs + GRACE_MS).toISOString();

    const logOut = await git(root, [
      "log",
      ref,
      "--no-merges",
      `--since=${sinceIso}`,
      `--until=${untilIso}`,
      "--numstat",
      `--format=${LOG_FORMAT}`,
    ]);

    // If the log read failed, return a zero-filled outcome (we still know the
    // repo identity / remote) rather than null — the repo IS a git repo.
    if (logOut === null) {
      return zeroOutcome(repoIdHash, branchHash, hasRemote);
    }

    const commits = parseLog(logOut);

    let linesAdded = 0;
    let linesDeleted = 0;
    let testFilesTouched = 0;
    let aiLinkedCommits = 0;
    const distinctFiles = new Set<string>();
    const topSegs = new Set<string>();
    const windowFiles = new Set<string>(); // basenames, for revert overlap
    let squashMergeDetected = false;
    const commitHours: number[] = Array(24).fill(0);
    const commitDows: number[] = Array(7).fill(0);

    const aiBasenames = new Set(aiEditedFiles.map(basename).filter((b) => b.length > 0));
    const commitKinds: CommitKinds = { fixes: 0, features: 0, refactors: 0, other: 0 };

    for (const c of commits) {
      linesAdded += c.added;
      linesDeleted += c.deleted;
      const kind = classifyCommitSubject(c.message);
      if (kind === "fix") commitKinds.fixes++;
      else if (kind === "feature") commitKinds.features++;
      else if (kind === "refactor") commitKinds.refactors++;
      else commitKinds.other++;

      // Hour/DoW histograms: bucket by local time. If date is unparseable
      // (dateMs === 0 from parseLog fallback), skip gracefully.
      if (c.dateMs !== 0) {
        const d = new Date(c.dateMs);
        (commitHours[d.getHours()] as number)++;
        (commitDows[d.getDay()] as number)++;
      }
      let linkedThisCommit = false;
      for (const f of c.files) {
        distinctFiles.add(f);
        if (isTestPath(f)) testFilesTouched++;
        const seg = topSegment(f);
        if (seg) topSegs.add(seg);
        const b = basename(f);
        windowFiles.add(b);
        if (aiBasenames.has(b)) linkedThisCommit = true;
      }
      if (linkedThisCommit) aiLinkedCommits++;

      // Squash heuristic (best-effort, under-detection is fine): a single
      // commit that touches >=5 files AND whose subject carries a PR-number
      // marker like "(#123)" looks like a squash-merge of a feature branch.
      if (c.files.length >= 5 && /\(#\d+\)/.test(c.message)) {
        squashMergeDetected = true;
      }
    }

    const filesChanged = distinctFiles.size;
    const isMonorepo = topSegs.size > 1;
    const inWindowLinesAdded = linesAdded;

    // ---- Revert detection (best-effort, conservative, never throws) --------
    // Heuristic: scan the trailing 14 days for revert commits (subject starts
    // with "revert", case-insensitive). If any such revert touches a file
    // (by basename) that overlaps this session's in-window commits, attribute
    // min(inWindowLinesAdded, revert.linesDeleted) as reverted lines. We sum
    // across overlapping reverts but cap the total at inWindowLinesAdded so we
    // never over-count. Under-counting is the safe failure mode.
    let revertedLinesWithin14d = 0;
    const revertSinceIso = new Date(Date.now() - REVERT_SCAN_MS).toISOString();
    const revertOut = await git(root, [
      "log",
      ref,
      "-i",
      "--grep=revert",
      `--since=${revertSinceIso}`,
      "--numstat",
      `--format=${LOG_FORMAT}`,
    ]);
    if (revertOut !== null && windowFiles.size > 0) {
      const reverts = parseLog(revertOut);
      for (const r of reverts) {
        if (!/^revert/i.test(r.message)) continue;
        const overlaps = r.files.some((f) => windowFiles.has(basename(f)));
        if (!overlaps) continue;
        revertedLinesWithin14d += Math.min(inWindowLinesAdded, r.deleted);
      }
      if (revertedLinesWithin14d > inWindowLinesAdded) {
        revertedLinesWithin14d = inWindowLinesAdded;
      }
    }

    // ---- Rebase detection (best-effort) -----------------------------------
    // The reflog records "rebase" entries; presence since session start is a
    // strong signal. Some environments have reflog disabled — treat as false.
    let rebaseDetected = false;
    const reflogOut = await git(root, ["reflog", `--since=${sinceIso}`]);
    if (reflogOut !== null && /rebase/i.test(reflogOut)) rebaseDetected = true;

    return {
      repoIdHash,
      branchHash,
      commitsInWindow: commits.length,
      linesAdded,
      linesDeleted,
      filesChanged,
      testFilesTouched,
      aiLinkedCommits,
      revertedLinesWithin14d,
      squashMergeDetected,
      rebaseDetected,
      isMonorepo,
      hasRemote,
      commitHours,
      commitDows,
      commitKinds,
    };
  } catch {
    // Absolute backstop: this function must never throw.
    return null;
  }
}
