import type { Profile } from "../../useProfile";
export function ArchetypeCard({ profile }: { profile: Profile; onConsentChanged?: () => void }) {
  return <div className="panel">{profile.login}</div>;
}
