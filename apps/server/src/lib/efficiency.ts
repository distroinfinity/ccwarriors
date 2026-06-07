// Efficiency + rhythm derived from usage_days rows. Deterministic heuristics —
// thresholds documented inline; tune with real data like lib/tier.ts does.
import type { ModelTokens } from "../db/schema.js";

export interface UsageDayLike {
  day: string; // YYYY-MM-DD
  cost: number;
  modelBreakdown: ModelTokens[] | null;
}

export interface Efficiency {
  cacheReadRatio: number | null; // cacheRead / (input + cacheCreation + cacheRead)
  opusShare: number; // 0..1 cost-weighted share on opus-family models
  modelMix: Array<{ family: string; share: number }>; // cost share by family, desc
  grade: string | null; // A+ A B C D
  estSavingsPerMonth: number | null; // $ if overused opus moved to sonnet
  tokensPerActiveDay: number | null;
}

const FAMILY_RE: Array<[RegExp, string]> = [
  [/opus/i, "opus"],
  [/sonnet/i, "sonnet"],
  [/haiku/i, "haiku"],
  [/gpt|o[0-9]|codex/i, "openai"],
  [/gemini/i, "gemini"],
];

function familyOf(model: string): string {
  for (const [re, fam] of FAMILY_RE) if (re.test(model)) return fam;
  return "other";
}

// Sonnet input+output is roughly 1/5 of Opus pricing; moving the overused
// share saves ~80% of that slice. Coarse on purpose — it is a nudge, not a bill.
const OPUS_OK_SHARE = 0.35;
const SONNET_DISCOUNT = 0.8;

/** Rows must already be filtered to the user; cutoff30 = ISO day 30 days ago. */
export function computeEfficiency(rows: UsageDayLike[], cutoff30: string): Efficiency {
  const window = rows.filter((r) => r.day >= cutoff30);
  if (window.length === 0) {
    return { cacheReadRatio: null, opusShare: 0, modelMix: [], grade: null, estSavingsPerMonth: null, tokensPerActiveDay: null };
  }
  let input = 0, cacheCreate = 0, cacheRead = 0, output = 0;
  const costByFamily = new Map<string, number>();
  let totalCost = 0;
  for (const r of window) {
    totalCost += r.cost;
    const models = r.modelBreakdown ?? [];
    const dayTokens = models.reduce((s, m) => s + m.inputTokens + m.outputTokens + m.cacheCreationTokens + m.cacheReadTokens, 0) || 1;
    for (const m of models) {
      input += m.inputTokens;
      cacheCreate += m.cacheCreationTokens;
      cacheRead += m.cacheReadTokens;
      output += m.outputTokens;
      // Apportion the day's server-priced cost by token share per model.
      const share = (m.inputTokens + m.outputTokens + m.cacheCreationTokens + m.cacheReadTokens) / dayTokens;
      const fam = familyOf(m.modelName);
      costByFamily.set(fam, (costByFamily.get(fam) ?? 0) + r.cost * share);
    }
  }
  const denom = input + cacheCreate + cacheRead;
  const cacheReadRatio = denom > 0 ? cacheRead / denom : null;
  const opusCost = costByFamily.get("opus") ?? 0;
  const opusShare = totalCost > 0 ? opusCost / totalCost : 0;
  const overuse = Math.max(0, opusShare - OPUS_OK_SHARE);
  const estSavingsPerMonth = overuse > 0 ? Math.round(totalCost * overuse * SONNET_DISCOUNT) : 0;

  let grade: string;
  const cache = cacheReadRatio ?? 0;
  if (opusShare < 0.2 && cache > 0.75) grade = "A+";
  else if (opusShare < 0.35 && cache > 0.6) grade = "A";
  else if (opusShare < 0.55) grade = "B";
  else if (opusShare < 0.75) grade = "C";
  else grade = "D";

  const modelMix = [...costByFamily.entries()]
    .filter(([, c]) => c > 0)
    .map(([family, c]) => ({ family, share: Math.round((c / Math.max(0.01, totalCost)) * 100) / 100 }))
    .sort((a, b) => b.share - a.share);

  const tokensPerActiveDay = Math.round((input + output + cacheCreate + cacheRead) / window.length);
  return { cacheReadRatio, opusShare, modelMix, grade, estSavingsPerMonth, tokensPerActiveDay };
}

export interface Rhythm {
  days: Array<{ day: string; cost: number }>; // every active day, ascending
  currentStreak: number;
  longestStreak: number;
  weekendShare: number; // share of active days on Sat/Sun (feeds traitOf)
}

export function computeRhythm(rows: UsageDayLike[], today: string): Rhythm {
  // Multiple rows per day (machines/tools) collapse to one summed cell.
  const byDay = new Map<string, number>();
  for (const r of rows) byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.cost);
  const days = [...byDay.entries()]
    .map(([day, cost]) => ({ day, cost: Math.round(cost * 100) / 100 }))
    .sort((a, b) => a.day.localeCompare(b.day));

  const active = new Set(days.filter((d) => d.cost > 0).map((d) => d.day));
  const dayMs = 86_400_000;
  const toMs = (d: string) => new Date(`${d}T00:00:00Z`).getTime();

  let currentStreak = 0;
  for (let t = toMs(today); active.has(new Date(t).toISOString().slice(0, 10)); t -= dayMs) currentStreak++;

  let longestStreak = 0;
  let run = 0;
  let prev: number | null = null;
  for (const d of days) {
    if (d.cost <= 0) continue;
    const t = toMs(d.day);
    run = prev !== null && t - prev === dayMs ? run + 1 : 1;
    longestStreak = Math.max(longestStreak, run);
    prev = t;
  }

  let weekend = 0;
  for (const d of active) {
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (dow === 0 || dow === 6) weekend++;
  }
  return { days, currentStreak, longestStreak, weekendShare: active.size > 0 ? weekend / active.size : 0 };
}
