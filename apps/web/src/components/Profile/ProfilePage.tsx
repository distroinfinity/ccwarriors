import { useState } from "react";
import { useProfile } from "../../useProfile";
import { ClawdLogo } from "../ClawdLogo";
import { InstallBlock } from "../InstallBlock";
import { ArchetypeCard } from "./ArchetypeCard";
import { HabitsPanel } from "./HabitsPanel";
import { EfficiencyPanel } from "./EfficiencyPanel";
import { RhythmPanel } from "./RhythmPanel";

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
  // Bump after consent changes so the page refetches with the new state.
  const [refreshKey, setRefreshKey] = useState(0);
  const state = useProfile(login, refreshKey);

  if (state.status === "loading") return <ProfileSkeleton />;
  if (state.status === "notfound") return <NotFound login={login} />;
  const p = state.profile;
  document.title = `${p.login} · CCWarriors`;

  return (
    <div className="profile">
      <div className="profile-grid">
        <ArchetypeCard profile={p} onConsentChanged={() => setRefreshKey((k) => k + 1)} />
        <div className="profile-side">
          <HabitsPanel profile={p} />
          <EfficiencyPanel profile={p} />
        </div>
      </div>
      <RhythmPanel profile={p} />
    </div>
  );
}
