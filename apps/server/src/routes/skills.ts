import { Hono } from "hono";
import type { DB } from "../db/index.js";
import { loadSkillOutcomes, type SkillOutcome } from "../lib/coach/skill-outcomes.js";

const TTL_MS = 60 * 60 * 1000; // 1h, mirrors the benchmark cadence
let cache: { at: number; skills: SkillOutcome[] } | null = null;

/** Test seam: drop the cached aggregate so the next request recomputes. */
export function clearSkillOutcomesCache(): void { cache = null; }

export function skillsRoute(db: DB) {
  const app = new Hono();
  app.get("/outcomes", async (c) => {
    const now = Date.now();
    if (!cache || now - cache.at > TTL_MS) {
      cache = { at: now, skills: await loadSkillOutcomes(db, now) };
    }
    c.header("Cache-Control", "public, max-age=300");
    return c.json({ skills: cache.skills });
  });
  return app;
}
