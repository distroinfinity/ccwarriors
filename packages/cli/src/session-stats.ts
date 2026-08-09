// Shared per-session stats shape, extracted so per-agent parsers (sources/*)
// can build it without importing insights.ts (which would create a cycle).
// LOCAL-ONLY fields (cwd, gitBranch, editedFiles, raw gaps) are dropped before
// upload by toSessionRecord in insights.ts — see the PRIVACY CONTRACT there.
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
  // ── new deep signals (counts — safe to upload) ──
  thankYous: number;
  wordTotal: number;
  recoveryLoops: number;
  extensions: Record<string, number>;
  // ── tool-aware + skill signals (counts/names — safe to upload) ──
  tool: string; // originating agent
  skillSpawns: number;
  skillsUsed: Record<string, number>;
  // ── richer per-session signal (some LOCAL-ONLY; see PRIVACY CONTRACT) ──
  recoveryBreakoutMs: number[];
  shortPrompts: string[];
  startMs: number | null;
  endMs: number | null;
  cwd: string | null; // LOCAL-ONLY
  gitBranch: string | null; // LOCAL-ONLY
  model: string | null;
  editedFiles: string[]; // LOCAL-ONLY
  eventGapsMs: number[]; // LOCAL-ONLY
}

/**
 * A zeroed SessionStats with neutral defaults, stamped with `tool`. Per-agent
 * parsers (Codex, Aider, …) call this and fill only the load-bearing fields
 * they can actually observe (cwd, model, window, turns); Claude-specific
 * behavioral fields stay neutral. Keeps every parser's output shape identical
 * so isValidSessionStats and toSessionRecord treat all tools uniformly.
 */
export function blankSessionStats(tool: string): SessionStats {
  return {
    prompts: 0, interrupts: 0, usedPlanMode: false, exploreBeforeFirstEdit: false, hadEdits: false,
    subagentSpawns: 0, maxParallel: 0, editCalls: 0, assistantTurns: 0, startHour: 12, durationMinutes: 0,
    wordBuckets: { "1-5": 0, "6-10": 0, "11-25": 0, "26+": 0 },
    thankYous: 0, wordTotal: 0, recoveryLoops: 0, extensions: {},
    tool, skillSpawns: 0, skillsUsed: {},
    recoveryBreakoutMs: [], shortPrompts: [],
    startMs: null, endMs: null, cwd: null, gitBranch: null, model: null, editedFiles: [], eventGapsMs: [],
  };
}
