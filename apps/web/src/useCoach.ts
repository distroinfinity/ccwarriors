import { useEffect, useState } from "react";
import { API_HTTP } from "./api";

export interface DollarRange { low: number; high: number; }

export interface CoachRecommendation {
  id: string;
  tier: 1 | 2;
  category: "spend" | "outcome" | "fit" | "behavior";
  visibility: "owner" | "public";
  title: string;
  evidenceLine: string;
  action: string;
  dollarImpact: DollarRange | null;
  outcomeImpact: string | null;
  confidence: "early" | "solid";
  severity: "save" | "improve" | "good";
  locked: boolean;
  themeKey?: string;
  whyHref?: string;
  installTarget?: { skillId: string; command: string } | null;
}

export interface CoachModule {
  id: string;
  tier: 1 | 2;
  visibility: "owner" | "public";
  label: string;
  value: string;
  benchmark: string | null;
  tip: string | null;
  informationalOnly?: boolean;
  locked: boolean;
}

export interface CoachPayload {
  locked?: false;
  recommendations: CoachRecommendation[];
  modules: CoachModule[];
  deepModeLocked: boolean;
  isOwner: boolean;
  cohort: { population: number; calibrated: boolean };
}

export interface LockedCoach { locked: true; reason: "no_consent" | "forging"; }

export type CoachState =
  | { status: "loading" }
  | { status: "ready"; login: string; coach: CoachPayload | LockedCoach }
  | { status: "error"; login: string };

// Lazy companion to useProfile: fetches the coach payload in parallel. Mirrors
// useProfileInsights — keeps stale-but-good data for the same login on a refetch
// hiccup; only a login change resets to a skeleton.
export function useProfileCoach(login: string, refreshKey = 0): CoachState {
  const [state, setState] = useState<CoachState>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    setState((prev) =>
      prev.status === "ready" && prev.login.toLowerCase() === login.toLowerCase() ? prev : { status: "loading" },
    );
    const fail = () =>
      setState((prev) =>
        prev.status === "ready" && prev.login.toLowerCase() === login.toLowerCase() ? prev : { status: "error", login },
      );
    fetch(`${API_HTTP}/profile/${encodeURIComponent(login)}/coach`, { credentials: "include" })
      .then(async (r) => {
        if (cancelled) return;
        if (!r.ok) return fail();
        const coach = (await r.json()) as CoachPayload | LockedCoach;
        setState({ status: "ready", login, coach });
      })
      .catch(() => { if (!cancelled) fail(); });
    return () => { cancelled = true; };
  }, [login, refreshKey]);
  return state;
}
