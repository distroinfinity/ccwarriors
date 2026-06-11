import { useState } from "react";
import { API_HTTP } from "../../api";
import type { Profile } from "../../useProfile";
import { DisclosureList } from "./ArchetypeCard";

// Pre-v2 deep users: one disclosed click unlocks the story tier. The CLI
// adopts the ack from the server on its next sync — nothing to run.
function UpgradeBanner({ onConsentChanged }: { onConsentChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unlock = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`${API_HTTP}/insights/consent`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ consentVersion: 2 }),
      });
      if (!r.ok) {
        setError("Could not unlock. Refresh your session and try again.");
        return;
      }
      onConsentChanged();
    } catch {
      setError("Could not unlock. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="consent-upgrade">
      <div className="consent-upgrade-text">
        <b>Deep mode grew: your story is waiting.</b>
        <p>
          One more yes adds two things to what we extract: your most-repeated short prompts, and redacted
          transcripts that write your story page (analyzed once, then deleted). Secrets are stripped on your
          machine before anything leaves it. Your next sync picks this up automatically.
        </p>
      </div>
      <button className="btn x" onClick={unlock} disabled={busy}>
        {busy ? "Unlocking…" : "Unlock my story"}
      </button>
      {error && <p className="arch-error">{error}</p>}
    </div>
  );
}

export function OwnerControls({ profile, onConsentChanged }: { profile: Profile; onConsentChanged: () => void }) {
  const [visibilityBusy, setVisibilityBusy] = useState(false);
  const [visibilityError, setVisibilityError] = useState<string | null>(null);
  const [showStored, setShowStored] = useState(false);
  const [purgeArmed, setPurgeArmed] = useState(false);
  const [purgeBusy, setPurgeBusy] = useState(false);
  const [purgeError, setPurgeError] = useState<string | null>(null);

  if (!profile.owner || profile.owner.mode !== "deep") return null;

  const toggleVisibility = async () => {
    if (visibilityBusy) return;
    const next = profile.owner!.visibility === "public" ? "private" : "public";
    setVisibilityBusy(true);
    setVisibilityError(null);
    try {
      const r = await fetch(`${API_HTTP}/insights/consent`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ visibility: next }),
      });
      if (!r.ok) {
        setVisibilityError("Visibility update failed.");
        return;
      }
      onConsentChanged();
    } catch {
      setVisibilityError("Visibility update failed.");
    } finally {
      setVisibilityBusy(false);
    }
  };

  const purge = async () => {
    if (!purgeArmed) {
      setPurgeArmed(true);
      return;
    }
    setPurgeBusy(true);
    setPurgeError(null);
    try {
      const r = await fetch(`${API_HTTP}/insights/mode`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "off" }),
      });
      if (!r.ok) {
        setPurgeError("Purge failed. Try again.");
        return;
      }
      setPurgeArmed(false);
      onConsentChanged();
    } catch {
      setPurgeError("Purge failed. Check your connection and try again.");
    } finally {
      setPurgeBusy(false);
    }
  };

  const isPublic = profile.owner.visibility === "public";
  const needsV2 = (profile.owner.consentVersion ?? 1) < 2;
  return (
    <div className="owner-controls">
      {needsV2 && <UpgradeBanner onConsentChanged={onConsentChanged} />}
      <div className="arch-transparency">
        <div className="trans-status mono">
          Profile: <b className={isPublic ? "vis-public" : "vis-private"}>{isPublic ? "Public" : "Private"}</b>
          {" "}&middot; deep insights on &middot; {profile.owner.machineCount} machine
          {profile.owner.machineCount === 1 ? "" : "s"}
        </div>

        <button
          className="linklike trans-toggle"
          onClick={() => setShowStored((s) => !s)}
          aria-expanded={showStored}
        >
          {showStored ? "Hide what we store" : "What we store"}
        </button>
        {showStored && <DisclosureList />}

        <div className="trans-actions">
          <span className="trans-vis mono">
            {isPublic
              ? "Anyone can see this profile and its stats."
              : "Only you can see these stats. You stay on the leaderboard."}{" "}
            <button className="linklike" onClick={toggleVisibility} disabled={visibilityBusy}>
              {visibilityBusy ? "updating" : `make ${isPublic ? "private" : "public"}`}
            </button>
          </span>
          {visibilityError ? <span className="arch-error">{visibilityError}</span> : null}
        </div>

        <div className="purge">
          {purgeArmed ? (
            <span className="purge-confirm mono">
              This deletes everything we have computed and stops collecting. Sure?{" "}
              <button className="linklike purge-go" onClick={purge} disabled={purgeBusy}>
                {purgeBusy ? "purging…" : "yes, purge it all"}
              </button>{" "}
              <button
                className="linklike"
                onClick={() => {
                  setPurgeArmed(false);
                  setPurgeError(null);
                }}
                disabled={purgeBusy}
              >
                cancel
              </button>
            </span>
          ) : (
            <button className="linklike purge-start" onClick={purge}>
              Purge all my insights data
            </button>
          )}
          {purgeError ? <span className="arch-error"> · {purgeError}</span> : null}
        </div>
      </div>
    </div>
  );
}
