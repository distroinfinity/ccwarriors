import { useEffect, useState } from "react";
import { API_HTTP } from "../../api";

// The story page (#50): the LLM-derived narrative as an editorial dossier.
// Long-form text gets its own page — narrow measure, big type, no card grid.

// Mirror of the server's StoryDoc (apps/server/src/db/schema.ts), which is the
// source of truth. The web and server are separate packages with no shared
// types module, so keep this in sync by hand when the server type changes.
export interface StoryDoc {
  tagline?: string;
  narrative: string;
  arc?: string;
  whatYouBuilt: string;
  decisionPatterns: Array<{ name: string; count: number; evidence: string }>;
  strengths: Array<{ title: string; detail: string }>;
  growthAreas: Array<{ title: string; detail: string }>;
  aiArchetypes: Array<{ name: string; blurb: string; evidence: number }>;
  crypticPrompt: string | null;
  sessionsAnalyzed: number;
  windowDays?: number;
}

interface StoryResponse {
  login: string;
  avatarUrl: string;
  story: StoryDoc;
  generatedAt: string;
}

type StoryState =
  | { status: "loading" }
  | { status: "notfound" }
  | { status: "ready"; data: StoryResponse };

export function StoryPage({ login }: { login: string }) {
  const [state, setState] = useState<StoryState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_HTTP}/profile/${encodeURIComponent(login)}/story`, { credentials: "include" })
      .then(async (r) => {
        if (cancelled) return;
        if (!r.ok) return setState({ status: "notfound" });
        setState({ status: "ready", data: (await r.json()) as StoryResponse });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "notfound" });
      });
    return () => {
      cancelled = true;
    };
  }, [login]);

  if (state.status === "loading") return <div className="profile-skel" aria-busy="true" />;

  if (state.status === "notfound") {
    return (
      <div className="story story-empty">
        <p className="story-kicker mono">FIELD REPORT</p>
        <h1 className="story-h px">No story yet</h1>
        <p className="story-lede">
          {login}'s story forges from their next deep sync. If this is your profile, run{" "}
          <code className="mono">ccwarriors insights on</code> and come back in a minute.
        </p>
        <a className="how-back" href={`/${encodeURIComponent(login)}`}>← Back to profile</a>
      </div>
    );
  }

  const { story, generatedAt, avatarUrl } = state.data;
  document.title = `${state.data.login} · Story · CCWarriors`;
  const day = new Date(generatedAt).toISOString().slice(0, 10);

  return (
    <article className="story">
      <header className="story-head">
        <p className="story-kicker mono">FIELD REPORT · {story.sessionsAnalyzed} SESSIONS{story.windowDays != null ? ` · LAST ${story.windowDays} DAYS` : ""} · {day}</p>
        <div className="story-id">
          {avatarUrl && <img className="story-avatar" src={avatarUrl} alt={state.data.login} />}
          <h1 className="story-h px">{state.data.login.toUpperCase()}</h1>
        </div>
        <p className="story-lede">{story.tagline && story.tagline.trim() ? story.tagline : story.narrative}</p>
      </header>

      <section className="story-sec">
        <h2 className="seclabel">The developer behind the tools</h2>
        <p className="story-body">{story.narrative}</p>
      </section>

      {(story.decisionPatterns.length > 0 || story.aiArchetypes.length > 0) && (
        <section className="story-sec">
          <h2 className="seclabel">How you think with AI</h2>
          {story.decisionPatterns.length > 0 && (
            <ol className="story-patterns">
              {story.decisionPatterns.map((p) => (
                <li key={p.name}>
                  <span className="pattern-count mono">×{p.count}</span>
                  <div>
                    <b className="pattern-name">{p.name}</b>
                    <p className="story-body">{p.evidence}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
          {story.aiArchetypes.length > 0 && (
            <div className="story-stamps">
              {story.aiArchetypes.map((a) => (
                <div className="story-stamp" key={a.name}>
                  <span className="px stamp-name">{a.name.toUpperCase()}</span>
                  <span className="mono stamp-evidence">{a.evidence} signals</span>
                  <p className="story-body">{a.blurb}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <div className="story-cols">
        {story.strengths.length > 0 && (
          <section className="story-sec">
            <h2 className="seclabel">Strengths</h2>
            {story.strengths.map((s) => (
              <div className="story-item" key={s.title}>
                <b>{s.title}</b>
                <p className="story-body">{s.detail}</p>
              </div>
            ))}
          </section>
        )}
        {story.growthAreas.length > 0 && (
          <section className="story-sec">
            <h2 className="seclabel">Growth edges</h2>
            {story.growthAreas.map((g) => (
              <div className="story-item" key={g.title}>
                <b>{g.title}</b>
                <p className="story-body">{g.detail}</p>
              </div>
            ))}
          </section>
        )}
      </div>

      {story.arc && story.arc.trim().length > 0 && (
        <section className="story-sec">
          <h2 className="seclabel">The arc</h2>
          <p className="story-arc">{story.arc}</p>
        </section>
      )}

      {story.crypticPrompt && (
        <section className="story-sec story-cryptic">
          <h2 className="seclabel">In your own words</h2>
          <blockquote className="mono">“{story.crypticPrompt}”</blockquote>
          <p className="story-body">Somehow the agent knew exactly what you meant.</p>
        </section>
      )}

      {story.whatYouBuilt && story.whatYouBuilt.trim().length > 0 && (
        <section className="story-built">
          <span className="story-built-l mono">Lately working on</span>
          <p className="story-body">{story.whatYouBuilt}</p>
        </section>
      )}

      <footer className="story-foot mono">
        <a className="how-back" href={`/${encodeURIComponent(state.data.login)}`}>← Back to profile</a>
        <span>derived from your sessions · transcripts deleted after analysis</span>
      </footer>
    </article>
  );
}
