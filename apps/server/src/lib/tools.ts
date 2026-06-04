// Canonical tool/agent registry — single source of truth for tool keys.
// Keys match ccusage v20 per-agent subcommand names (`ccusage <key> daily`).
// Mirrored in packages/cli/src/tools.ts — keep both in sync.
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

// Sources we don't recognize map here rather than being dropped — keeps total integrity.
export const OTHER_TOOL = "other";

export const TOOL_LABELS: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
  amp: "Amp",
  droid: "Droid",
  codebuff: "Codebuff",
  hermes: "Hermes",
  pi: "pi",
  goose: "Goose",
  kilo: "Kilo",
  copilot: "Copilot",
  gemini: "Gemini",
  kimi: "Kimi",
  qwen: "Qwen",
  openclaw: "OpenClaw",
  [OTHER_TOOL]: "Other",
};

export function isKnownTool(key: string): boolean {
  return (TOOL_KEYS as readonly string[]).includes(key) || key === OTHER_TOOL;
}

export function toolLabel(key: string): string {
  return TOOL_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}
