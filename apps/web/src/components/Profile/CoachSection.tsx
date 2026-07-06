import { useState } from "react";
import { useProfileCoach, type CoachPayload, type CoachRecommendation, type CoachModule } from "../../useCoach";

const SEVERITY_TAG: Record<CoachRecommendation["severity"], string> = {
  save: "opportunity", improve: "improve", good: "strong",
};

function headline(recs: CoachRecommendation[]): string {
  const dollars = recs.reduce((s, r) => s + (r.dollarImpact?.low ?? 0), 0);
  const parts: string[] = [];
  if (dollars > 0) parts.push(`~$${Math.round(dollars)}/mo estimated opportunity`);
  const outcome = recs.find((r) => r.outcomeImpact)?.outcomeImpact;
  if (outcome) parts.push(outcome);
  return parts.length ? parts.join(" · ") : "Your money-and-outcome read this window";
}

function FeedRow({ rec }: { rec: CoachRecommendation }) {
  const [open, setOpen] = useState(false);
  const impact = rec.dollarImpact
    ? `~$${rec.dollarImpact.low}–${rec.dollarImpact.high}/mo`
    : rec.outcomeImpact ?? "";
  return (
    <div className={`coach-row${open ? " open" : ""}`}>
      <button className="coach-row-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="coach-row-title">{rec.title}</span>
        {impact && <span className="coach-row-impact mono">{impact}</span>}
        <span className="coach-row-chev" aria-hidden="true">{open ? "–" : "+"}</span>
      </button>
      {/* Grid-rows(0fr→1fr) collapses to true zero height with no measured-height
          JS — .coach-row-body stays mounted so the accordion animates smoothly
          both ways instead of popping open/shut. */}
      <div className="coach-row-collapse" aria-hidden={!open}>
        <div className="coach-row-body">
          <p className="coach-evidence">{rec.evidenceLine}</p>
          {rec.action && <p className="coach-action">{rec.action}</p>}
          {rec.installTarget && (
            <code className="coach-install mono">{rec.installTarget.command}</code>
          )}
          <div className="coach-row-meta mono">
            {rec.confidence === "early" && <span className="coach-badge">early read</span>}
            {rec.whyHref && <a className="coach-why" href={rec.whyHref}>why →</a>}
          </div>
        </div>
      </div>
    </div>
  );
}

function DashCard({ m }: { m: CoachModule }) {
  return (
    <div className={`coach-card${m.locked ? " locked" : ""}`}>
      <div className="coach-card-label mono">{m.label}</div>
      {m.locked ? (
        <a className="coach-card-unlock mono" href="#coach-consent">unlock with deep mode →</a>
      ) : (
        <>
          <div className="coach-card-value">{m.value}</div>
          {m.benchmark && <div className="coach-card-bench mono">{m.benchmark}</div>}
          {m.tip && <div className="coach-card-tip">{m.tip}</div>}
        </>
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <section className="coach">
      <div className="coach-header"><span className="coach-label mono">GET MORE FROM YOUR SPEND</span></div>
      <div className="sk-block" style={{ height: 132, marginTop: 0 }} aria-busy="true" />
      <div className="coach-grid">
        <div className="sk-block" style={{ height: 96 }} aria-busy="true" />
        <div className="sk-block" style={{ height: 96 }} aria-busy="true" />
        <div className="sk-block" style={{ height: 96 }} aria-busy="true" />
      </div>
    </section>
  );
}

export function CoachSection({ login, refreshKey = 0 }: { login: string; refreshKey?: number }) {
  const state = useProfileCoach(login, refreshKey);
  if (state.status === "loading") return <Skeleton />;
  if (state.status === "error") return null;               // transient: render nothing, no scary error
  const coach = state.coach;
  if ("locked" in coach && coach.locked) return null;      // no consent / forging → section absent
  const payload = coach as CoachPayload;
  if (payload.recommendations.length === 0 && payload.modules.length === 0) return null;

  return (
    <section className="coach">
      <div className="coach-header">
        <span className="coach-label mono">GET MORE FROM YOUR SPEND</span>
        {payload.isOwner && payload.recommendations.length > 0 && (
          <span className="coach-headline mono">{headline(payload.recommendations)}</span>
        )}
      </div>

      {payload.recommendations.length > 0 && (
        <div className="coach-feed">
          {payload.recommendations.map((r) => <FeedRow key={r.id} rec={r} />)}
        </div>
      )}

      {payload.modules.length > 0 && (
        <div className="coach-grid">
          {payload.modules.map((m) => <DashCard key={m.id} m={m} />)}
        </div>
      )}

      {!payload.cohort.calibrated && (
        <p className="coach-foot mono">Benchmarks compare you to your own history until the cohort reaches 30 developers.</p>
      )}
    </section>
  );
}
