import type { Profile, ProfileInsights } from "../../useProfile";

export function HabitsPanel({ profile }: { profile: Profile }) {
  if (profile.insights.locked) return null;
  const h = (profile.insights as ProfileInsights).habits;
  const rows: Array<[string, string]> = [
    [`${h.shortPromptPct}%`, "of your prompts are under 10 words"],
    [`${h.planModeSessionsPct}%`, "of sessions open in plan mode"],
    [`${h.maxParallelAgents}`, "agents at peak, in parallel"],
    [`${h.interruptsPer100Turns}`, "interrupts per 100 agent turns"],
  ];
  // At the extractor's 7-day clamp the number is a resumed-session artifact, not a session.
  if (h.longestSessionMinutes < 7 * 24 * 60) {
    rows.push([`${Math.round(h.longestSessionMinutes / 60 * 10) / 10}h`, "longest single session"]);
  }
  return (
    <div className="ppanel">
      <div className="seclabel">Habits</div>
      {rows.map(([v, label]) => (
        <div className="habit" key={label}>
          <b className="mono">{v}</b>
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}
