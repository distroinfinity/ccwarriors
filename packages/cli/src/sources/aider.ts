import { blankSessionStats, type SessionStats } from "../session-stats.js";

// Sentinel + format for the aider `git log` read. The trailers atom pulls the
// Co-authored-by value(s) onto the header line so one pass yields date + files
// + authorship. %x09 is TAB; %x1f is the US separator between multiple values.
const HDR = "\x01A\x01";
const SEP = "\x1f";
export const AIDER_LOG_FORMAT = `${HDR}%H%x09%aI%x09%(trailers:key=Co-authored-by,valueonly,separator=${SEP})`;

// Aider's commit trailer carries an aider.chat email. Tolerant to aider@ and
// noreply@ variants, and to the model appearing as "aider (model)".
const AIDER_TRAILER = /aider\.chat/i;
const AIDER_MODEL = /aider\s*\(([^)]+)\)/i;

// Start a new aider session when the gap between consecutive aider commits
// exceeds this. Commit timestamps are the only signal we have; this is a
// documented heuristic, not a precise session boundary.
export const AIDER_SESSION_GAP_MS = 30 * 60 * 1000;

export interface AiderCommit {
  dateMs: number;
  files: string[]; // repo-relative paths from numstat (LOCAL-ONLY)
  model: string | null;
}

/**
 * Parse `git log --numstat --format=AIDER_LOG_FORMAT` output, returning ONLY
 * commits whose Co-authored-by trailer is aider's. Tolerant per §3.5.3:
 * malformed rows are skipped; a non-aider commit is dropped; bad input → [].
 */
export function parseAiderLog(stdout: string): AiderCommit[] {
  const out: AiderCommit[] = [];
  let cur: { dateMs: number; coauthors: string; files: string[] } | null = null;
  const flush = () => {
    if (cur && AIDER_TRAILER.test(cur.coauthors)) {
      const m = cur.coauthors.match(AIDER_MODEL);
      out.push({ dateMs: cur.dateMs, files: cur.files, model: m ? m[1]!.trim() : null });
    }
    cur = null;
  };
  for (const line of stdout.split("\n")) {
    if (line.startsWith(HDR)) {
      flush();
      const parts = line.slice(HDR.length).split("\t");
      const iso = parts[1] ?? "";
      const t = Date.parse(iso);
      cur = { dateMs: Number.isFinite(t) ? t : 0, coauthors: parts[2] ?? "", files: [] };
      continue;
    }
    if (!cur || line === "") continue;
    const cols = line.split("\t");
    if (cols.length < 3) continue; // not a numstat row
    const path = cols.slice(2).join("\t");
    if (path) cur.files.push(path);
  }
  flush();
  return out;
}

function basename(p: string): string {
  const q = p.replace(/\\/g, "/");
  return q.slice(q.lastIndexOf("/") + 1);
}

/**
 * Cluster aider commits into time-proximate sessions, one SessionStats per
 * cluster. editedFiles are basenames (LOCAL-ONLY input to readGitOutcome;
 * dropped before upload). assistantTurns = commit count (a cost-weight proxy).
 */
export function clusterAiderCommits(
  commits: AiderCommit[],
  cwd: string,
  gapMs: number = AIDER_SESSION_GAP_MS,
): SessionStats[] {
  const sorted = [...commits].filter((c) => c.dateMs > 0).sort((a, b) => a.dateMs - b.dateMs);
  const out: SessionStats[] = [];
  let group: AiderCommit[] = [];
  const emit = () => {
    if (group.length === 0) return;
    const s = blankSessionStats("aider");
    s.cwd = cwd;
    s.startMs = group[0]!.dateMs;
    s.endMs = group[group.length - 1]!.dateMs;
    s.startHour = new Date(s.startMs).getHours();
    s.durationMinutes = Math.max(0, (s.endMs - s.startMs) / 60_000);
    s.assistantTurns = group.length;
    const files = new Set<string>();
    for (const c of group) for (const f of c.files) {
      const b = basename(f);
      if (b) files.add(b);
    }
    s.editedFiles = [...files];
    s.model = group.find((c) => c.model)?.model ?? null;
    out.push(s);
    group = [];
  };
  for (const c of sorted) {
    if (group.length && c.dateMs - group[group.length - 1]!.dateMs > gapMs) emit();
    group.push(c);
  }
  emit();
  return out;
}
