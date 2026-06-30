import type { Advisor, CoachContext, Module, ModuleProvider, Recommendation } from "./types.js";
import { cacheEfficiencyAdvisor } from "./advisors/cache-efficiency.js";
import { burnForecastAdvisor } from "./advisors/burn-forecast.js";
import { crossToolAdvisor } from "./advisors/cross-tool.js";
import { modelMixModule } from "./advisors/model-mix.js";

// Recommendation-producing advisors. Plan 4 appends the five Tier-2 deep advisors.
export const ADVISORS: Record<string, Advisor> = {
  "cache-efficiency": cacheEfficiencyAdvisor,
  "burn-forecast": burnForecastAdvisor,
  "cross-tool": crossToolAdvisor,
};

// Standalone informational module providers (no recommendation attached).
export const MODULE_PROVIDERS: Record<string, ModuleProvider> = {
  "model-mix": modelMixModule,
};

/** Tier-2 categories shown to non-deep owners as locked teasers (value hidden). */
export const LOCKED_TIER2_TEASERS: Array<{ id: string; label: string }> = [
  { id: "waste-detector", label: "Did your spend ship working code?" },
  { id: "cost-per-outcome", label: "Cost per surviving line & merged PR" },
  { id: "task-fit", label: "Which tool/model fits which task" },
  { id: "skill-fit", label: "Which skills cut your reverts" },
  { id: "behavior-coach", label: "Which habits ship more per dollar" },
];

export function runAdvisors(ctx: CoachContext): Recommendation[] {
  return Object.values(ADVISORS).map((a) => a(ctx)).filter((r): r is Recommendation => r !== null);
}

export function runModules(ctx: CoachContext): Module[] {
  return Object.values(MODULE_PROVIDERS).map((p) => p(ctx)).filter((m): m is Module => m !== null);
}
