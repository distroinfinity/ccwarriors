import { useEffect, useState } from "react";
import { API_HTTP } from "./api";

export interface ProfileAxes {
  planning: number;
  autonomy: number;
  steering: number;
  summoning: number;
  velocity: number;
}

export interface ProfilePillars {
  direction: number;
  verification: number;
  autonomy: number;
  yield: number;
  orchestration: number;
  throughput: number;
}

// One delightful, shareable "wrapped" card. The server emits a card only when
// its underlying signal is real-data-backed, so `cards` can be short or empty.
export interface InsightCard {
  key: string;
  question: string;
  headline: string;
  body: string;
  stat?: string;
  shareText: string;
}

export interface ProfileInsights {
  locked: false;
  scoresArePercentiles: boolean;
  population: number;
  axes: ProfileAxes;
  archetype: string;
  trait: string | null;
  habits: {
    shortPromptPct: number;
    planModeSessionsPct: number;
    maxParallelAgents: number;
    interruptsPer100Turns: number;
    longestSessionMinutes: number;
  };
  // Paxel-style insight deck. Defaults to [] when an older server omits it.
  cards: InsightCard[];
  // "This month" featured subset of `cards` (keys). Absent on older servers.
  featuredCardKeys?: string[];
  // Month label for the featured deck, e.g. "2026-06". Absent on older servers.
  deckMonth?: string;
  // One-sentence identity line from the story, seeds the masthead. Null when no
  // story exists yet; absent on older servers.
  tagline?: string | null;
  growthEdge: string;
  // Craft Score (the headline). Null on aggregate-only insights (no deep rows)
  // or against an older server — the UI falls back to archetype + axes then.
  craftScore: number | null;
  // Forge tier: Apprentice <40 · Journeyman 40-59 · Artisan 60-79 · Mastersmith 80+.
  craftTier?: { key: "apprentice" | "journeyman" | "artisan" | "mastersmith"; name: string } | null;
  pillars: ProfilePillars | null;
  trustTier: 0 | 1 | null;
  provisional: boolean;
  // Owner-curated deck order (≤4 card keys). Absent on older servers.
  pinnedCards?: string[];
  // Sessions behind these scores. Absent on older servers.
  sampleSessions?: number;
  // Rolling window length for the sessions above. Absent on older servers.
  windowDays?: number;
  // Local-git verified AND public GitHub commits in the same window.
  githubVerified?: boolean;
  // Session depth panel: prominent first-class stats. All optional/nullable to
  // tolerate servers that predate this field.
  depth?: {
    sessions: number;
    windowDays: number;
    totalHours: number | null;
    planModeSessionsPct: number;
    subagentSessionsPct: number | null;
    subagentSpawnsPerSession: number;
    maxParallelAgents: number;
    maxConcurrentSessions?: number;
    avgSessionMinutes: number | null;
    longestSessionMinutes: number;
  } | null;
  // Outcome economics: cost per surviving line and commits per $100.
  // Optional/nullable: absent on older servers or when no deep data.
  economics?: {
    survivingLoc: number;
    shippedCommits: number;
    windowCostUsd: number;
    costPerSurvivingLoc: number | null;
    commitsPer100Usd: number | null;
  } | null;
  // Verified "builds with" stack: languages from real agent edits, model mix,
  // and GitHub top languages. Optional/nullable: absent on older servers or
  // when no deep data is available.
  stack?: {
    languages: Array<{ name: string; share: number }>;
    models: Array<{ family: string; share: number }>;
    ghLanguages: string[];
  } | null;
}

// Verified-by-GitHub public footprint. Public data — present (when fetched)
// regardless of insights consent; absent on older servers.
export interface GithubStats {
  login: string;
  accountCreatedAt: string;
  followers: number;
  publicRepos: number;
  totalStars: number;
  topLanguages: Array<{ name: string; repos: number }>;
  mergedPublicPrs: number;
  reviewsLastYear: number;
  commitsLastYear: number;
  contributionsLastYear: number;
  currentStreakDays: number;
  longestStreakDays: number;
  reposContributedTo: number;
  windowCommits: number;
}

