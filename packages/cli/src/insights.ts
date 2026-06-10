// Local behavioral extraction from Claude Code session JSONL. Deterministic
// event counting — no LLM, no transcript text retained or uploaded. Per-file
// results are cached (path+size+mtime) so repeat syncs only parse new lines'
// worth of files. See spec §3.3.
import { createReadStream, existsSync } from "node:fs";
import { readFile, writeFile, readdir, stat, mkdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { join } from "node:path";

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
  let firstTs: number | null = null, lastTs: number | null = null;
  const wordBuckets = { "1-5": 0, "6-10": 0, "11-25": 0, "26+": 0 };

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
    }
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
    const content = message?.["content"];
    if (!Array.isArray(content)) continue;
    let parallel = 0;
    for (const b of content) {
      if (!b || typeof b !== "object" || (b as Record<string, unknown>)["type"] !== "tool_use") continue;
      const name = String((b as Record<string, unknown>)["name"] ?? "");
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
      }
    }
    maxParallel = Math.max(maxParallel, parallel);
  }

  if (prompts === 0 && assistantTurns === 0) return null;
  const startHour = firstTs !== null ? new Date(firstTs).getHours() : 12;
  const durationMinutes = firstTs !== null && lastTs !== null ? Math.max(0, (lastTs - firstTs) / 60_000) : 0;
  return {
    prompts, interrupts, usedPlanMode, exploreBeforeFirstEdit, hadEdits,
    subagentSpawns, maxParallel, editCalls, assistantTurns, startHour, durationMinutes, wordBuckets,
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

// ── Filesystem walk + cache ─────────────────────────────────────────────────

interface CacheFile {
  files: Record<string, { size: number; mtimeMs: number; stats: SessionStats | null }>;
  lastSentAt?: string;
}

const HOME = process.env["CCWARRIORS_HOME"] ?? join(homedir(), ".claude-warriors");
const CACHE_PATH = join(HOME, "insights-cache.json");
const PROJECTS_DIR = process.env["CCWARRIORS_CLAUDE_DIR"] ?? join(homedir(), ".claude", "projects");

async function loadCache(): Promise<CacheFile> {
  try {
    return JSON.parse(await readFile(CACHE_PATH, "utf8")) as CacheFile;
  } catch {
    return { files: {} };
  }
}

async function saveCache(cache: CacheFile): Promise<void> {
  await mkdir(HOME, { recursive: true, mode: 0o700 });
  await writeFile(CACHE_PATH, JSON.stringify(cache), { encoding: "utf8", mode: 0o600 });
}

async function parseFile(path: string): Promise<SessionStats | null> {
  const rl = createInterface({ input: createReadStream(path, "utf8"), crlfDelay: Infinity });
  return parseSessionLines(rl);
}

/** Collect insights for sessions modified within the window. Cache makes
    repeat runs parse only new/changed files. */
export async function collectInsights(): Promise<InsightsPayload | null> {
  if (!existsSync(PROJECTS_DIR)) return null;
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
      if (cached && cached.size === st.size && cached.mtimeMs === st.mtimeMs) {
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

  if (sessions.length === 0) return null;
  return aggregateSessions(sessions, WINDOW_DAYS);
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
