// Local behavioral extraction from Claude Code session JSONL. Deterministic
// event counting — no LLM, no transcript text retained or uploaded. Per-file
// results are cached (path+size+mtime) so repeat syncs only parse new lines'
// worth of files. See spec §3.3.
import { createReadStream, existsSync } from "node:fs";
import { readFile, writeFile, readdir, stat, mkdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { readGitOutcome, type SessionGitOutcome } from "./git.js";
import { redact } from "./redact.js";
import type { SessionStats } from "./session-stats.js";
export type { SessionStats };

export const WINDOW_DAYS = 40;
const EXPLORE_TOOLS = new Set(["Read", "Grep", "Glob"]);
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const SPAWN_TOOLS = new Set(["Task", "Agent"]);
const SKILL_TOOLS = new Set(["Skill"]);

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
  let thankYous = 0, wordTotal = 0;
  const extensions: Record<string, number> = {};
  let skillSpawns = 0;
  const skillsUsed: Record<string, number> = {};
  const shortPrompts: string[] = [];
  // Recovery: a "failure loop" is ≥3 consecutive error tool_results (assistant
  // turns in between don't reset it). Breakout = first success or real prompt.
  let recoveryLoops = 0;
  const recoveryBreakoutMs: number[] = [];
  let errorRun = 0;
  let errorRunStartTs: number | null = null;
  const endErrorRun = (ts: number | null) => {
    if (errorRun >= 3) {
      recoveryLoops++;
      if (ts !== null && errorRunStartTs !== null) recoveryBreakoutMs.push(Math.max(0, ts - errorRunStartTs));
    }
    errorRun = 0;
    errorRunStartTs = null;
  };

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
      // Tool results ride user-type messages: track error runs for recovery.
      const content = message?.["content"];
      if (Array.isArray(content)) {
        const results = content.filter(
          (b): b is Record<string, unknown> => !!b && typeof b === "object" && (b as Record<string, unknown>)["type"] === "tool_result",
        );
        for (const r of results) {
          if (r["is_error"] === true) {
            errorRun++;
            if (errorRunStartTs === null && Number.isFinite(ts)) errorRunStartTs = ts;
          } else {
            endErrorRun(Number.isFinite(ts) ? ts : null);
          }
        }
      }
      const text = promptText(content);
      if (text === null) continue;
      // A real human prompt breaks any failure loop (the human stepped in).
      endErrorRun(Number.isFinite(ts) ? ts : null);
      prompts++;
      if (text.includes("[Request interrupted")) interrupts++;
      if (/\b(thanks|thank you|thank u|thx|ty)\b/i.test(text)) thankYous++;
      const trimmed = text.trim();
      if (trimmed.length > 0 && trimmed.length <= 80 && shortPrompts.length < 50) shortPrompts.push(trimmed);
      const words = trimmed.split(/\s+/).filter(Boolean).length;
      wordTotal += words;
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
        if (typeof fp === "string" && fp) {
          editedFiles.add(fp);
          const base = fp.slice(fp.lastIndexOf("/") + 1);
          const dot = base.lastIndexOf(".");
          if (dot > 0 && base.length - dot - 1 <= 8) {
            const ext = base.slice(dot + 1).toLowerCase();
            extensions[ext] = (extensions[ext] ?? 0) + 1;
          }
        }
      }
      if (SKILL_TOOLS.has(name)) {
        skillSpawns++;
        const inp = block["input"] as Record<string, unknown> | undefined;
        const id = inp?.["skill"] ?? inp?.["name"] ?? inp?.["command"];
        if (typeof id === "string" && id.trim()) {
          const key = id.trim().slice(0, 64); // NAME only — never args
          skillsUsed[key] = (skillsUsed[key] ?? 0) + 1;
        }
      }
    }
    maxParallel = Math.max(maxParallel, parallel);
  }

  endErrorRun(null); // session ended mid-loop → loop still counts, no breakout
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
    thankYous, wordTotal, recoveryLoops, extensions, recoveryBreakoutMs, shortPrompts,
    tool: "claude", skillSpawns, skillsUsed,
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
// v4: thankYous/wordTotal/recovery/extensions/shortPrompts signals added.
// v5: tool tag + skillSpawns/skillsUsed added (old entries lack them → re-parse).
const CACHE_VERSION = 5;

/**
 * Structural check on a cached SessionStats. The version bump handles known
 * shape changes; this guards against the next UNbumped one — a malformed
 * cached entry is treated as a cache miss and re-parsed, never trusted.
 */
