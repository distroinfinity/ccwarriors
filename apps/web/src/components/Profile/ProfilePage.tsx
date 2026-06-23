import { useCallback, useEffect, useState } from "react";
import { useProfile, useProfileInsights, type Profile, type ProfileInsights, type LockedInsights } from "../../useProfile";
import { ClawdLogo } from "../ClawdLogo";
import { InstallBlock } from "../InstallBlock";
import { ArchetypeCard } from "./ArchetypeCard";
import { InsightCards } from "./InsightCards";
import { RhythmPanel } from "./RhythmPanel";
import { OwnerControls } from "./OwnerControls";
import { ByTheNumbers } from "./ByTheNumbers";
import { StoryCloser } from "./StoryCloser";

function NotFound({ login }: { login: string }) {
  return (
    <div className="profile-404">
      <ClawdLogo className="empty-clawd" />
      <h2>No warrior named {login}.</h2>
      <p>Maybe a typo. Or maybe they have not enlisted yet. You can:</p>
      <InstallBlock />
      <a className="how-back" href="/">← Back to the board</a>
    </div>
  );
}

// Structured skeleton shown only while the (fast) core call is in flight.
function ProfileSkeleton() {
  return (
    <div className="profile" aria-busy="true">
      <div className="sk-block sk-mast" />
      <div className="sk-block sk-section" />
      <div className="sk-block sk-deck" />
    </div>
  );
}

// Type-filler used while insights are loading or errored. Never shown as a real
// consent state: ArchetypeCard intercepts the loading and error flags before
// reading insights, and the other sections treat a locked value as
// "no data → render nothing".
const PLACEHOLDER_INSIGHTS: LockedInsights = { locked: true, reason: "no_consent" };

export function ProfilePage({ login }: { login: string }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const refetch = useCallback(() => setRefreshKey((k) => k + 1), []);
  const core = useProfile(login, refreshKey);
  const insightsState = useProfileInsights(login, refreshKey);

  const title = core.status === "ready" ? `${core.profile.login} · CCWarriors` : null;
  useEffect(() => {
    if (title) document.title = title;
  }, [title]);

  if (core.status === "loading") return <ProfileSkeleton />;
  if (core.status === "notfound") return <NotFound login={login} />;

  const insightsLoading = insightsState.status === "loading";
  const insightsError = insightsState.status === "error";
  const insights: ProfileInsights | LockedInsights =
    insightsState.status === "ready" ? insightsState.insights : PLACEHOLDER_INSIGHTS;
  const p: Profile = { ...core.profile, insights };

  const cards = !p.insights.locked ? p.insights.cards : [];
  const hasStory = cards.some((c) => c.key === "story");

  return (
    <div className="profile">
      <ArchetypeCard profile={p} insightsLoading={insightsLoading} insightsError={insightsError} onConsentChanged={refetch} />
      <ByTheNumbers profile={p} insightsLoading={insightsLoading} />
      <InsightCards
        cards={cards}
        loading={insightsLoading}
        login={p.login}
        isOwner={!!p.owner}
        pinnedCards={!p.insights.locked ? (p.insights.pinnedCards ?? []) : []}
        onPinsChanged={refetch}
        sampleSessions={!p.insights.locked ? p.insights.sampleSessions : undefined}
        windowDays={!p.insights.locked ? p.insights.windowDays : undefined}
        featuredKeys={!p.insights.locked ? p.insights.featuredCardKeys : undefined}
        deckMonth={!p.insights.locked ? p.insights.deckMonth : undefined}
      />
      <RhythmPanel profile={p} />
      <StoryCloser login={p.login} hasStory={hasStory} />
      <OwnerControls profile={p} onConsentChanged={refetch} />
    </div>
  );
}
