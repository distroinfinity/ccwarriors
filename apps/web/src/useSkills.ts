import { useEffect, useState } from "react";
import { API_HTTP } from "./api";

export interface SkillOutcome {
  skill: string;
  adopters: number;
  nonAdopters: number;
  medianRevertWith: number;
  medianRevertWithout: number;
  relativeDelta: number;
  calibrated: boolean;
}

export type SkillsState =
  | { status: "loading" }
  | { status: "ready"; skills: SkillOutcome[] }
  | { status: "error" };

export function useSkillOutcomes(): SkillsState {
  const [state, setState] = useState<SkillsState>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_HTTP}/skills/outcomes`)
      .then(async (r) => {
        if (cancelled) return;
        if (!r.ok) return setState({ status: "error" });
        const body = (await r.json()) as { skills: SkillOutcome[] };
        setState({ status: "ready", skills: Array.isArray(body.skills) ? body.skills : [] });
      })
      .catch(() => { if (!cancelled) setState({ status: "error" }); });
    return () => { cancelled = true; };
  }, []);
  return state;
}
