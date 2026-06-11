import type { Profile } from "../../useProfile";

// Verified-by-GitHub public footprint: a compact stat strip. Renders nothing
// when the server has no stats yet — it's optional data, never a skeleton.
export function GithubPanel({ profile }: { profile: Profile }) {
  const g = profile.github;
  if (!g) return null;

  const sinceYear = new Date(g.accountCreatedAt).getUTCFullYear();
  const langs = g.topLanguages.slice(0, 3).map((l) => l.name);

  const rows: Array<{ v: string; label: string }> = [];
  if (g.totalStars > 0) rows.push({ v: `★ ${g.totalStars.toLocaleString("en-US")}`, label: "stars on public repos" });
  if (g.mergedPublicPrs > 0) rows.push({ v: String(g.mergedPublicPrs), label: "public PRs merged" });
  if (g.reposContributedTo > 0) rows.push({ v: String(g.reposContributedTo), label: "repos contributed to" });
  if (g.longestStreakDays > 1) rows.push({ v: `${g.longestStreakDays}d`, label: "longest contribution streak" });
  if (rows.length === 0 && langs.length === 0) return null;

  return (
    <div className="ppanel">
      <div className="seclabel">GitHub · verified</div>
      {rows.map((r) => (
        <div className="habit" key={r.label}>
          <b className="mono">{r.v}</b>
          <span>{r.label}</span>
        </div>
      ))}
      <div className="gh-meta mono">
        {langs.length > 0 && <span>{langs.join(" · ")}</span>}
        {Number.isFinite(sinceYear) && <span>since {sinceYear}</span>}
      </div>
    </div>
  );
}
