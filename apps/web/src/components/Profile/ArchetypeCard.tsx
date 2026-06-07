import { useRef, useState } from "react";
import { getFontEmbedCSS, toPng } from "html-to-image";
import { API_HTTP } from "../../api";
import type { Profile, ProfileInsights, LockedInsights } from "../../useProfile";
import { ClawdLogo } from "../ClawdLogo";
import { PixelGlyph } from "../PixelGlyph";
import { tierLabel } from "../../util";

const AXIS_ORDER = ["summoning", "steering", "velocity", "autonomy", "planning"] as const;
const AXIS_LABEL: Record<(typeof AXIS_ORDER)[number], string> = {
  summoning: "SUMMONING",
  steering: "STEERING",
  velocity: "VELOCITY",
  autonomy: "AUTONOMY",
  planning: "PLANNING",
};

function AxisBars({ insights }: { insights: ProfileInsights }) {
  // Sorted by score: terracotta intensity steps down the ranking (Paper Dossier).
  const sorted = [...AXIS_ORDER].sort((a, b) => insights.axes[b] - insights.axes[a]);
  return (
    <div className="axes mono">
      {sorted.map((axis, i) => (
        <div className="axis" key={axis}>
          <span className="axis-k">{AXIS_LABEL[axis]}</span>
          <span className="axis-track">
            <span className={`axis-fill f${Math.min(i, 2)}`} style={{ width: `${insights.axes[axis]}%` }} />
          </span>
          <b className="axis-v">{insights.axes[axis]}</b>
        </div>
      ))}
      <div className="axis-note">
        {insights.scoresArePercentiles
          ? `percentile among ${insights.population} warriors`
          : "calibrated scores. percentiles unlock as the legion grows"}
      </div>
    </div>
  );
}

function LockedPanel({ profile, onConsentChanged }: { profile: Profile; onConsentChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const locked = profile.insights as LockedInsights;
  const isOwner = !!profile.owner;

  const unlock = async () => {
    setBusy(true);
    try {
      const r = await fetch(`${API_HTTP}/insights/consent`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ consent: true }),
      });
      if (r.ok) onConsentChanged();
    } finally {
      setBusy(false);
    }
  };

  if (locked.reason === "forging") {
    return (
      <div className="arch-locked">
        <PixelGlyph name="diamond" size={13} />
        <p>Archetype forging. Under 10 sessions in the window so far. Keep coding.</p>
      </div>
    );
  }

  // no_consent (default)
  return (
    <div className="arch-locked">
      <PixelGlyph name="diamond" size={13} />
      {isOwner ? (
        <>
          <p>Your archetype is locked. Unlock reads aggregate counts from your local sessions. Transcripts never leave your machine.</p>
          <button className="btn x" onClick={unlock} disabled={busy}>
            {busy ? "Unlocking…" : "Unlock your archetype"}
          </button>
          <p className="arch-hint">Appears after your next sync. Run ccwarriors sync to skip the wait.</p>
        </>
      ) : (
        <p>This warrior has not revealed their archetype. Yours could be live in a minute: run the install command and `ccwarriors insights on`.</p>
      )}
    </div>
  );
}

export function ArchetypeCard({ profile, onConsentChanged }: { profile: Profile; onConsentChanged: () => void }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const unlocked = !profile.insights.locked;
  const insights = unlocked ? (profile.insights as ProfileInsights) : null;

  const shareOnX = () => {
    if (!insights) return;
    const top = [...AXIS_ORDER].sort((a, b) => insights.axes[b] - insights.axes[a]).slice(0, 2);
    const axisBit = top.map((a) => `${AXIS_LABEL[a].toLowerCase()} ${insights.axes[a]}`).join(" · ");
    const text = `I'm ${insights.archetype.toUpperCase()} on @ccwarriorsxyz. ${axisBit}. What class are you?`;
    const url = `https://ccwarriors.xyz/u/${encodeURIComponent(profile.login)}?ref=x_share`;
    window.open(
      `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
      "_blank",
      "noopener",
    );
  };

  const downloadCard = async () => {
    if (!cardRef.current || exporting) return;
    setExporting(true);
    try {
      const fontEmbedCSS = await getFontEmbedCSS(cardRef.current);
      const dataUrl = await toPng(cardRef.current, { pixelRatio: 4, cacheBust: true, fontEmbedCSS });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `ccwarriors-${profile.login}-archetype.png`;
      a.click();
    } catch (err) {
      console.error("card export failed", err);
      alert("Export failed. Try again once the avatar finishes loading.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="arch-wrap">
      <div className="arch-card" ref={cardRef}>
        <div className="arch-head">
          <div className="arch-id">
            <img className="arch-avatar" src={profile.avatarUrl} alt={profile.login} crossOrigin="anonymous" />
            <div>
              <div className="arch-login">{profile.login}</div>
              <div className="arch-rank mono">
                {profile.underReview ? "rank —" : profile.rank30d ? `rank #${profile.rank30d}` : "unranked"} &middot;{" "}
                <span className="arch-tier">{tierLabel(profile.tier)}</span>
              </div>
            </div>
          </div>
          <div className="arch-brand">
            <ClawdLogo />
          </div>
        </div>

        {insights ? (
          <>
            <div className="arch-name">{insights.archetype.toUpperCase()}</div>
            <div className="arch-trait">
              {insights.trait ? `${insights.trait} · ` : ""}
              {insights.growthEdge}
            </div>
            <AxisBars insights={insights} />
          </>
        ) : (
          <LockedPanel profile={profile} onConsentChanged={onConsentChanged} />
        )}

        <div className="arch-foot mono">
          <span>ccwarriors.xyz/u/{profile.login}</span>
          <span>extended from YC paxel</span>
        </div>
      </div>

      {insights && (
        <div className="arch-actions">
          <button className="btn x" onClick={shareOnX}>Share on X</button>
          <button className="btn g" onClick={downloadCard} disabled={exporting}>
            {exporting ? "Exporting…" : "Download card"}
          </button>
        </div>
      )}
      {profile.owner?.consent && (
        <div className="arch-owner mono">
          insights on &middot; {profile.owner.machineCount} machine{profile.owner.machineCount === 1 ? "" : "s"} &middot;{" "}
          <button
            className="linklike"
            onClick={async () => {
              const next = profile.owner!.visibility === "public" ? "private" : "public";
              await fetch(`${API_HTTP}/insights/consent`, {
                method: "POST",
                credentials: "include",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ visibility: next }),
              });
              onConsentChanged();
            }}
          >
            make {profile.owner.visibility === "public" ? "private" : "public"}
          </button>
        </div>
      )}
    </div>
  );
}
