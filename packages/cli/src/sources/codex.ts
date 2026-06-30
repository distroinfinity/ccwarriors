import { blankSessionStats, type SessionStats } from "../session-stats.js";

/**
 * Parse one Codex rollout JSONL (~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl)
 * into a SessionStats, or null if it holds no recognizable turns.
 *
 * Tolerant per spec §3.5.3: unrecognized records are skipped, every field is
 * optional, and editedFiles is unavailable (Codex edits via exec_command shell
 * args) so attribution degrades to the session time-window. The parser never
 * reads prompt, output, or command text — only record types and timestamps.
 *
 * Records (every line carries a top-level ISO `timestamp`):
 *   {type:"session_meta",  payload:{cwd}}
 *   {type:"turn_context",  payload:{cwd, model}}
 *   {type:"event_msg",     payload:{type:"user_message"}}              → human prompt
 *   {type:"response_item", payload:{type:"message", role:"assistant"}} → assistant turn
 */
export async function parseCodexLines(
  lines: Iterable<string> | AsyncIterable<string>,
): Promise<SessionStats | null> {
  let prompts = 0;
  let assistantTurns = 0;
  let cwd: string | null = null;
  let firstTs: number | null = null;
  let lastTs: number | null = null;
  let prevTurnTs: number | null = null;
  const modelCounts = new Map<string, number>();
  const eventGapsMs: number[] = [];

  for await (const raw of lines) {
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      continue;
    }
    const type = o["type"];
    const payload = (o["payload"] ?? {}) as Record<string, unknown>;
    const ts = typeof o["timestamp"] === "string" ? new Date(o["timestamp"] as string).getTime() : NaN;
    if (Number.isFinite(ts)) {
      if (firstTs === null) firstTs = ts;
      lastTs = ts; // last record's ts (mild out-of-order only skews duration)
    }

    if (type === "session_meta" || type === "turn_context") {
      const c = payload["cwd"];
      if (cwd === null && typeof c === "string" && c) cwd = c;
    }
    if (type === "turn_context") {
      const m = payload["model"];
      if (typeof m === "string" && m) modelCounts.set(m, (modelCounts.get(m) ?? 0) + 1);
    }

    const pt = payload["type"];
    let isTurn = false;
    if (type === "event_msg" && pt === "user_message") {
      prompts++;
      isTurn = true;
    } else if (type === "response_item" && pt === "message" && payload["role"] === "assistant") {
      assistantTurns++;
      isTurn = true;
    }
    if (isTurn && Number.isFinite(ts)) {
      if (prevTurnTs !== null) eventGapsMs.push(Math.max(0, ts - prevTurnTs));
      prevTurnTs = ts;
    }
  }

  if (prompts === 0 && assistantTurns === 0) return null;

  let model: string | null = null;
  let best = 0;
  for (const [name, n] of modelCounts) {
    if (n > best) {
      best = n;
      model = name;
    }
  }

  const s = blankSessionStats("codex");
  s.prompts = prompts;
  s.assistantTurns = assistantTurns;
  s.cwd = cwd;
  s.model = model;
  s.startMs = firstTs;
  s.endMs = lastTs;
  s.startHour = firstTs !== null ? new Date(firstTs).getHours() : 12;
  s.durationMinutes = firstTs !== null && lastTs !== null ? Math.max(0, (lastTs - firstTs) / 60_000) : 0;
  s.eventGapsMs = eventGapsMs;
  return s;
}
