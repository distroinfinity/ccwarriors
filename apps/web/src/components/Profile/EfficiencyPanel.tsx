import type { Profile, ProfileInsights } from "../../useProfile";

function EconomicsBlock({ economics }: { economics: NonNullable<ProfileInsights["economics"]> }) {
  const hasCostPerLoc = economics.costPerSurvivingLoc !== null;
  const hasCommitsPer100 = economics.commitsPer100Usd !== null;
  if (!hasCostPerLoc && !hasCommitsPer100) return null;
  const fmt = (n: number) =>
    n < 0.01 ? `$${n}` : `$${n.toFixed(2)}`;
  return (
    <div className="ppanel-section">
      <div className="seclabel-minor">Economics</div>
      {hasCostPerLoc && (
        <div className="habit">
          <b className="mono">{fmt(economics.costPerSurvivingLoc!)}</b>
          <span>per surviving line</span>
        </div>
      )}
      {hasCommitsPer100 && (
        <div className="habit">
          <b className="mono">{economics.commitsPer100Usd}</b>
          <span>commits per $100</span>
        </div>
      )}
      <div className="axis-note">
        outcomes from local-git hashes · spend server-priced, last 30d
      </div>
    </div>
  );
}

export function EfficiencyPanel({ profile }: { profile: Profile }) {
  const e = profile.efficiency;
  const ins = profile.insights.locked ? null : profile.insights;
  const economics = ins?.economics ?? null;
  const hasEfficiency = !!(e && e.grade);
  if (!hasEfficiency && !economics) return null;
  return (
    <div className="ppanel">
      <div className="seclabel">Efficiency</div>
      {hasEfficiency && (
        <>
          <div className="eff-grade">
            <span className="eff-letter mono">{e!.grade}</span>
            <span className="eff-sub">cache efficiency</span>
          </div>
          {e!.cacheReadRatio !== null && (
            <div className="habit">
              <b className="mono">{Math.round(e!.cacheReadRatio * 100)}%</b>
              <span>of context served from cache</span>
            </div>
          )}
          {e!.modelMix.length > 0 && (
            <div className="eff-mix mono">
              {e!.modelMix.slice(0, 3).map((m) => (
                <span key={m.family}>
                  {m.family} {Math.round(m.share * 100)}%
                </span>
              ))}
            </div>
          )}
        </>
      )}
      {economics && <EconomicsBlock economics={economics} />}
    </div>
  );
}
