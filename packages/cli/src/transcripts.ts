// Transcript collection for the story page (consent v2: deep = all-in).
// PRIVACY CONTRACT: only REDACTED user-prompt text, tool-call NAMES (never
// inputs — no file paths, no commands), the model id, and timing counts leave
// the machine. cwd / gitBranch / tool inputs are read but never included.
// Size-capped hard: the story needs a sample, not an archive.
import { createReadStream, existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { join } from "node:path";
import { redact } from "./redact.js";

export const MAX_STORY_SESSIONS = 30;
export const MAX_PROMPT_CHARS = 2000;
export const MAX_PROMPTS_PER_SESSION = 60;
const WINDOW_DAYS = 40;
// A session left open across days otherwise blows past the server's max
// (10080 min) and the whole upload 400s. Same cap as insights.ts.
const MAX_SESSION_MINUTES = 7 * 24 * 60;

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
}

async function parseFile(path: string): Promise<ParsedTranscript | null> {
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

/** Most recent in-window sessions, capped. Null when nothing qualifies. Never throws. */
export async function collectTranscripts(): Promise<TranscriptsPayload | null> {
  try {
    if (!existsSync(PROJECTS_DIR)) return null;
    const cutoff = Date.now() - WINDOW_DAYS * 86_400_000;

    const files: Array<{ path: string; mtimeMs: number }> = [];
    for (const dirent of await readdir(PROJECTS_DIR, { withFileTypes: true })) {
      if (!dirent.isDirectory()) continue;
      const dir = join(PROJECTS_DIR, dirent.name);
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
          if (st.mtimeMs >= cutoff) files.push({ path: full, mtimeMs: st.mtimeMs });
        } catch {
          continue;
        }
      }
    }
    if (files.length === 0) return null;

    // Most recent first; parse only as many as the cap needs (plus headroom
    // for files that parse to null).
    files.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const sessions: ParsedTranscript[] = [];
    for (const f of files) {
      if (sessions.length >= MAX_STORY_SESSIONS) break;
      try {
        const parsed = await parseFile(f.path);
        if (parsed) sessions.push(parsed);
      } catch {
        continue;
      }
    }
    if (sessions.length === 0) return null;
    sessions.sort((a, b) => b.endMs - a.endMs);
    return {
      windowDays: WINDOW_DAYS,
      sessions: sessions.map(({ endMs: _e, ...s }) => s),
    };
  } catch {
    return null;
  }
}
