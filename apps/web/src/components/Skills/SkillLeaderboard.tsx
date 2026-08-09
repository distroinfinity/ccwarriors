import { useSkillOutcomes, type SkillOutcome } from "../../useSkills";

function pct(n: number): string { return `${Math.round(n * 100)}%`; }

function Row({ s, rank }: { s: SkillOutcome; rank: number }) {
  const better = s.relativeDelta > 0;
  return (
    <div className="skl-row">
      <span className="skl-rank mono">{rank}</span>
      <div className="skl-main">
        <div className="skl-name mono">{s.skill}</div>
        <div className="skl-claim">
          {better
            ? <>developers who use it revert <b>{pct(s.relativeDelta)} less</b> ({pct(s.medianRevertWith)} vs {pct(s.medianRevertWithout)})</>
            : <>no revert advantage in the data yet ({pct(s.medianRevertWith)} vs {pct(s.medianRevertWithout)})</>}
        </div>
        <code className="skl-install mono">npx skills find {s.skill}</code>
      </div>
      <div className="skl-meta mono">
        <span className={`skl-badge${s.calibrated ? " cal" : ""}`}>{s.calibrated ? "calibrated" : "early read"}</span>
        <span className="skl-n">n={s.adopters}</span>
      </div>
    </div>
  );
}

export function SkillLeaderboard() {
  const state = useSkillOutcomes();
  return (
    <div className="skl-page">
      <a className="how-back" href="/">← Back to the board</a>
      <h1>Which skills actually cut reverts</h1>
      <p className="skl-lede">
        Ranked by <b>measured outcome across CCWarriors developers</b>, not by install count. This is an
        association, not proof — developers who adopt a skill may already write differently. A “calibrated”
        badge means 30+ adopters; an “early read” is a smaller, provisional sample. Skills with fewer than 5
        adopters are not shown.
      </p>
      {state.status === "loading" && <div className="sk-block" style={{ height: 200 }} aria-busy="true" />}
      {state.status === "error" && <p className="skl-empty mono">Couldn’t load the skill outcomes right now.</p>}
      {state.status === "ready" && state.skills.length === 0 && (
        <p className="skl-empty mono">No skill has enough adopters in the data yet. Check back as more developers enable deep mode.</p>
      )}
      {state.status === "ready" && state.skills.length > 0 && (
        <div className="skl-list">
          {state.skills.map((s, i) => <Row key={s.skill} s={s} rank={i + 1} />)}
        </div>
      )}
    </div>
  );
}