export interface LockedInsights {
  locked: true;
  reason: "no_consent" | "forging";
}

// What the fast /profile/:login call returns — identity + at-a-glance, no insights.
export interface CoreProfile {
  login: string;
  avatarUrl: string;
  xHandle: string | null;
  tier: string;
  cardScene: string;
  cost30d: number;
  costAllTime: number;
  tokensAllTime?: number | null;
  rank30d: number | null;
  rankAllTime: number | null;
  underReview: boolean;
  memberSince: string | null;
  lastSyncedAt: string | null;
  orgs: string[];
  rhythm: { days: Array<{ day: string; cost: number }>; currentStreak: number; longestStreak: number };
  efficiency: {
    cacheReadRatio: number | null;
    opusShare: number;
    modelMix: Array<{ family: string; share: number }>;
    grade: string | null;
    estSavingsPerMonth: number | null;
    tokensPerActiveDay: number | null;
  } | null;
  github?: GithubStats | null;
  owner?: { consent: boolean; visibility: "public" | "private"; machineCount: number; mode: "off" | "deep"; consentVersion?: number };
}

// The contract every Profile child consumes: core fields + resolved insights.
// ProfilePage composes this from the two hooks below.
export type Profile = CoreProfile & { insights: ProfileInsights | LockedInsights };

export type ProfileState =
  | { status: "loading" }
  | { status: "notfound" }
  | { status: "ready"; profile: CoreProfile };

export function useProfile(login: string, refreshKey = 0): ProfileState {
  const [state, setState] = useState<ProfileState>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    // Stale-while-revalidate: skeleton only on cold load / login change.
    setState((prev) =>
      prev.status === "ready" && prev.profile.login.toLowerCase() === login.toLowerCase()
        ? prev
        : { status: "loading" },
    );
    fetch(`${API_HTTP}/profile/${encodeURIComponent(login)}`, { credentials: "include" })
      .then(async (r) => {
        if (cancelled) return;
        if (r.status === 404) return setState({ status: "notfound" });
        if (!r.ok) throw new Error(String(r.status));
        const profile = (await r.json()) as CoreProfile;
        setState({ status: "ready", profile });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "notfound" });
      });
    return () => {
      cancelled = true;
    };
  }, [login, refreshKey]);
  return state;
}

export type InsightsState =
  | { status: "loading" }
  | { status: "ready"; login: string; insights: ProfileInsights | LockedInsights };

// Lazy companion to useProfile: fetches the deep insights block in parallel.
// A failed/absent insights call degrades to a locked union so the page still
// renders. Keeps the previous payload across refreshKey bumps (no skeleton
// flash on consent toggles); only a login change resets to a skeleton.
export function useProfileInsights(login: string, refreshKey = 0): InsightsState {
  const [state, setState] = useState<InsightsState>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    setState((prev) =>
      prev.status === "ready" && prev.login.toLowerCase() === login.toLowerCase()
        ? prev
        : { status: "loading" },
    );
    const settle = (insights: ProfileInsights | LockedInsights) => {
      if (!cancelled) setState({ status: "ready", login, insights });
    };
    fetch(`${API_HTTP}/profile/${encodeURIComponent(login)}/insights`, { credentials: "include" })
      .then(async (r) => {
        if (cancelled) return;
        if (!r.ok) return settle({ locked: true, reason: "no_consent" });
        const insights = (await r.json()) as ProfileInsights | LockedInsights;
        // Tolerate older servers / partial payloads: cards is always an array.
        if (!insights.locked && !Array.isArray((insights as ProfileInsights).cards)) {
          (insights as ProfileInsights).cards = [];
        }
        settle(insights);
      })
      .catch(() => settle({ locked: true, reason: "no_consent" }));
    return () => {
      cancelled = true;
    };
  }, [login, refreshKey]);
  return state;
}
