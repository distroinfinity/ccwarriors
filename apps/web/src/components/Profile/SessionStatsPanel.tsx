import type { Profile, ProfileInsights } from "../../useProfile";

const CLAMP_MINUTES = 10080; // 7 days — resume artifacts at the extractor ceiling

export function SessionStatsPanel({ profile }: { profile: Profile }) {
  if (profile.insights.locked) return null;
  const d = (profile.insights as ProfileInsights).depth;
  if (!d) return null;

  const windowLabel = `${d.sessions} session${d.sessions === 1 ? "" : "s"} · ${d.windowDays}d`;

  return (
    <div className="ppanel">
      <div className="seclabel">Sessions</div>

      <div className="habit">
        <b className="mono">{windowLabel}</b>
        <span>in this window</span>
      </div>

      {d.totalHours !== null && (
        <div className="habit">
          <b className="mono">{d.totalHours}h</b>
          <span>total active hours</span>
        </div>
      )}

      {d.avgSessionMinutes !== null && (
        <div className="habit">
          <b className="mono">{d.avgSessionMinutes}m</b>
          <span>avg session length</span>
        </div>
      )}

      <div className="habit">
        <b className="mono">
          {d.longestSessionMinutes}m
          {d.longestSessionMinutes >= CLAMP_MINUTES ? " (clamped)" : ""}
        </b>
        <span>longest session</span>
      </div>

      <div className="habit">
        <b className="mono">{d.planModeSessionsPct}%</b>
        <span>of sessions in plan mode</span>
      </div>

      {d.subagentSpawnsPerSession > 0 && (
        <div className="habit">
          <b className="mono">
            {d.subagentSpawnsPerSession} agents/session · peak {d.maxParallelAgents} parallel
          </b>
          <span>orchestration</span>
        </div>
      )}

      {d.maxConcurrentSessions !== undefined && (
        <div className="habit">
          <b className="mono">{d.maxConcurrentSessions}</b>
          <span>max concurrent sessions</span>
        </div>
      )}
    </div>
  );
}
