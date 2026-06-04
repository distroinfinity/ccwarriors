// Canonical tool/agent registry — mirror of apps/server/src/lib/tools.ts.
// Keys match ccusage v20 per-agent subcommand names (`ccusage <key> daily`).
export const TOOL_KEYS = [
  "claude",
  "codex",
  "opencode",
  "amp",
  "droid",
  "codebuff",
  "hermes",
  "pi",
  "goose",
  "kilo",
  "copilot",
  "gemini",
  "kimi",
  "qwen",
  "openclaw",
] as const;

export type ToolKey = (typeof TOOL_KEYS)[number];

export const OTHER_TOOL = "other";

export function isKnownTool(key: string): boolean {
  return (TOOL_KEYS as readonly string[]).includes(key);
}
