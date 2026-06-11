import type { Profile } from "../../useProfile";

// The official GitHub octocat mark, drawn in currentColor. The one deliberate
// exception to the pixel-glyph rule: the brand mark has to be recognizable.
function GithubMark({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

// Public GitHub footprint. Always renders the profile link; the verified stat
// strip below it is optional data and appears only once the server has it.
export function GithubPanel({ profile }: { profile: Profile }) {
  const g = profile.github;

  const sinceYear = g ? new Date(g.accountCreatedAt).getUTCFullYear() : NaN;
  const langs = g ? g.topLanguages.slice(0, 3).map((l) => l.name) : [];

  const rows: Array<{ v: string; label: string }> = [];
  if (g) {
    if (g.totalStars > 0) rows.push({ v: `★ ${g.totalStars.toLocaleString("en-US")}`, label: "stars on public repos" });
    if (g.mergedPublicPrs > 0) rows.push({ v: String(g.mergedPublicPrs), label: "public PRs merged" });
    if (g.reposContributedTo > 0) rows.push({ v: String(g.reposContributedTo), label: "repos contributed to" });
    if (g.longestStreakDays > 1) rows.push({ v: `${g.longestStreakDays}d`, label: "longest contribution streak" });
  }

  return (
    <div className="ppanel">
      <div className="seclabel">{g ? "GitHub · verified" : "GitHub"}</div>
      <a
        className="gh-profile mono"
        href={`https://github.com/${encodeURIComponent(profile.login)}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        <GithubMark size={14} />
        <span>@{profile.login}</span>
      </a>
      {rows.map((r) => (
        <div className="habit" key={r.label}>
          <b className="mono">{r.v}</b>
          <span>{r.label}</span>
        </div>
      ))}
      {(langs.length > 0 || Number.isFinite(sinceYear)) && (
        <div className="gh-meta mono">
          {langs.length > 0 && <span>{langs.join(" · ")}</span>}
          {Number.isFinite(sinceYear) && <span>since {sinceYear}</span>}
        </div>
      )}
    </div>
  );
}
