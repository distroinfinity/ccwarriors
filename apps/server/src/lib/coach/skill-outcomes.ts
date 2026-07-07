import { and, eq } from "drizzle-orm";
import type { DB } from "../../db/index.js";
import { users, userDeepSessions } from "../../db/schema.js";

export const MIN_SKILL_REPORT = 5;    // don't surface a skill below this many adopters (too noisy)
export const SKILL_CALIBRATED = 30;   // "calibrated" cohort finding — matches COHORT_MIN_POPULATION

export interface SkillOutcome {
  skill: string;
  adopters: number;
  nonAdopters: number;
  medianRevertWith: number;
  medianRevertWithout: number;
  relativeDelta: number;   // (without − with)/without; positive = adopters revert less
  calibrated: boolean;     // adopters >= SKILL_CALIBRATED
}

export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/**
 * Associational skill→outcome across consenting-public deep users. Per user: one
 * revert ratio + the set of skills used (concatenated across machines). Per skill:
 * adopters vs non-adopters median revert. NOT causal — adopters may already write
 * better code; the surface labels this a correlation.
 */
export async function loadSkillOutcomes(db: DB, _now: number): Promise<SkillOutcome[]> {
  const rows = await db
    .select({ userId: userDeepSessions.userId, sessions: userDeepSessions.sessions })
    .from(userDeepSessions)
    .innerJoin(users, eq(users.id, userDeepSessions.userId))
    .where(and(eq(users.insightsConsent, true), eq(users.insightsVisibility, "public")));

  const perUser = new Map<string, { added: number; reverted: number; skills: Set<string> }>();
  for (const r of rows) {
    const u = perUser.get(r.userId) ?? { added: 0, reverted: 0, skills: new Set<string>() };
    for (const s of r.sessions) {
      if (s.git) { u.added += s.git.linesAdded; u.reverted += s.git.revertedLinesWithin14d; }
      for (const k of Object.keys(s.skillsUsed ?? {})) u.skills.add(k);
    }
    perUser.set(r.userId, u);
  }

  const cohort = [...perUser.values()]
    .filter((u) => u.added > 0)
    .map((u) => ({ revert: u.reverted / u.added, skills: u.skills }));

  const allSkills = new Set<string>();
  for (const u of cohort) for (const k of u.skills) allSkills.add(k);

  const out: SkillOutcome[] = [];
  for (const skill of allSkills) {
    const withS = cohort.filter((u) => u.skills.has(skill)).map((u) => u.revert);
    const withoutS = cohort.filter((u) => !u.skills.has(skill)).map((u) => u.revert);
    // k-anonymize BOTH sides: a public median must never be one individual's exact ratio.
    if (withS.length < MIN_SKILL_REPORT || withoutS.length < MIN_SKILL_REPORT) continue;
    const round3 = (x: number) => Math.round(x * 1000) / 1000;
    const mw = round3(median(withS)), mo = round3(median(withoutS));
    out.push({
      skill, adopters: withS.length, nonAdopters: withoutS.length,
      medianRevertWith: mw, medianRevertWithout: mo,
      relativeDelta: mo > 0 ? round3((mo - mw) / mo) : 0,
      calibrated: withS.length >= SKILL_CALIBRATED,
    });
  }
  out.sort((a, b) => b.relativeDelta - a.relativeDelta);
  return out;
}
