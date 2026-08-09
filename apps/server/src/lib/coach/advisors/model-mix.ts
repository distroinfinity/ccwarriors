import type { ModuleProvider } from "../types.js";
import { pct } from "../format.js";

const LABEL: Record<string, string> = { opus: "Opus", sonnet: "Sonnet", haiku: "Haiku", openai: "OpenAI", gemini: "Gemini", other: "Other" };

/**
 * Informational module only. No "move to Sonnet" advice — explicitly rejected for
 * the 90%-Opus population (efficiency.ts:33-38, spec §4.6, review #3). Just shows
 * the dominant model family share and the cache grade.
 */
export const modelMixModule: ModuleProvider = (ctx) => {
  const mix = ctx.efficiency?.modelMix;
  if (!mix || mix.length === 0) return null;
  const top = mix[0]!;
  const grade = ctx.efficiency?.grade;
  const value = `${pct(top.share)} ${LABEL[top.family] ?? top.family}${grade ? ` · ${grade} cache` : ""}`;
  return {
    id: "model-mix", tier: 1, visibility: "public", label: "Model mix",
    value, benchmark: null, tip: null, informationalOnly: true, locked: false,
  };
};

export default modelMixModule;
