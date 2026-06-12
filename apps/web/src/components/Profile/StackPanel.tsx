import type { Profile, ProfileInsights } from "../../useProfile";

// "Builds with" panel: verified from real agent edits, not repo labels.
// Languages are derived from file extensions actually edited by AI agents.
export function StackPanel({ profile }: { profile: Profile }) {
  if (profile.insights.locked) return null;
  const stack = (profile.insights as ProfileInsights).stack;
  if (!stack) return null;

  const { languages, models, ghLanguages } = stack;
  const hasLanguages = languages.length > 0;
  const hasModels = models.length > 0;
  const hasGh = ghLanguages.length > 0;
  if (!hasLanguages && !hasModels && !hasGh) return null;

  return (
    <div className="ppanel">
      <div className="seclabel">Builds with</div>

      {hasLanguages && (
        <>
          {languages.map((l, i) => (
            <div className="axis" key={l.name}>
              <span className="axis-k">{l.name}</span>
              <div className="axis-track">
                <span
                  className={`axis-fill f${Math.min(i, 2)}`}
                  style={{ width: `${l.share}%` }}
                />
              </div>
              <span className="axis-v mono">{l.share}%</span>
            </div>
          ))}
        </>
      )}

      {hasModels && (
        <div className="eff-mix mono">
          {models.map((m) => (
            <span key={m.family}>
              {m.family} {Math.round(m.share * 100)}%
            </span>
          ))}
        </div>
      )}

      {hasGh && (
        <div className="gh-meta mono">
          <span>{ghLanguages.join(" · ")}</span>
        </div>
      )}

      <div className="axis-note">
        verified from real agent edits, not repo labels
      </div>
    </div>
  );
}
