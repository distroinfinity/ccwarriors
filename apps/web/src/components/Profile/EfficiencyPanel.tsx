import type { Profile } from "../../useProfile";

export function EfficiencyPanel({ profile }: { profile: Profile }) {
  const e = profile.efficiency;
  if (!e || !e.grade) return null;
  return (
    <div className="ppanel">
      <div className="seclabel">Efficiency</div>
      <div className="eff-grade">
        <span className="eff-letter mono">{e.grade}</span>
        <span className="eff-sub">cache efficiency</span>
      </div>
      {e.cacheReadRatio !== null && (
        <div className="habit">
          <b className="mono">{Math.round(e.cacheReadRatio * 100)}%</b>
          <span>of context served from cache</span>
        </div>
      )}
      {e.modelMix.length > 0 && (
        <div className="eff-mix mono">
          {e.modelMix.slice(0, 3).map((m) => (
            <span key={m.family}>
              {m.family} {Math.round(m.share * 100)}%
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
