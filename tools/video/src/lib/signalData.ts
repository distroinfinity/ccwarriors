// Real figures + pre-formatted display strings for "The New Signal" film.
// Single source so 3D numbers (shots) and DOM captions never drift. All values
// trace to data/profile.json (distroinfinity) and data/leaderboard.json.
import { PROFILE } from "./profileData";
import { DATA } from "./data";

const usd = (n: number) => `$${n.toLocaleString("en-US")}`;
const num = (n: number) => n.toLocaleString("en-US");

export const SIGNAL = {
  login: PROFILE.login,
  avatar: PROFILE.avatar,

  // raw values
  builders: DATA.warriorCount, // 54
  sessions: PROFILE.sessions, // 295
  burnUsd: PROFILE.burn30dUsd, // 7934
  survivingLoc: PROFILE.survivingLoc ?? 0, // 689674
  costPerLine: PROFILE.costPerLine ?? 0, // 0.01
  cacheGrade: PROFILE.grade ?? "—", // A+
  commitsPer100: PROFILE.commitsPer100 ?? 0, // 5.4
  craft: PROFILE.craft, // 61
  tierName: PROFILE.tierName, // ARTISAN
  topSignalLabel: PROFILE.topPillar?.label ?? "Orchestration",
  topSignalValue: PROFILE.topPillar?.value ?? 100,

  // pre-formatted caption strings (verbatim to the spec)
  caption: {
    builders: `${DATA.warriorCount} BUILDERS`,
    fieldReport: "FIELD REPORT",
    burn: `30 DAYS · ${PROFILE.sessions} SESSIONS · ${usd(PROFILE.burn30dUsd)}`,
    output: `${num(PROFILE.survivingLoc ?? 0)} LINES — KEPT`,
    efficiency: `${PROFILE.costPerLine != null ? `$${PROFILE.costPerLine}` : "—"} / LINE · ${PROFILE.grade ?? "—"} CACHE · ${PROFILE.commitsPer100 ?? 0} / $100`,
    signature: `CRAFT ${PROFILE.craft} · ${PROFILE.tierName}`,
    tagline: "The new signal for how the world builds.",
    domain: "ccwarriors.xyz",
  },

  // other real builders for the pull-back flicker (no fabricated numbers)
  others: DATA.entries.slice(0, 12).map((e) => ({ login: e.login, cost: Math.round(e.cost30d) })),
};
