// "Builds with" stack profile: verified from real agent edits.
import type { SessionRecord, GithubStats } from "../db/schema.js";

// Map file extensions (no dot) to display language names.
// Unknown extensions are omitted — never guess.
const EXT_LANGUAGE: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  mjs: "JavaScript",
  cjs: "JavaScript",
  py: "Python",
  rs: "Rust",
  go: "Go",
  rb: "Ruby",
  java: "Java",
  kt: "Kotlin",
  swift: "Swift",
  c: "C",
  h: "C",
  cc: "C++",
  cpp: "C++",
  hpp: "C++",
  cs: "C#",
  php: "PHP",
  sh: "Shell",
  bash: "Shell",
  zsh: "Shell",
  sql: "SQL",
  html: "HTML",
  css: "CSS",
  scss: "CSS",
  md: "Markdown",
  mdx: "Markdown",
  json: "Config",
  yaml: "Config",
  yml: "Config",
  toml: "Config",
  vue: "Vue",
  svelte: "Svelte",
  ex: "Elixir",
  exs: "Elixir",
  zig: "Zig",
};

// Mapped but not signal-bearing: README tweaks and CI configs would otherwise
// outrank real languages on share — excluded from the language fold entirely.
const META_LANGS = new Set(["Config", "Markdown"]);

export interface StackProfile {
  languages: Array<{ name: string; share: number }>;
  models: Array<{ family: string; share: number }>;
  ghLanguages: string[];
}

export function buildStack(
  sessions: SessionRecord[] | null,
  modelMix: Array<{ family: string; share: number }> | null,
  github: GithubStats | null,
): StackProfile | null {
  // Fold extensions across all sessions: ext → total count.
  const extCounts = new Map<string, number>();
  for (const s of sessions ?? []) {
    for (const [ext, n] of Object.entries(s.extensions ?? {})) {
      extCounts.set(ext, (extCounts.get(ext) ?? 0) + n);
    }
  }

  // Map extensions to language names, summing counts per language.
  const langCounts = new Map<string, number>();
  for (const [ext, n] of extCounts) {
    const lang = EXT_LANGUAGE[ext];
    if (!lang || META_LANGS.has(lang)) continue; // unknown or meta — omit
    langCounts.set(lang, (langCounts.get(lang) ?? 0) + n);
  }

  const totalMapped = [...langCounts.values()].reduce((s, n) => s + n, 0);
  const languages =
    totalMapped > 0
      ? [...langCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 6)
          .map(([name, n]) => ({ name, share: Math.round((n / totalMapped) * 100) }))
      : [];

  const models = (modelMix ?? []).slice(0, 3);

  const ghLanguages = (github?.topLanguages ?? []).slice(0, 3).map((l) => l.name);

  if (languages.length === 0 && models.length === 0 && ghLanguages.length === 0) {
    return null;
  }

  return { languages, models, ghLanguages };
}
