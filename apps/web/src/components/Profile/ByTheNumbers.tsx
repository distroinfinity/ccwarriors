import { useState, type ReactNode } from "react";
import type { Profile, ProfileInsights } from "../../useProfile";

function fmtMinutes(m: number): string {
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rest = Math.round(m % 60);
  return rest > 0 ? `${h}h ${rest}m` : `${h}h`;
}
const fmtUsd = (n: number) => (n < 0.01 ? `$${n}` : `$${n.toFixed(2)}`);

function GithubMark({ size = 13 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

type Stat = { v: string; label: string };

function Group({ title, headline, more }: { title: string; headline: Stat[]; more: ReactNode }) {
  const [open, setOpen] = useState(false);
  if (headline.length === 0) return null;
  return (
    <div className="bynum-grp">
      <div className="bynum-gl mono">{title}</div>
      {headline.map((s) => (
        <div className="bynum-stat" key={s.label}>
          <b className="mono">{s.v}</b>
          <span>{s.label}</span>
        </div>
      ))}
      {more && (
        <>
          <button className="bynum-more mono" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? "less" : "more"}
          </button>
          {open && <div className="bynum-extra">{more}</div>}
        </>
      )}
    </div>
  );
}

export function ByTheNumbers({ profile }: { profile: Profile }) {
  const ins: ProfileInsights | null = profile.insights.locked ? null : profile.insights;
  const e = profile.efficiency;
  const g = profile.github;
  const d = ins?.depth ?? null;
  const econ = ins?.economics ?? null;
  const stack = ins?.stack ?? null;

  // -- Outcomes --
  const outHead: Stat[] = [];
  if (econ?.costPerSurvivingLoc != null) outHead.push({ v: fmtUsd(econ.costPerSurvivingLoc), label: "per surviving line" });
  if (e?.grade) outHead.push({ v: e.grade, label: "cache efficiency" });
  const outMore = (
    <>
      {econ?.commitsPer100Usd != null && <div className="bynum-stat"><b className="mono">{econ.commitsPer100Usd}</b><span>commits per $100</span></div>}
      {e?.cacheReadRatio != null && <div className="bynum-stat"><b className="mono">{Math.round(e.cacheReadRatio * 100)}%</b><span>context from cache</span></div>}
      {e && e.modelMix.length > 0 && <div className="eff-mix mono">{e.modelMix.slice(0, 3).map((m) => <span key={m.family}>{m.family} {Math.round(m.share * 100)}%</span>)}</div>}
      <div className="axis-note">outcomes from local-git hashes, spend server-priced, last 30d</div>
    </>
  );

  // -- Sessions --
  const sessHead: Stat[] = [];
  if (d) {
    sessHead.push({ v: String(d.sessions), label: `sessions, ${d.windowDays}d` });
    sessHead.push({ v: `${d.planModeSessionsPct}%`, label: "in plan mode" });
  }
  const sessMore = d && (
    <>
      {d.totalHours != null && <div className="bynum-stat"><b className="mono">{d.totalHours}h</b><span>total active hours</span></div>}
      {d.avgSessionMinutes != null && <div className="bynum-stat"><b className="mono">{fmtMinutes(d.avgSessionMinutes)}</b><span>avg session</span></div>}
      <div className="bynum-stat"><b className="mono">{fmtMinutes(d.longestSessionMinutes)}</b><span>longest session</span></div>
      {d.subagentSpawnsPerSession > 0 && <div className="bynum-stat"><b className="mono">{d.subagentSpawnsPerSession}/session</b><span>subagent spawns, peak {d.maxParallelAgents}</span></div>}
    </>
  );

  // -- GitHub --
  const ghHead: Stat[] = [];
  if (g) {
    if (g.totalStars > 0) ghHead.push({ v: `★ ${g.totalStars.toLocaleString("en-US")}`, label: "stars" });
    if (g.mergedPublicPrs > 0) ghHead.push({ v: String(g.mergedPublicPrs), label: "public PRs merged" });
  }
  const ghMore = g && (
    <>
      {g.reposContributedTo > 0 && <div className="bynum-stat"><b className="mono">{g.reposContributedTo}</b><span>repos contributed to</span></div>}
      {g.longestStreakDays > 1 && <div className="bynum-stat"><b className="mono">{g.longestStreakDays}d</b><span>longest streak</span></div>}
      {g.topLanguages.length > 0 && <div className="gh-meta mono"><span>{g.topLanguages.slice(0, 3).map((l) => l.name).join(" · ")}</span></div>}
      <a className="gh-profile mono" href={`https://github.com/${encodeURIComponent(profile.login)}`} target="_blank" rel="noopener noreferrer">
        <GithubMark size={13} /><span>@{profile.login}</span>
      </a>
    </>
  );

  // -- Builds with --
  const stackHead: Stat[] = [];
  if (stack && stack.languages.length) {
    const topLang = stack.languages[0];
    if (topLang) stackHead.push({ v: topLang.name, label: stack.languages.slice(1, 3).map((l) => l.name).join(" · ") || "top language" });
  }
  if (stack && stack.models.length) {
    const topModel = stack.models[0];
    if (topModel) stackHead.push({ v: topModel.family, label: stack.models.slice(1, 3).map((m) => m.family).join(" · ") || "primary model" });
  }
  const stackMore = stack && (
    <>
      {stack.languages.length > 0 && stack.languages.map((l, i) => (
        <div className="axis" key={l.name}>
          <span className="axis-k">{l.name}</span>
          <div className="axis-track"><span className={`axis-fill f${Math.min(i, 2)}`} style={{ width: `${l.share}%` }} /></div>
          <span className="axis-v mono">{l.share}%</span>
        </div>
      ))}
      <div className="axis-note">verified from real agent edits, not repo labels</div>
    </>
  );

  const groups = [
    { title: "Outcomes", headline: outHead, more: outMore },
    { title: "Sessions", headline: sessHead, more: sessMore },
    { title: g ? "GitHub · verified" : "GitHub", headline: ghHead, more: ghMore },
    { title: "Builds with", headline: stackHead, more: stackMore },
  ];
  if (groups.every((grp) => grp.headline.length === 0)) return null;

  return (
    <section className="bynum">
      <div className="seclabel">By the numbers</div>
      <div className="bynum-grid">
        {groups.map((grp) => (
          <Group key={grp.title} title={grp.title} headline={grp.headline} more={grp.more} />
        ))}
      </div>
    </section>
  );
}