export function isValidSessionStats(x: unknown): x is SessionStats {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  const numeric = [
    "prompts", "interrupts", "subagentSpawns", "maxParallel", "editCalls", "assistantTurns",
    "startHour", "durationMinutes", "thankYous", "wordTotal", "recoveryLoops", "skillSpawns",
  ];
  for (const k of numeric) if (typeof o[k] !== "number") return false;
  const booleans = ["usedPlanMode", "exploreBeforeFirstEdit", "hadEdits"];
  for (const k of booleans) if (typeof o[k] !== "boolean") return false;
  const wb = o["wordBuckets"] as Record<string, unknown> | undefined;
  if (!wb || typeof wb !== "object") return false;
  for (const k of ["1-5", "6-10", "11-25", "26+"]) if (typeof wb[k] !== "number") return false;
  if (!Array.isArray(o["eventGapsMs"])) return false;
  if (!Array.isArray(o["editedFiles"])) return false;
  if (!Array.isArray(o["recoveryBreakoutMs"])) return false;
  if (!Array.isArray(o["shortPrompts"])) return false;
  if (!o["extensions"] || typeof o["extensions"] !== "object") return false;
  // Nullable fields must be PRESENT (null is fine; absent means stale shape).
  for (const k of ["startMs", "endMs", "cwd", "gitBranch", "model"]) if (!(k in o)) return false;
  if (typeof o["tool"] !== "string") return false;
  if (!o["skillsUsed"] || typeof o["skillsUsed"] !== "object") return false;
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

async function loadCache(path: string = CACHE_PATH): Promise<CacheFile> {
  try {
    const cache = JSON.parse(await readFile(path, "utf8")) as CacheFile;
    // Stale schema → drop parsed entries (keep lastSentAt throttle), re-parse.
    if (cache.version !== CACHE_VERSION) {
      return { version: CACHE_VERSION, files: {}, lastSentAt: cache.lastSentAt };
    }
    return cache;
  } catch {
    return { version: CACHE_VERSION, files: {} };
  }
}

async function saveCache(cache: CacheFile, path: string = CACHE_PATH): Promise<void> {
  cache.version = CACHE_VERSION;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(cache), { encoding: "utf8", mode: 0o600 });
}

async function parseFile(path: string): Promise<SessionStats | null> {
  const rl = createInterface({ input: createReadStream(path, "utf8"), crlfDelay: Infinity });
  return parseSessionLines(rl);
}

/**
 * Generic per-file parse cache: stat each candidate file, skip out-of-window
 * ones, reuse a valid cached parse on size+mtime match, else parse and cache.
 * Prunes cache entries for files not seen THIS walk, then saves to `cachePath`.
 * Each source passes its OWN cachePath so sources never prune each other.
 */
export async function walkJsonlSessions(
  files: string[],
  cachePath: string,
  parse: (path: string) => Promise<SessionStats | null>,
): Promise<SessionStats[]> {
  const cutoff = Date.now() - WINDOW_DAYS * 86_400_000;
  const cache = await loadCache(cachePath);
  const seen = new Set<string>();
  const sessions: SessionStats[] = [];
  for (const full of files) {
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
        stats = await parse(full);
      } catch {
        // File vanished between stat and read → store null; pruned next run.
        stats = null;
      }
      cache.files[full] = { size: st.size, mtimeMs: st.mtimeMs, stats };
    }
    if (stats) sessions.push(stats);
  }
  for (const key of Object.keys(cache.files)) if (!seen.has(key)) delete cache.files[key];
  await saveCache(cache, cachePath);
  return sessions;
}

/**
 * Discover Claude Code session files (~/.claude/projects/<proj>/*.jsonl) and
 * parse them through the shared cache. Returns [] if PROJECTS_DIR is absent.
 */
async function walkSessions(): Promise<SessionStats[]> {
  if (!existsSync(PROJECTS_DIR)) return [];
  const files: string[] = [];
  const projectDirs = await readdir(PROJECTS_DIR, { withFileTypes: true });
  for (const dirent of projectDirs) {
    if (!dirent.isDirectory()) continue;
    const dir = join(PROJECTS_DIR, dirent.name);
    let names: string[];
    try {
      names = (await readdir(dir)).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const f of names) files.push(join(dir, f));
  }
  return walkJsonlSessions(files, CACHE_PATH, parseFile);
}

/**
 * A deep-extraction source: one originating agent and a collector returning its
 * in-window SessionStats. collectDeepInsights iterates every registered source
 * and stamps each session with the source's `tool`. Later plans push one entry
 * per agent (Codex, Gemini, …); this seam keeps that purely additive.
 */
export interface DeepSource {
  readonly tool: string;
  collect(): Promise<SessionStats[]>;
}

export const DEEP_SOURCES: DeepSource[] = [{ tool: "claude", collect: walkSessions }];

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
  // New deep signals (older servers ignore unknown fields; server zod marks
  // them optional for older CLIs).
  thankYous: number;
  wordTotal: number;
  recovery: { loops: number; medianBreakoutMs: number };
  extensions: Record<string, number>; // capped to the top 10 by count
  // tool-aware + skill signals (older servers ignore unknown fields).
  tool: string; // originating agent: "claude" | "codex" | ...
  skillSpawns: number;
  skillsUsed: Record<string, number>; // capped to the top 10 by count
}

