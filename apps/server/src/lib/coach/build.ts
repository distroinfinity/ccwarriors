import type { DB } from "../../db/index.js";
import { users } from "../../db/schema.js";
import { buildCoachContext } from "./context.js";
import { loadBenchmarks, COHORT_MIN_POPULATION } from "./benchmark.js";
import { rankRecommendations } from "./ranker.js";
import { runAdvisors, runModules, LOCKED_TIER2_TEASERS } from "./registry.js";
import type { CoachPayload, Module, Recommendation } from "./types.js";

const FEED_SIZE = 3;

/** Map a fired recommendation to its dashboard-module form. */
export function recToModule(rec: Recommendation): Module {
  return {
    id: rec.id, tier: rec.tier, visibility: rec.visibility, label: rec.title,
    value: rec.evidenceLine,
    benchmark: rec.dollarImpact ? `est. ${rec.dollarImpact.low}–${rec.dollarImpact.high}/mo opportunity` : null,
    tip: rec.action, locked: false,
  };
}

function lockedTeasers(): Module[] {
  return LOCKED_TIER2_TEASERS.map((t) => ({
    id: t.id, tier: 2 as const, visibility: "owner" as const, label: t.label,
    value: "", benchmark: null, tip: null, locked: true,
  }));
}

/** Assemble the full coach payload for one user, gated by owner/public + deep mode. */
export async function buildCoach(
  db: DB,
  user: typeof users.$inferSelect,
  isOwner: boolean,
  now: number,
): Promise<CoachPayload> {
  const benchmarks = await loadBenchmarks(db, now);
  const ctx = await buildCoachContext(db, user, isOwner, now, benchmarks);

  const fired = rankRecommendations(runAdvisors(ctx));
  const modules: Module[] = [...fired.map(recToModule), ...runModules(ctx)];
  if (ctx.deepMode === false) modules.push(...lockedTeasers());

  const deepModeLocked = !ctx.deepMode;
  const cohort = { population: benchmarks.population, calibrated: benchmarks.population >= COHORT_MIN_POPULATION };

  if (!isOwner) {
    // Public viewers: no feed; only public-visibility modules.
    return {
      recommendations: [],
      modules: modules.filter((m) => m.visibility === "public"),
      deepModeLocked, isOwner: false, cohort,
    };
  }

  const ownerRecs = fired.filter((r) => r.visibility === "owner");
  let feed = ownerRecs.filter((r) => r.severity !== "good").slice(0, FEED_SIZE);
  if (feed.length === 0 && ownerRecs.length > 0) feed = [ownerRecs[0]!]; // never empty/punitive

  return { recommendations: feed, modules, deepModeLocked, isOwner: true, cohort };
}
