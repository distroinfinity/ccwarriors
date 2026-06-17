import { useCallback, useState } from "react";
import { useProfile } from "../../useProfile";
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

function ProfileSkeleton() {
  return <div className="profile-skel" aria-busy="true" />;
}

export function ProfilePage({ login }: { login: string }) {
  // Bump after consent changes (and on each pending poll) so the page refetches.
  const [refreshKey, setRefreshKey] = useState(0);
  const refetch = useCallback(() => setRefreshKey((k) => k + 1), []);
  const state = useProfile(login, refreshKey);

  if (state.status === "loading") return <ProfileSkeleton />;
  if (state.status === "notfound") return <NotFound login={login} />;
  const p = state.profile;
  document.title = `${p.login} · CCWarriors`;
  // The insight deck only exists once insights are unlocked; the Habits stats
  // it absorbed are now individual cards inside it.
  const cards = !p.insights.locked ? p.insights.cards : [];
  const hasStory = cards.some((c) => c.key === "story");

  return (
    <div className="profile">
      <ArchetypeCard profile={p} onConsentChanged={refetch} />
      <InsightCards
        cards={cards}
        login={p.login}
        isOwner={!!p.owner}
        pinnedCards={!p.insights.locked ? (p.insights.pinnedCards ?? []) : []}
        onPinsChanged={refetch}
        sampleSessions={!p.insights.locked ? p.insights.sampleSessions : undefined}
        windowDays={!p.insights.locked ? p.insights.windowDays : undefined}
        featuredKeys={!p.insights.locked ? p.insights.featuredCardKeys : undefined}
        deckMonth={!p.insights.locked ? p.insights.deckMonth : undefined}
      />
      <ByTheNumbers profile={p} />
      <RhythmPanel profile={p} />
      <StoryCloser login={p.login} hasStory={hasStory} />
      <OwnerControls profile={p} onConsentChanged={refetch} />
    </div>
  );
}