export interface InsightsDeepPayload {
  windowDays: number;
  sessions: SessionRecord[];
  // Max simultaneously-open sessions in the window (interval overlap).
  maxConcurrentSessions: number;
  // The go-to prompt — the ONLY text field, present only under consent v2
  // (textExtracts), redacted client-side, ≥3 repeats to qualify, ≤80 chars.
  topPrompt?: { text: string; count: number; sessions: number } | null;
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

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? 0;
}

/** Top-N entries of a histogram (bounds upload size on wild sessions). */
function topEntries(h: Record<string, number>, n: number): Record<string, number> {
  return Object.fromEntries(
    Object.entries(h)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n),
  );
}

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
    thankYous: s.thankYous ?? 0,
    wordTotal: s.wordTotal ?? 0,
    recovery: { loops: s.recoveryLoops ?? 0, medianBreakoutMs: median(s.recoveryBreakoutMs ?? []) },
    extensions: topEntries(s.extensions ?? {}, 10),
    tool: s.tool ?? "claude",
    skillSpawns: s.skillSpawns ?? 0,
    skillsUsed: topEntries(s.skillsUsed ?? {}, 10),
  };
}

/** Max number of sessions open at the same moment (interval-overlap sweep). */
export function maxConcurrent(sessions: Array<{ startMs: number | null; endMs: number | null }>): number {
  const events: Array<[number, number]> = [];
  for (const s of sessions) {
    if (s.startMs === null || s.endMs === null || s.endMs < s.startMs) continue;
    events.push([s.startMs, 1], [s.endMs, -1]);
  }
  // Ends sort before starts at the same instant — touching sessions don't overlap.
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0;
  let max = 0;
  for (const [, delta] of events) {
    cur += delta;
    if (cur > max) max = cur;
  }
  return max;
}

/**
 * The go-to prompt: most-repeated short prompt across the window. ≥3 repeats
 * to qualify (one-offs never upload), redacted, ≤80 chars. Returns null when
 * nothing qualifies.
 */
export function topPromptOf(
  sessions: Array<{ shortPrompts?: string[] }>,
): { text: string; count: number; sessions: number } | null {
  const counts = new Map<string, { count: number; sessions: number; display: Map<string, number> }>();
  for (let i = 0; i < sessions.length; i++) {
    const seenThisSession = new Set<string>();
    for (const p of sessions[i]?.shortPrompts ?? []) {
      const key = p.toLowerCase();
      const entry = counts.get(key) ?? { count: 0, sessions: 0, display: new Map<string, number>() };
      entry.count++;
      entry.display.set(p, (entry.display.get(p) ?? 0) + 1);
      if (!seenThisSession.has(key)) {
        entry.sessions++;
        seenThisSession.add(key);
      }
      counts.set(key, entry);
    }
  }
  let best: { text: string; count: number; sessions: number } | null = null;
  for (const entry of counts.values()) {
    if (entry.count < 3) continue;
    if (best && entry.count <= best.count) continue;
    const display = [...entry.display.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    best = { text: redact(display).slice(0, 80), count: entry.count, sessions: entry.sessions };
  }
  return best;
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
export interface DeepCollectOptions {
  /** Consent v2: allow the redacted go-to-prompt text in the payload. */
  textExtracts?: boolean;
}

export async function collectDeepInsights(salt: string, opts: DeepCollectOptions = {}): Promise<DeepCollectResult> {
  try {
    const settled = await Promise.allSettled(
      DEEP_SOURCES.map((src) =>
        src.collect().then((ss) => {
          for (const s of ss) s.tool = src.tool; // source tag is authoritative
          return ss;
        }),
      ),
    );
    // Isolate per-source failures: a bad source yields [] but doesn't prevent
    // other sources' results from being used (the multi-agent resilience seam).
    const sessions = settled
      .filter((r): r is PromiseFulfilledResult<SessionStats[]> => r.status === "fulfilled")
      .flatMap((r) => r.value);
    if (sessions.length === 0) {
      // Distinguish "nothing to upload" from "something went wrong".
      const failed = settled.find((r): r is PromiseRejectedResult => r.status === "rejected");
      if (failed) {
        const msg = failed.reason instanceof Error ? failed.reason.message : String(failed.reason);
        return { status: "error", message: msg };
      }
      return { status: "empty" };
    }

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

    const payload: InsightsDeepPayload = {
      windowDays: WINDOW_DAYS,
      sessions: records,
      maxConcurrentSessions: maxConcurrent(sessions),
    };
    if (opts.textExtracts) payload.topPrompt = topPromptOf(sessions);
    return { status: "ok", payload };
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
