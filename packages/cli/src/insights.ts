// Local behavioral extraction from Claude Code session JSONL. Deterministic
// event counting — no LLM, no transcript text retained or uploaded. Per-file
// results are cached (path+size+mtime) so repeat syncs only parse new lines'
// worth of files. See spec §3.3.
import { createReadStream, existsSync } from "node:fs";
import { readFile, writeFile, readdir, stat, mkdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { join } from "node:path";
import { readGitOutcome, type SessionGitOutcome } from "./git.js";

export const WINDOW_DAYS = 40;
const EXPLORE_TOOLS = new Set(["Read", "Grep", "Glob"]);
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const SPAWN_TOOLS = new Set(["Task", "Agent"]);

export interface SessionStats {
  prompts: number;
  interrupts: number;
  usedPlanMode: boolean;
  exploreBeforeFirstEdit: boolean;
  hadEdits: boolean;
  subagentSpawns: number;
  maxParallel: number;
  editCalls: number;
  assistantTurns: number;
  startHour: number; // machine-local 0-23
  durationMinutes: number;
  wordBuckets: { "1-5": number; "6-10": number; "11-25": number; "26+": number };
  // ── richer per-session signal (some LOCAL-ONLY; see PRIVACY CONTRACT) ──
  startMs: number | null; // first event epoch ms
  endMs: number | null; // last event epoch ms
  cwd: string | null; // LOCAL-ONLY: input to readGitOutcome, never uploaded
  gitBranch: string | null; // LOCAL-ONLY: input to readGitOutcome, never uploaded
  model: string | null; // model on the most assistant turns (safe to upload)
  editedFiles: string[]; // LOCAL-ONLY: input to readGitOutcome, never uploaded
  eventGapsMs: number[]; // LOCAL-ONLY: collapsed to a timing summary before upload
}

export interface InsightsPayload {
  windowDays: number;
  sessions: number;
  promptWordHistogram: { "1-5": number; "6-10": number; "11-25": number; "26+": number };
  planModeSessionsPct: number;
  exploreBeforeEditRatio: number;
  avgTurnsBetweenUserMsgs: number;
  interruptsPer100Turns: number;
  subagentSpawnsPerSession: number;
  maxParallelAgents: number;
  hourHistogram: number[];
  editToolCallsPerSession: number;
  longestSessionMinutes: number;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

function promptText(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const blocks = content.filter((b): b is Record<string, unknown> => !!b && typeof b === "object");
    if (blocks.some((b) => b["type"] === "tool_result")) return null; // tool result, not a prompt
    const texts = blocks
      .filter((b) => b["type"] === "text" && typeof b["text"] === "string")
      .map((b) => b["text"] as string);
    return texts.length > 0 ? texts.join(" ") : null;
  }
  return null;
}

/** Parse one session file's lines into counts. Null when no conversation found. */
export async function parseSessionLines(
  lines: Iterable<string> | AsyncIterable<string>,
): Promise<SessionStats | null> {
  let prompts = 0, interrupts = 0, subagentSpawns = 0, maxParallel = 0, editCalls = 0, assistantTurns = 0;
  let usedPlanMode = false, hadEdits = false;
  let exploreBeforeFirstEdit = false, sawExplore = false, sawEdit = false;
  let firstTs: number | null = null, lastTs: number | null = null, prevTs: number | null = null;
  const wordBuckets = { "1-5": 0, "6-10": 0, "11-25": 0, "26+": 0 };
  let cwd: string | null = null;
  let gitBranch: string | null = null;
  const modelCounts = new Map<string, number>();
  const editedFiles = new Set<string>();
  const eventGapsMs: number[] = [];

  for await (const line of lines) {
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const type = o["type"];
    if (type !== "user" && type !== "assistant") continue;
    if (o["isSidechain"] === true) continue;
    const ts = typeof o["timestamp"] === "string" ? new Date(o["timestamp"]).getTime() : NaN;
    if (Number.isFinite(ts)) {
      if (firstTs === null) firstTs = ts;
      lastTs = ts; // Last record's ts, not max — mildly out-of-order writes only skew duration, never the payload counts.
      if (prevTs !== null) eventGapsMs.push(Math.max(0, ts - prevTs));
      prevTs = ts;
    }
    if (cwd === null && typeof o["cwd"] === "string" && o["cwd"]) cwd = o["cwd"];
    if (gitBranch === null && typeof o["gitBranch"] === "string" && o["gitBranch"]) gitBranch = o["gitBranch"];
    const message = o["message"] as Record<string, unknown> | undefined;

    if (type === "user") {
      if (o["isMeta"] === true) continue;
      if (o["permissionMode"] === "plan") usedPlanMode = true;
      const text = promptText(message?.["content"]);
      if (text === null) continue;
      prompts++;
      if (text.includes("[Request interrupted")) interrupts++;
      const words = text.trim().split(/\s+/).filter(Boolean).length;
      if (words <= 5) wordBuckets["1-5"]++;
      else if (words <= 10) wordBuckets["6-10"]++;
      else if (words <= 25) wordBuckets["11-25"]++;
      else wordBuckets["26+"]++;
      continue;
    }

    // assistant
    assistantTurns++;
    const model = message?.["model"];
    if (typeof model === "string" && model) modelCounts.set(model, (modelCounts.get(model) ?? 0) + 1);
    const content = message?.["content"];
    if (!Array.isArray(content)) continue;
    let parallel = 0;
    for (const b of content) {
      if (!b || typeof b !== "object" || (b as Record<string, unknown>)["type"] !== "tool_use") continue;
      const block = b as Record<string, unknown>;
      const name = String(block["name"] ?? "");
      if (SPAWN_TOOLS.has(name)) {
        subagentSpawns++;
        parallel++;
      }
      if (EXPLORE_TOOLS.has(name) && !sawEdit) sawExplore = true;
      if (EDIT_TOOLS.has(name)) {
        if (!sawEdit && sawExplore) exploreBeforeFirstEdit = true;
        sawEdit = true;
        hadEdits = true;
        editCalls++;
        const inp = block["input"] as Record<string, unknown> | undefined;
        const fp = inp?.["file_path"];
        if (typeof fp === "string" && fp) editedFiles.add(fp);
      }
    }
    maxParallel = Math.max(maxParallel, parallel);
  }

  if (prompts === 0 && assistantTurns === 0) return null;
  const startHour = firstTs !== null ? new Date(firstTs).getHours() : 12;
  const durationMinutes = firstTs !== null && lastTs !== null ? Math.max(0, (lastTs - firstTs) / 60_000) : 0;
  let model: string | null = null;
  let modelBest = 0;
  for (const [name, count] of modelCounts) {
    if (count > modelBest) {
      modelBest = count;
      model = name;
    }
  }
  return {
    prompts, interrupts, usedPlanMode, exploreBeforeFirstEdit, hadEdits,
    subagentSpawns, maxParallel, editCalls, assistantTurns, startHour, durationMinutes, wordBuckets,
    startMs: firstTs, endMs: lastTs, cwd, gitBranch, model,
    editedFiles: [...editedFiles], eventGapsMs,
  };
}

export function aggregateSessions(sessions: SessionStats[], windowDays: number): InsightsPayload {
  const n = Math.max(1, sessions.length);
  const sum = (f: (s: SessionStats) => number) => sessions.reduce((a, s) => a + f(s), 0);
  const hist = { "1-5": 0, "6-10": 0, "11-25": 0, "26+": 0 };
  const hours = Array(24).fill(0) as number[];
  for (const s of sessions) {
    for (const k of Object.keys(hist) as (keyof typeof hist)[]) hist[k] += s.wordBuckets[k];
    hours[s.startHour] = (hours[s.startHour] ?? 0) + 1;
  }
  const totalPrompts = Math.max(1, sum((s) => s.prompts));
  const totalTurns = Math.max(1, sum((s) => s.assistantTurns));
  const withEdits = sessions.filter((s) => s.hadEdits);
  return {
    windowDays,
    sessions: sessions.length,
    promptWordHistogram: hist,
    planModeSessionsPct: r1((sessions.filter((s) => s.usedPlanMode).length / n) * 100),
    exploreBeforeEditRatio:
      withEdits.length === 0
        ? 0
        : Math.round((withEdits.filter((s) => s.exploreBeforeFirstEdit).length / withEdits.length) * 100) / 100,
    avgTurnsBetweenUserMsgs: r1(totalTurns / totalPrompts),
    interruptsPer100Turns: r1((sum((s) => s.interrupts) / totalTurns) * 100),
    subagentSpawnsPerSession: r1(sum((s) => s.subagentSpawns) / n),
    maxParallelAgents: Math.max(0, ...sessions.map((s) => s.maxParallel)),
    hourHistogram: hours,
    editToolCallsPerSession: r1(sum((s) => s.editCalls) / n),
    longestSessionMinutes: r1(Math.min(7 * 24 * 60, Math.max(0, ...sessions.map((s) => s.durationMinutes)))),
  };
}

// ── Per-session timing summary (bounded; for later gaming detection) ────────

/**
 * Collapse raw inter-event gaps into a small, bounded summary. The raw gap
 * array is LOCAL-ONLY and never uploaded; only this summary travels.
 * events = gaps.length + 1. median/p10 are 0 when fewer than 2 events.
 */
export function timingSummary(gapsMs: number[]): {
  events: number;
  medianGapMs: number;
  p10GapMs: number;
  subSecondFraction: number;
} {
  const events = gapsMs.length + 1;
  if (gapsMs.length === 0) {
    return { events, medianGapMs: 0, p10GapMs: 0, subSecondFraction: 0 };
  }
  const sorted = [...gapsMs].sort((a, b) => a - b);
  const quantile = (q: number): number => {
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
    return sorted[idx] ?? 0;
  };
  const subSecond = gapsMs.filter((g) => g < 1000).length;
  return {
    events,
    medianGapMs: Math.round(quantile(0.5)),
    p10GapMs: Math.round(quantile(0.1)),
    subSecondFraction: Math.round((subSecond / gapsMs.length) * 1000) / 1000,
  };
}

// ── Filesystem walk + cache ─────────────────────────────────────────────────

// Bump when the cached SessionStats shape changes so older caches are
// discarded and re-parsed (an old entry would be missing newer fields like
// cwd/editedFiles/eventGapsMs, breaking the deep path). v3: purges caches
// poisoned by the unbumped v2 shape change (entries without eventGapsMs).
const CACHE_VERSION = 3;

/**
 * Structural check on a cached SessionStats. The version bump handles known
 * shape changes; this guards against the next UNbumped one — a malformed
 * cached entry is treated as a cache miss and re-parsed, never trusted.
 */
export function isValidSessionStats(x: unknown): x is SessionStats {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  const numeric = ["prompts", "interrupts", "subagentSpawns", "maxParallel", "editCalls", "assistantTurns", "startHour", "durationMinutes"];
  for (const k of numeric) if (typeof o[k] !== "number") return false;
  const booleans = ["usedPlanMode", "exploreBeforeFirstEdit", "hadEdits"];
  for (const k of booleans) if (typeof o[k] !== "boolean") return false;
  const wb = o["wordBuckets"] as Record<string, unknown> | undefined;
  if (!wb || typeof wb !== "object") return false;
  for (const k of ["1-5", "6-10", "11-25", "26+"]) if (typeof wb[k] !== "number") return false;
  if (!Array.isArray(o["eventGapsMs"])) return false;
  if (!Array.isArray(o["editedFiles"])) return false;
  // Nullable fields must be PRESENT (null is fine; absent means stale shape).
  for (const k of ["startMs", "endMs", "cwd", "gitBranch", "model"]) if (!(k in o)) return false;
  return true;
}

interface CacheFile {
  version?: number;
  files: Record<string, { size: number; mtimeMs: number; stats: SessionStats | null }>;
  lastSentAt?: string;
}

const HOME = process.env["CCWARRIORS_HOME"] ?? join(homedir(), ".claude-warriors");
const CACHE_PATH = join(HOME, "insights-cache.json");
const PROJECTS_DIR = process.env["CCWARRIORS_CLAUDE_DIR"] ?? join(homedir(), ".claude", "projects");

async function loadCache(): Promise<CacheFile> {
  try {
    const cache = JSON.parse(await readFile(CACHE_PATH, "utf8")) as CacheFile;
    // Stale schema → drop parsed entries (keep lastSentAt throttle), re-parse.
    if (cache.version !== CACHE_VERSION) {
      return { version: CACHE_VERSION, files: {}, lastSentAt: cache.lastSentAt };
    }
    return cache;
  } catch {
    return { version: CACHE_VERSION, files: {} };
  }
}

async function saveCache(cache: CacheFile): Promise<void> {
  cache.version = CACHE_VERSION;
  await mkdir(HOME, { recursive: true, mode: 0o700 });
  await writeFile(CACHE_PATH, JSON.stringify(cache), { encoding: "utf8", mode: 0o600 });
}

async function parseFile(path: string): Promise<SessionStats | null> {
  const rl = createInterface({ input: createReadStream(path, "utf8"), crlfDelay: Infinity });
  return parseSessionLines(rl);
}

/**
 * Walk the project dirs, parsing every in-window session file (with the
 * path+size+mtime cache so repeat runs only re-parse new/changed files), and
 * return the resulting SessionStats. Shared by collectInsights (aggregate) and
 * collectDeepInsights (per-session). Returns [] if PROJECTS_DIR is absent.
 */
async function walkSessions(): Promise<SessionStats[]> {
  if (!existsSync(PROJECTS_DIR)) return [];
  const cutoff = Date.now() - WINDOW_DAYS * 86_400_000;
  const cache = await loadCache();
  const seen = new Set<string>();
  const sessions: SessionStats[] = [];

  const projectDirs = await readdir(PROJECTS_DIR, { withFileTypes: true });
  for (const dirent of projectDirs) {
    if (!dirent.isDirectory()) continue;
    const dir = join(PROJECTS_DIR, dirent.name);
    let files: string[];
    try {
      files = (await readdir(dir)).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const f of files) {
      const full = join(dir, f);
      let st;
      try {
        st = await stat(full);
      } catch {
        continue;
      }
      if (st.mtimeMs < cutoff) continue; // outside window
      seen.add(full);
      const cached = cache.files[full];
      let stats: SessionStats | null;
      if (
        cached &&
        cached.size === st.size &&
        cached.mtimeMs === st.mtimeMs &&
        (cached.stats === null || isValidSessionStats(cached.stats))
      ) {
        stats = cached.stats;
      } else {
        try {
          stats = await parseFile(full);
        } catch {
          // File vanished between stat and read → catch stores null; pruned next run.
          stats = null;
        }
        cache.files[full] = { size: st.size, mtimeMs: st.mtimeMs, stats };
      }
      if (stats) sessions.push(stats);
    }
  }

  // Drop cache entries for files gone or aged out (bound the cache size).
  for (const key of Object.keys(cache.files)) if (!seen.has(key)) delete cache.files[key];
  await saveCache(cache);

  return sessions;
}

/** Collect insights for sessions modified within the window. Cache makes
    repeat runs parse only new/changed files. */
export async function collectInsights(): Promise<InsightsPayload | null> {
  const sessions = await walkSessions();
  if (sessions.length === 0) return null;
  return aggregateSessions(sessions, WINDOW_DAYS);
}

// ── Deep per-session extraction (Craft Score) ───────────────────────────────

export interface SessionRecord {
  startHour: number; durationMinutes: number; prompts: number; interrupts: number;
  usedPlanMode: boolean; exploreBeforeFirstEdit: boolean; hadEdits: boolean;
  subagentSpawns: number; maxParallel: number; editCalls: number; assistantTurns: number;
  wordBuckets: { "1-5": number; "6-10": number; "11-25": number; "26+": number };
  model: string | null;
  timing: { events: number; medianGapMs: number; p10GapMs: number; subSecondFraction: number };
  git: SessionGitOutcome | null;
}

export interface InsightsDeepPayload {
  windowDays: number;
  sessions: SessionRecord[];
}

/**
 * Build the uploadable SessionRecord from a (richer) SessionStats. PRIVACY
 * CONTRACT: cwd, gitBranch, editedFiles, and the raw eventGapsMs are dropped
 * here — only counts, the timing summary, the model name, and the hashed git
 * outcome survive.
 */
// A session's wall-clock span is capped at 7 days. Idle gaps (a session left
// open across days) otherwise blow past the server's max (10080 min) and get
// the whole upload rejected. Matches aggregateSessions' longestSessionMinutes cap.
const MAX_SESSION_MINUTES = 7 * 24 * 60;

function toSessionRecord(s: SessionStats, git: SessionGitOutcome | null): SessionRecord {
  return {
    startHour: s.startHour,
    durationMinutes: r1(Math.min(MAX_SESSION_MINUTES, s.durationMinutes)),
    prompts: s.prompts,
    interrupts: s.interrupts,
    usedPlanMode: s.usedPlanMode,
    exploreBeforeFirstEdit: s.exploreBeforeFirstEdit,
    hadEdits: s.hadEdits,
    subagentSpawns: s.subagentSpawns,
    maxParallel: s.maxParallel,
    editCalls: s.editCalls,
    assistantTurns: s.assistantTurns,
    wordBuckets: s.wordBuckets,
    model: s.model,
    timing: timingSummary(s.eventGapsMs ?? []),
    git,
  };
}

/**
 * Discriminated result so callers can tell "you have no sessions" (empty) from
 * "your sessions exist but extraction broke" (error). Conflating the two
 * shipped a bug where a poisoned cache made the CLI tell users with hundreds
 * of sessions that they had none.
 */
export type DeepCollectResult =
  | { status: "ok"; payload: InsightsDeepPayload }
  | { status: "empty" }
  | { status: "error"; message: string };

/**
 * Deep per-session insights: one SessionRecord per in-window session, each
 * coupled to its LOCAL-git outcome (hashed). The salt is the per-user secret
 * from config (LOCAL-ONLY). Never throws — git reads already return null on
 * failure and any other failure surfaces as { status: "error" }.
 */
export async function collectDeepInsights(salt: string): Promise<DeepCollectResult> {
  try {
    const sessions = await walkSessions();
    if (sessions.length === 0) return { status: "empty" };

    // Memoize "is this cwd inside a git repo": once a cwd is known non-git, a
    // later session in the same cwd skips the git spawns entirely. (readGitOutcome
    // returns null for non-repos.) Bounds the serial cost on big histories where
    // many sessions share a handful of cwds.
    const repoKnown = new Map<string, boolean>(); // cwd → is-git-repo

    // Run the per-session git reads with a concurrency cap so 150+ git-linked
    // sessions don't fire ~6 spawns each all at once (or one slow serial chain).
    // Hand-rolled chunked pool, no new deps. Each read never throws.
    const CONCURRENCY = 6;
    const records: SessionRecord[] = new Array<SessionRecord>(sessions.length);

    const readOne = async (i: number): Promise<void> => {
      const s = sessions[i]!;
      let git: SessionGitOutcome | null = null;
      if (s.cwd && s.startMs !== null && s.endMs !== null) {
        const cwd = s.cwd;
        if (repoKnown.get(cwd) === false) {
          git = null; // already proven non-git → skip the spawns
        } else {
          // readGitOutcome never throws and returns null quickly for non-repos.
          git = await readGitOutcome({
            cwd,
            branch: s.gitBranch,
            startMs: s.startMs,
            endMs: s.endMs,
            aiEditedFiles: s.editedFiles ?? [],
            salt,
          });
          repoKnown.set(cwd, git !== null);
        }
      }
      records[i] = toSessionRecord(s, git);
    };

    for (let start = 0; start < sessions.length; start += CONCURRENCY) {
      const chunk: Promise<void>[] = [];
      for (let i = start; i < Math.min(start + CONCURRENCY, sessions.length); i++) {
        chunk.push(readOne(i));
      }
      await Promise.all(chunk);
    }

    return { status: "ok", payload: { windowDays: WINDOW_DAYS, sessions: records } };
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

const SEND_INTERVAL_MS = 6 * 60 * 60 * 1000; // network throttle: at most every 6h

export async function shouldSend(now: number = Date.now()): Promise<boolean> {
  const cache = await loadCache();
  if (!cache.lastSentAt) return true;
  return now - new Date(cache.lastSentAt).getTime() > SEND_INTERVAL_MS;
}

export async function markSent(now: number = Date.now()): Promise<void> {
  const cache = await loadCache();
  cache.lastSentAt = new Date(now).toISOString();
  await saveCache(cache);
}
