// Transcript collection for the story page (consent v2: deep = all-in).
// PRIVACY CONTRACT: only REDACTED user-prompt text, tool-call NAMES (never
// inputs — no file paths, no commands), the model id, and timing counts leave
// the machine. cwd / gitBranch / tool inputs are read but never included.
// Project directory names (projectKey) are used for LOCAL selection scoring
// only and NEVER leave the machine — they are stripped before returning.
// Size-capped hard: the story needs a sample, not an archive.
import { createReadStream, existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { join } from "node:path";
import { redact } from "./redact.js";

export const STORY_CHAR_BUDGET = 500_000;   // total serialized chars of uploaded sessions
export const MAX_STORY_SESSIONS = 250;      // hard count ceiling (server will allow 300)
export const MAX_PROMPT_CHARS = 2000;
export const MAX_PROMPTS_PER_SESSION = 60;
const WINDOW_DAYS = 40;
// A session left open across days otherwise blows past the server's max
// (10080 min) and the whole upload 400s. Same cap as insights.ts.
const MAX_SESSION_MINUTES = 7 * 24 * 60;
const RECENT_BUDGET_SHARE = 0.85;           // 85% recency-greedy / 15% stratified older sample
const MIN_SESSION_PROMPTS = 2;              // triviality filter
const MIN_SESSION_MINUTES = 2;
const STALE_PROJECT_DAYS = 14;             // project "dead" if no in-window activity in 14d…
const STALE_PROJECT_MAX_SESSIONS = 2;      // …and ≤2 sessions total in window
const STRATA_COUNT = 4;                    // 4 × 10-day slices of the 40-day window
const MAX_FILE_BYTES = 50 * 1024 * 1024;  // skip pathological files

export interface TranscriptSession {
  startedDay: string | null; // YYYY-MM-DD (day granularity only)
  durationMinutes: number;
  model: string | null;
  interrupts: number;
  prompts: string[]; // redacted user prompts, in order
  toolCounts: Record<string, number>; // tool NAME → call count (never inputs)
}

export interface TranscriptsPayload {
  windowDays: number;
  sessions: TranscriptSession[];
}

const PROJECTS_DIR = process.env["CCWARRIORS_CLAUDE_DIR"] ?? join(homedir(), ".claude", "projects");

interface ParsedTranscript extends TranscriptSession {
  endMs: number;
  projectKey: string;  // parent directory name — LOCAL ONLY, never uploaded
  jsonChars: number;   // serialized size estimate for budget accounting
}

async function parseFile(path: string): Promise<Omit<ParsedTranscript, "projectKey" | "jsonChars"> | null> {
  const rl = createInterface({ input: createReadStream(path, "utf8"), crlfDelay: Infinity });
  let firstTs: number | null = null;
  let lastTs: number | null = null;
  let interrupts = 0;
  let model: string | null = null;
  const modelCounts = new Map<string, number>();
  const prompts: string[] = [];
  const toolCounts: Record<string, number> = {};

  for await (const line of rl) {
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
      lastTs = ts;
    }
    const message = o["message"] as Record<string, unknown> | undefined;
    if (type === "user") {
      if (o["isMeta"] === true) continue;
      const content = message?.["content"];
      let text: string | null = null;
      if (typeof content === "string") text = content;
      else if (Array.isArray(content)) {
        const blocks = content.filter((b): b is Record<string, unknown> => !!b && typeof b === "object");
        if (blocks.some((b) => b["type"] === "tool_result")) text = null;
        else {
          const texts = blocks.filter((b) => b["type"] === "text" && typeof b["text"] === "string").map((b) => b["text"] as string);
          text = texts.length > 0 ? texts.join(" ") : null;
        }
      }
      if (text === null) continue;
      if (text.includes("[Request interrupted")) interrupts++;
      if (prompts.length < MAX_PROMPTS_PER_SESSION) {
        prompts.push(redact(text.trim()).slice(0, MAX_PROMPT_CHARS));
      }
      continue;
    }
    // assistant: model + tool NAMES only — inputs are deliberately ignored.
    const m = message?.["model"];
    if (typeof m === "string" && m) modelCounts.set(m, (modelCounts.get(m) ?? 0) + 1);
    const content = message?.["content"];
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (!b || typeof b !== "object" || (b as Record<string, unknown>)["type"] !== "tool_use") continue;
      const name = String((b as Record<string, unknown>)["name"] ?? "");
      if (name) toolCounts[name] = (toolCounts[name] ?? 0) + 1;
    }
  }

  if (prompts.length === 0) return null;
  let best = 0;
  for (const [name, count] of modelCounts) {
    if (count > best) {
      best = count;
      model = name;
    }
  }
  return {
    startedDay: firstTs !== null ? new Date(firstTs).toISOString().slice(0, 10) : null,
    durationMinutes:
      firstTs !== null && lastTs !== null
        ? Math.min(MAX_SESSION_MINUTES, Math.round(Math.max(0, (lastTs - firstTs) / 60_000)))
        : 0,
    model,
    interrupts,
    prompts,
    toolCounts,
    endMs: lastTs ?? 0,
  };
}

