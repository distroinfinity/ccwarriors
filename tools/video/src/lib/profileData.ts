// Loads the snapshotted profile (scripts/fetch-profile.mjs) and derives the
// exact figures the scenes show — same shaping as the web profile components so
// the film matches prod pixel-for-pixel. All numbers are real, none hardcoded.
import snapshot from "../../data/profile.json";
import { DATA } from "./data";

const SNAP = snapshot as unknown as {
  fetchedAt: string;
  avatar: string | null;
  profile: ProfileJson;
};

interface ProfileJson {
  login: string;
  avatarUrl: string;
  tier: string;
  cost30d: number;
  costAllTime: number;
  rank30d: number | null;
  underReview: boolean;
  memberSince: string | null;
  orgs: string[];
  rhythm: { days: Array<{ day: string; cost: number }>; currentStreak: number; longestStreak: number };
  efficiency: { grade: string | null; cacheReadRatio: number | null } | null;
  github?: { totalStars: number; mergedPublicPrs: number } | null;
  insights: {
    locked: boolean;
    craftScore: number | null;
    craftTier?: { key: string; name: string } | null;
    archetype: string;
    tagline?: string | null;
    growthEdge: string;
    trustTier: 0 | 1 | null;
    githubVerified?: boolean;
    sampleSessions?: number;
    windowDays?: number;
    pillars: Record<string, number> | null;
    depth?: { totalHours: number | null; planModeSessionsPct: number } | null;
    economics?: { costPerSurvivingLoc: number | null; commitsPer100Usd: number | null; survivingLoc: number } | null;
    stack?: { languages: Array<{ name: string; share: number }> } | null;
    cards: Array<{ key: string; question: string; headline: string; body: string; stat?: string }>;
    featuredCardKeys?: string[];
    deckMonth?: string;
  };
}

const P = SNAP.profile;
const INS = P.insights;

// Pillar order + labels — verbatim from apps/web ArchetypeCard.tsx.
const PILLAR_ORDER = ["direction", "verification", "autonomy", "yield", "orchestration", "throughput"] as const;
const PILLAR_LABEL: Record<string, string> = {
  direction: "DIRECTION",
  verification: "VERIFICATION",
  autonomy: "AUTONOMY",
  yield: "YIELD",
  orchestration: "ORCHESTRATION",
  throughput: "THROUGHPUT",
};

const pillars = INS.pillars ?? {};
// Sorted by score descending — terracotta intensity steps down the ranking.
const PILLARS_SORTED = [...PILLAR_ORDER]
  .filter((k) => k in pillars)
  .sort((a, b) => pillars[b]! - pillars[a]!)
  .map((key, i) => ({
    key,
    label: PILLAR_LABEL[key]!,
    value: pillars[key]!,
    rankClass: Math.min(i, 2) as 0 | 1 | 2, // f0/f1/f2 opacity tiers
  }));

const topPillar = PILLARS_SORTED[0];
const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

// The verdict: story tagline, else the archetype flavor (web fallback verbatim).
const verdict =
  INS.tagline && INS.tagline.trim().length > 0
    ? INS.tagline
    : `Plays as the ${INS.archetype.replace(/^the\s+/i, "")}. ${INS.growthEdge}`;

// GitHub-style rhythm heatmap: 26 cols x 7 rows, column-major, recent at the right.
const COLS = 26;
const ROWS = 7;
const CELLS = COLS * ROWS;
const days = P.rhythm.days;
const maxCost = Math.max(...days.map((d) => d.cost), 1);
const heatLevels = new Array<number>(CELLS).fill(0);
const recent = days.slice(-CELLS);
for (let i = 0; i < recent.length; i++) {
  const c = recent[i]!.cost;
  heatLevels[CELLS - recent.length + i] = c <= 0 ? 0 : Math.min(4, 1 + Math.floor((c / maxCost) * 3.99));
}

// The monthly insight deck for the teaser — stat-forward cards only. The story
// doorway and the archetype get their own release video, so they're excluded
// here; outcome_per_dollar is already shown in the By-the-Numbers beat.
const EXCLUDE = new Set(["story", "archetype", "outcome_per_dollar"]);
const PREFER = ["total_hours", "first_try", "model", "agents", "night_owl", "recovery", "you_test"];
const deckPool = INS.cards.filter((c) => !EXCLUDE.has(c.key));
const deckCards: ProfileJson["insights"]["cards"] = [];
for (const k of PREFER) {
  const c = deckPool.find((x) => x.key === k);
  if (c && deckCards.length < 3) deckCards.push(c);
}
for (const c of deckPool) {
  if (deckCards.length < 3 && !deckCards.includes(c)) deckCards.push(c);
}

const monthLabel = INS.deckMonth
  ? new Date(`${INS.deckMonth}-01T00:00:00Z`).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })
  : null;

export const PROFILE = {
  login: P.login,
  avatar: SNAP.avatar, // staticFile-relative path, e.g. "avatars/distroinfinity.png"
  rank: P.underReview ? null : P.rank30d,
  sinceYear: P.memberSince ? new Date(P.memberSince).getUTCFullYear() : null,
  allTimeUsd: Math.round(P.costAllTime),
  burn30dUsd: Math.floor(P.cost30d),
  craft: Math.round(INS.craftScore ?? 0),
  craftRaw: INS.craftScore ?? 0,
  tierKey: INS.craftTier?.key ?? "artisan",
  tierName: (INS.craftTier?.name ?? "").toUpperCase(),
  archetype: INS.archetype,
  verdict,
  verified: INS.trustTier === 1,
  githubVerified: !!INS.githubVerified,
  sessions: INS.sampleSessions ?? 0,
  windowDays: INS.windowDays ?? 0,
  pillars: PILLARS_SORTED,
  topPillar: topPillar ? { label: titleCase(topPillar.label), value: Math.round(topPillar.value) } : null,
  grade: P.efficiency?.grade ?? null,
  costPerLine: INS.economics?.costPerSurvivingLoc ?? null,
  commitsPer100: INS.economics?.commitsPer100Usd ?? null,
  survivingLoc: INS.economics?.survivingLoc ?? null,
  planModePct: INS.depth?.planModeSessionsPct ?? null,
  totalHours: INS.depth?.totalHours ?? null,
  rhythm: {
    current: P.rhythm.currentStreak,
    longest: P.rhythm.longestStreak,
    activeDays: days.filter((d) => d.cost > 0).length,
    levels: heatLevels,
    cols: COLS,
    rows: ROWS,
  },
  stackLangs: INS.stack?.languages ?? [],
  github: P.github ? { stars: P.github.totalStars, prs: P.github.mergedPublicPrs } : null,
  cards: deckCards.map((c) => ({ key: c.key, question: c.question, headline: c.headline, body: c.body, stat: c.stat })),
  monthLabel,
  // Global legion stats (from the leaderboard snapshot) for the page chrome.
  warriors: DATA.warriorCount,
  burned30d: DATA.totalBurned30d,
};

// Sig-bar / pillar-fill opacity tiers (mast-sig f0/f1/f2 from index.css).
export const SIG_OPACITY = [1, 0.6, 0.35];
export const FILL_OPACITY = [1, 0.75, 0.5];
