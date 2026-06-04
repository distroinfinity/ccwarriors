import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { postTelemetry } from "./core.js";

const execFileAsync = promisify(execFile);

// Pinned major: we own the collection path. ccusage ships breaking output
// changes in majors; bumping this requires a CLI release (self-update ships it).
const CCUSAGE_PKG = "ccusage@20";

// How many days of raw history we ship. The server prices days and ignores
// anything outside its own 40-day window; 40 here keeps the two aligned.
const WINDOW_DAYS = 40;
const CMD_TIMEOUT_MS = 60_000;

export interface ModelTokens {
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export interface RawDay {
  date: string; // YYYY-MM-DD
  models: ModelTokens[];
}

export interface UsageCollection {
  // tool → raw days (token counts only — the server prices everything).
  tools: Record<string, RawDay[]>;
  // Client-side display estimates (ccusage's own numbers). NEVER sent as truth.
  estimates: Record<string, number>;
  ccusageVersion: string;
  failedTools: string[];
}

function yyyymmdd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

const IS_WIN = process.platform === "win32";

async function runCcusage(args: string[]): Promise<unknown> {
  // Windows: npx is npx.cmd and needs a shell to spawn.
  const { stdout } = await execFileAsync(
    IS_WIN ? "npx.cmd" : "npx",
    ["--yes", CCUSAGE_PKG, ...args],
    { timeout: CMD_TIMEOUT_MS, shell: IS_WIN, maxBuffer: 32 * 1024 * 1024 },
  );
  return JSON.parse(stdout) as unknown;
}

const num = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0;

// Normalize one ccusage daily entry. Two shapes exist across agents:
//   claude-style: { date, modelBreakdowns: [{modelName, inputTokens, outputTokens,
//                   cacheCreationTokens, cacheReadTokens}], totalCost }
//   codex-style:  { date, models: { name: {inputTokens, outputTokens,
//                   cachedInputTokens, ...} }, costUSD }
export function normalizeDay(entry: Record<string, unknown>): RawDay | null {
  const date = typeof entry["date"] === "string" ? entry["date"] : null;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const models: ModelTokens[] = [];
  const breakdowns = entry["modelBreakdowns"];
  if (Array.isArray(breakdowns)) {
    for (const raw of breakdowns) {
      const b = raw as Record<string, unknown>;
      if (typeof b["modelName"] !== "string") continue;
      models.push({
        modelName: b["modelName"],
        inputTokens: num(b["inputTokens"]),
        outputTokens: num(b["outputTokens"]),
        cacheCreationTokens: num(b["cacheCreationTokens"]),
        cacheReadTokens: num(b["cacheReadTokens"]),
      });
    }
  } else if (entry["models"] && typeof entry["models"] === "object") {
    for (const [name, raw] of Object.entries(entry["models"] as Record<string, unknown>)) {
      const m = raw as Record<string, unknown>;
      models.push({
        modelName: name,
        inputTokens: num(m["inputTokens"]),
        // outputTokens already includes reasoning tokens (verified: totalTokens
        // = cached + input + output in codex output).
        outputTokens: num(m["outputTokens"]),
        cacheCreationTokens: num(m["cacheCreationTokens"]),
        cacheReadTokens: num(m["cacheReadTokens"] ?? m["cachedInputTokens"]),
      });
    }
  }

  if (models.length === 0) return null;
  return { date, models };
}

function dayEstimate(entry: Record<string, unknown>): number {
  const v = entry["totalCost"] ?? entry["costUSD"];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

interface AgentResult {
  days: RawDay[];
  estimate: number;
}

async function collectAgent(agent: string, since: string): Promise<AgentResult> {
  const parsed = (await runCcusage([agent, "daily", "--json", "--since", since])) as {
    daily?: unknown[];
  };
  const days: RawDay[] = [];
  let estimate = 0;
  for (const raw of parsed.daily ?? []) {
    const entry = raw as Record<string, unknown>;
    const day = normalizeDay(entry);
    if (day) {
      days.push(day);
      estimate += dayEstimate(entry);
    }
  }
  return { days, estimate: Math.round(estimate * 100) / 100 };
}

/** Agents present on this machine, via the aggregate report's metadata. */
async function detectAgents(since: string): Promise<string[]> {
  const parsed = (await runCcusage(["daily", "--json", "--since", since])) as {
    daily?: unknown[];
  };
  const agents = new Set<string>();
  for (const raw of parsed.daily ?? []) {
    const entry = raw as Record<string, unknown>;
    const meta = entry["metadata"] as Record<string, unknown> | undefined;
    const list = meta?.["agents"];
    if (Array.isArray(list)) for (const a of list) if (typeof a === "string") agents.add(a);
  }
  // Older ccusage without per-entry agent metadata: everything is claude.
  if (agents.size === 0 && (parsed.daily?.length ?? 0) > 0) agents.add("claude");
  return [...agents];
}

/**
 * Collect raw usage for every agent ccusage detects on this machine.
 * One failing agent never blocks the others — claude data still ships when
 * codex collection breaks, and vice versa.
 */
export async function readUsage(): Promise<UsageCollection> {
  const since = yyyymmdd(new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000));

  let agents: string[];
  try {
    agents = await detectAgents(since);
  } catch (err) {
    console.error(
      "Couldn't read ccusage — make sure you've used a supported coding agent. Try: npx ccusage@latest",
    );
    throw err;
  }

  const results = await Promise.allSettled(agents.map((a) => collectAgent(a, since)));

  const tools: Record<string, RawDay[]> = {};
  const estimates: Record<string, number> = {};
  const failedTools: string[] = [];
  results.forEach((res, i) => {
    const agent = agents[i]!;
    if (res.status === "fulfilled") {
      if (res.value.days.length > 0) {
        tools[agent] = res.value.days;
        estimates[agent] = res.value.estimate;
      }
    } else {
      failedTools.push(agent);
    }
  });

  if (failedTools.length > 0) {
    void postTelemetry("tool_collection_failed", {
      tools: failedTools.join(","),
      detected: agents.length,
    });
  }
  if (Object.keys(tools).length === 0 && failedTools.length > 0) {
    throw new Error(`usage collection failed for: ${failedTools.join(", ")}`);
  }

  // Best-effort version read (cached npx → fast).
  let ccusageVersion = "";
  try {
    const { stdout } = await execFileAsync(
      IS_WIN ? "npx.cmd" : "npx",
      ["--yes", CCUSAGE_PKG, "--version"],
      { timeout: 30_000, shell: IS_WIN },
    );
    ccusageVersion = stdout.trim();
  } catch {
    // optional — ignore
  }

  return { tools, estimates, ccusageVersion, failedTools };
}

/** Console-friendly one-liner of client-side estimates: "claude $123 · codex $45". */
export function formatEstimates(estimates: Record<string, number>): string {
  const parts = Object.entries(estimates)
    .sort((a, b) => b[1] - a[1])
    .map(([tool, v]) => `${tool} $${v.toFixed(0)}`);
  return parts.join(" · ") || "no usage found";
}