/** Budget-packed, relevance-weighted in-window sessions. Null when nothing qualifies. Never throws. */
export async function collectTranscripts(): Promise<TranscriptsPayload | null> {
  try {
    if (!existsSync(PROJECTS_DIR)) return null;
    const now = Date.now();
    const cutoff = now - WINDOW_DAYS * 86_400_000;

    // CENSUS: enumerate all in-window files, capturing projectKey from directory name.
    const files: Array<{ path: string; mtimeMs: number; projectKey: string }> = [];
    for (const dirent of await readdir(PROJECTS_DIR, { withFileTypes: true })) {
      if (!dirent.isDirectory()) continue;
      const projectKey = dirent.name;
      const dir = join(PROJECTS_DIR, projectKey);
      let names: string[];
      try {
        names = (await readdir(dir)).filter((f) => f.endsWith(".jsonl"));
      } catch {
        continue;
      }
      for (const f of names) {
        const full = join(dir, f);
        try {
          const st = await stat(full);
          if (st.size > MAX_FILE_BYTES) continue;  // skip pathological files
          if (st.mtimeMs >= cutoff) files.push({ path: full, mtimeMs: st.mtimeMs, projectKey });
        } catch {
          continue;
        }
      }
    }
    if (files.length === 0) return null;

    // Parse ALL in-window files (census needed for project scoring and stratified sampling).
    const allSessions: ParsedTranscript[] = [];
    for (const f of files) {
      try {
        const parsed = await parseFile(f.path);
        if (!parsed) continue;
        // Compute wire shape without local fields to measure serialized size.
        const wireShape: TranscriptSession = {
          startedDay: parsed.startedDay,
          durationMinutes: parsed.durationMinutes,
          model: parsed.model,
          interrupts: parsed.interrupts,
          prompts: parsed.prompts,
          toolCounts: parsed.toolCounts,
        };
        const jsonChars = JSON.stringify(wireShape).length + 1; // +1 for array comma
        allSessions.push({ ...parsed, projectKey: f.projectKey, jsonChars });
      } catch {
        continue;
      }
    }
    if (allSessions.length === 0) return null;

    // TRIVIALITY FILTER: require min prompts and min duration.
    const eligible = allSessions.filter(
      (s) => s.prompts.length >= MIN_SESSION_PROMPTS && s.durationMinutes >= MIN_SESSION_MINUTES,
    );
    // Sparse users keep everything — don't penalise light usage.
    const pool = eligible.length >= 5 ? eligible : allSessions;

    // PROJECT STATS (local only — never uploaded).
    const projectStats = new Map<string, { count: number; lastEndMs: number }>();
    for (const s of pool) {
      const prev = projectStats.get(s.projectKey);
      if (!prev) {
        projectStats.set(s.projectKey, { count: 1, lastEndMs: s.endMs });
      } else {
        prev.count++;
        if (s.endMs > prev.lastEndMs) prev.lastEndMs = s.endMs;
      }
    }

    // STALE-PROJECT SPLIT.
    const staleCutoffMs = STALE_PROJECT_DAYS * 86_400_000;
    const activePool: ParsedTranscript[] = [];
    const stalePool: ParsedTranscript[] = [];
    for (const s of pool) {
      const stats = projectStats.get(s.projectKey)!;
      const isStale =
        now - stats.lastEndMs > staleCutoffMs && stats.count <= STALE_PROJECT_MAX_SESSIONS;
      (isStale ? stalePool : activePool).push(s);
    }

    // RECENCY-GREEDY PASS (85% of budget): sort activePool by endMs desc.
    activePool.sort((a, b) => b.endMs - a.endMs);
    const picked: ParsedTranscript[] = [];
    let used = 0;
    const recentBudget = RECENT_BUDGET_SHARE * STORY_CHAR_BUDGET;
    const pickedSet = new Set<ParsedTranscript>();

    for (const s of activePool) {
      if (picked.length >= MAX_STORY_SESSIONS) break;
      if (used + s.jsonChars > recentBudget) continue; // oversized: skip, don't stop
      picked.push(s);
      pickedSet.add(s);
      used += s.jsonChars;
    }

    // STRATIFIED OLDER SAMPLE (rest of full budget).
    // Leftovers = unpicked activePool ∪ stalePool.
    const leftovers = [...activePool.filter((s) => !pickedSet.has(s)), ...stalePool];

    // Divide the 40-day window into STRATA_COUNT equal slices.
    // Slice 0 = oldest (cutoff → cutoff + sliceMs), Slice N-1 = newest.
    const windowMs = WINDOW_DAYS * 86_400_000;
    const sliceMs = windowMs / STRATA_COUNT;
    const strata: ParsedTranscript[][] = Array.from({ length: STRATA_COUNT }, () => []);
    for (const s of leftovers) {
      const age = now - s.endMs;
      // Clamp to window (sessions slightly outside due to clock drift).
      const idx = Math.min(STRATA_COUNT - 1, Math.max(0, Math.floor((windowMs - age) / sliceMs)));
      strata[idx]!.push(s);
    }

    // Score each session: (prompts.length + editToolCalls) * log2(1 + projectCount).
    const EDIT_TOOLS = ["Edit", "Write", "MultiEdit", "NotebookEdit"];
    function score(s: ParsedTranscript): number {
      let editCalls = 0;
      for (const t of EDIT_TOOLS) editCalls += s.toolCounts[t] ?? 0;
      const stats = projectStats.get(s.projectKey)!;
      return (s.prompts.length + editCalls) * Math.log2(1 + stats.count);
    }

    // Sort each stratum by score desc so we can pop the best.
    for (const stratum of strata) {
      stratum.sort((a, b) => score(b) - score(a));
    }

    // Round-robin OLDEST-first; repeat rounds until no slice yields a fit.
    let anyFit = true;
    while (anyFit && picked.length < MAX_STORY_SESSIONS) {
      anyFit = false;
      for (let i = 0; i < STRATA_COUNT; i++) {
        const stratum = strata[i]!;
        // Pop the first session in this stratum that fits.
        let found = false;
        for (let j = 0; j < stratum.length; j++) {
          const s = stratum[j]!;
          if (used + s.jsonChars <= STORY_CHAR_BUDGET && picked.length < MAX_STORY_SESSIONS) {
            picked.push(s);
            used += s.jsonChars;
            stratum.splice(j, 1);
            found = true;
            anyFit = true;
            break;
          }
        }
        // If nothing fit in this stratum (all too large), that's fine — continue.
        if (!found && stratum.length > 0) {
          // Check if any remaining session could fit at all.
          const smallest = stratum.reduce((min, s) => (s.jsonChars < min.jsonChars ? s : min));
          if (used + smallest.jsonChars <= STORY_CHAR_BUDGET) anyFit = true;
        }
      }
    }

    if (picked.length === 0) return null;

    // Sort by recency desc, strip local-only fields, return wire shape.
    picked.sort((a, b) => b.endMs - a.endMs);
    return {
      windowDays: WINDOW_DAYS,
      sessions: picked.map(({ endMs: _e, projectKey: _pk, jsonChars: _jc, ...s }) => s),
    };
  } catch {
    return null;
  }
}
