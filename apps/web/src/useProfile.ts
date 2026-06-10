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
  growthEdge: string;
  // Craft Score (the headline). Null on aggregate-only insights (no deep rows)
  // or against an older server — the UI falls back to archetype + axes then.
  craftScore: number | null;
  pillars: ProfilePillars | null;
  trustTier: 0 | 1 | null;
  provisional: boolean;
}

export interface LockedInsights {
  locked: true;
  reason: "no_consent" | "forging";
}

export interface Profile {
  login: string;
  avatarUrl: string;
  xHandle: string | null;
  tier: string;
  cardScene: string;
  cost30d: number;
  costAllTime: number;
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
  insights: ProfileInsights | LockedInsights;
  owner?: { consent: boolean; visibility: "public" | "private"; machineCount: number; mode: "off" | "deep" };
}

export type ProfileState =
  | { status: "loading" }
  | { status: "notfound" }
  | { status: "ready"; profile: Profile };

export function useProfile(login: string, refreshKey = 0): ProfileState {
  const [state, setState] = useState<ProfileState>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    // Stale-while-revalidate: only show the skeleton on a cold load or a login
    // change. Consent toggles and pending polls refetch in the background so the
    // card never flashes back to a skeleton.
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
        setState({ status: "ready", profile: (await r.json()) as Profile });
      })
      .catch(() => {
        // Intentional conflation: network/500 render the same enlist page as a
        // true 404 — a profile URL with no data behind it has one story to tell.
        if (!cancelled) setState({ status: "notfound" });
      });
    return () => {
      cancelled = true;
    };
  }, [login, refreshKey]);
  return state;
}
