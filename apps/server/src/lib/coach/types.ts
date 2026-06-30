// coach/types.ts
import type { SessionRecord } from "../../db/schema.js";
import type { Efficiency } from "../efficiency.js";

export type Tier = 1 | 2;
export type Severity = "save" | "improve" | "good";
export type Visibility = "owner" | "public";
export type Confidence = "early" | "solid";
export type Category = "spend" | "outcome" | "fit" | "behavior";

export interface DollarRange { low: number; high: number; }

export interface Recommendation {
  id: string;
  tier: Tier;
  category: Category;
  visibility: Visibility;
  title: string;
  evidenceLine: string;
  action: string;
  dollarImpact: DollarRange | null;
  outcomeImpact: string | null;
  confidence: Confidence;
  severity: Severity;
  locked: boolean;
  themeKey?: string;   // recs sharing a themeKey are near-twins; ranker keeps the higher-scored
  whyHref?: string;
}

export interface Module {
  id: string;
  tier: Tier;
  visibility: Visibility;
  label: string;
  value: string;
  benchmark: string | null;
  tip: string | null;
  informationalOnly?: boolean;
  locked: boolean;
}

export interface PerToolUsage {
  tool: string;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export interface CoachSession extends SessionRecord {
  tool: string;            // normalized — never undefined (defaults "claude")
  estimatedCost: number;   // derived, window-apportioned (never stored)
}

export interface Benchmarks {
  rank(metric: string, value: number): { percentile: number; population: number } | null;
  readonly population: number;   // size of the primary (cacheReadRatio) cohort
}

export interface CoachContext {
  now: number;
  windowDays: number;
  isOwner: boolean;
  deepMode: boolean;
  windowCostUsd: number;
  usageByTool: PerToolUsage[];
  efficiency: Efficiency | null;
  monthlyCacheRatios: Array<{ month: string; ratio: number }>;
  burn: { projectedMonthUsd: number; priorMonthUsd: number | null; runRatePerDay: number };
  deepSessions: CoachSession[];
  benchmarks: Benchmarks;
}

export type Advisor = (ctx: CoachContext) => Recommendation | null;
export type ModuleProvider = (ctx: CoachContext) => Module | null;

export interface CoachPayload {
  recommendations: Recommendation[];   // owner: ranked top-3 feed; public: []
  modules: Module[];
  deepModeLocked: boolean;
  isOwner: boolean;
  cohort: { population: number; calibrated: boolean };
}
