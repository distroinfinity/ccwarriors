// The coach's "why" explainer. Every advisor whyHref points at an anchor here.
// This is where the `published` provenance facts physically live (the evidence
// discipline requires the citation to be reachable).
const SECTIONS: Array<{ id: string; title: string; body: string; source: string }> = [
  { id: "cache", title: "Cache-read ratio", body: "Cache reads are billed at ~10% of fresh input tokens. The estimated opportunity is the fresh-input spend you could shift into cache, hedged and labeled “if avoidable” — a low ratio can be legitimate fresh work.", source: "Anthropic prompt-caching pricing (cache-read = 0.1× input rate)." },
  { id: "waste", title: "Revert ratio", body: "Reverted-within-14-days lines divided by lines you added. Leads with your own ratio; a peer number appears only once the cohort reaches 30 developers.", source: "14-day churn window follows the code-churn research standard (GitClear / Faros)." },
  { id: "roi", title: "Cost per surviving line", body: "Your full window spend divided by lines that survived 14 days, plus a $/merged-PR proxy (commits landed on a remote branch, labeled estimated).", source: "Own measured git outcomes; PR figure is a proxy, not true merge state." },
  { id: "task-fit", title: "Tool / model fit", body: "Surviving lines per dollar, compared only among your own tools and models within the same kind of commit (fixes / features / refactors). Never an absolute “X beats Y” — only what wins for you.", source: "Your own sessions; fires only with two comparable groups." },
  { id: "skill-fit", title: "Skill fit", body: "Compares your sessions that used a skill against those that did not, on the same outcome. The catalog suggestion (“try systematic-debugging”) is grounded in the skill’s documented purpose and marked an early read.", source: "Own data; TDD→lower defect density is an established software-engineering finding." },
  { id: "behavior", title: "Behavior", body: "Surviving lines per dollar for your plan-mode sessions versus your non-plan sessions, with how often you use plan mode.", source: "Your own sessions, within-user." },
];

export function HelpCoach() {
  return (
    <div className="help-coach">
      <a className="how-back" href="/">← Back to the board</a>
      <h1>How the coach reads your spend</h1>
      <p className="help-lede">Every number is one of: your own measured data, a cohort aggregate (only at 30+ developers), or a published fact. Nothing is an invented threshold.</p>
      {SECTIONS.map((s) => (
        <section key={s.id} id={s.id} className="help-section">
          <h2>{s.title}</h2>
          <p>{s.body}</p>
          <p className="help-source mono">Source: {s.source}</p>
        </section>
      ))}
    </div>
  );
}
