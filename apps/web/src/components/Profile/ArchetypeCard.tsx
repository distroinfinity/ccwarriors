import { useCallback, useEffect, useRef, useState } from "react";
import { getFontEmbedCSS, toPng } from "html-to-image";
import { API_HTTP } from "../../api";
import type { Profile, ProfileInsights, ProfilePillars, LockedInsights } from "../../useProfile";
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

const PILLAR_ORDER = ["direction", "verification", "autonomy", "yield", "orchestration", "throughput"] as const;
const PILLAR_LABEL: Record<(typeof PILLAR_ORDER)[number], string> = {
  direction: "DIRECTION",
  verification: "VERIFICATION",
  autonomy: "AUTONOMY",
  yield: "YIELD",
  orchestration: "ORCHESTRATION",
  throughput: "THROUGHPUT",
};

// A response has the Craft Score headline only when the server sent a numeric
// craftScore + pillars (deep insights, modern server). Otherwise fall back to
// the legacy archetype + axes hero.
function hasCraftScore(
  insights: ProfileInsights,
): insights is ProfileInsights & { craftScore: number; pillars: ProfilePillars } {
  return typeof insights.craftScore === "number" && insights.pillars != null;
}

function PillarBars({ pillars }: { pillars: ProfilePillars }) {
  // Sorted by score: terracotta intensity steps down the ranking (Paper Dossier).
  const sorted = [...PILLAR_ORDER].sort((a, b) => pillars[b] - pillars[a]);
  return (
    <div className="axes mono">
      {sorted.map((pillar, i) => (
        <div className="axis" key={pillar}>
          <span className="axis-k pillar-k">{PILLAR_LABEL[pillar]}</span>
          <span className="axis-track">
            <span className={`axis-fill f${Math.min(i, 2)}`} style={{ width: `${pillars[pillar]}%` }} />
          </span>
          <b className="axis-v">{Math.round(pillars[pillar])}</b>
        </div>
      ))}
    </div>
  );
}

function CraftScoreHero({
  insights,
  archetype,
}: {
  insights: ProfileInsights & { craftScore: number; pillars: ProfilePillars };
  archetype: string;
}) {
  const tier1 = insights.trustTier === 1;
  return (
    <div className="craft">
      <div className="craft-top">
        <div className="craft-num-wrap">
          <span className="craft-label mono">CRAFT SCORE</span>
          <span className="craft-score mono">{Math.round(insights.craftScore)}</span>
        </div>
        <div className="craft-badges">
          <span className={`trust-badge mono${tier1 ? " t1" : " t0"}`}>
            {tier1 && <PixelGlyph name="check" size={9} />}
            {tier1 ? "LOCAL-GIT VERIFIED" : "UNVERIFIED"}
          </span>
          {insights.provisional && (
            <span className="provisional-chip mono">provisional · ranks once the legion grows</span>
          )}
        </div>
      </div>
      <div className="craft-flavor">
        plays as <b>THE {archetype.toUpperCase().replace(/^THE\s+/, "")}</b>
      </div>
      <PillarBars pillars={insights.pillars} />
      <div className="axis-note">
        {insights.scoresArePercentiles
          ? `calibrated against ${insights.population} warriors`
          : "calibrated craft. percentiles unlock as the legion grows"}
      </div>
    </div>
  );
}

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

// Consent is on but no insights have landed yet — the archetype is produced
// out of band by the CLI's next sync, so we poll and swap the card in live
// instead of leaving the owner on a dead "appears later" message.
function PendingPanel({ onPoll }: { onPoll: () => void }) {
  const [copied, setCopied] = useState(false);
  const [stalled, setStalled] = useState(false);

  useEffect(() => {
    // Poll every 6s; after ~20 tries (no daemon, or the user never synced)
    // back off to a manual "check now" so we don't poll an idle tab forever.
    let tries = 0;
    const id = setInterval(() => {
      tries += 1;
      if (tries > 20) {
        setStalled(true);
        clearInterval(id);
        return;
      }
      onPoll();
    }, 6000);
    return () => clearInterval(id);
  }, [onPoll]);

  const copy = () => {
    void navigator.clipboard?.writeText("ccwarriors insights on");
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="arch-locked pending">
      <span className="arch-pulse" aria-hidden="true" />
      <p className="arch-pending-h">Forging your archetype…</p>
      <p>
        Your next sync forges this from local session counts. Autosync usually lands it within minutes,
        and this page updates itself the moment it does. To see it in seconds, run:
      </p>
      <div className="arch-skip">
        <code className="mono">ccwarriors insights on</code>
        <button className="linklike" onClick={copy}>
          {copied ? "copied" : "copy"}
        </button>
      </div>
      {stalled && (
        <button className="linklike" onClick={onPoll}>
          Check now
        </button>
      )}
    </div>
  );
}

// The exact, honest field list for what Deep mode uploads. One tight line each.
// Reused verbatim by the locked chooser (the ask) and the unlocked transparency
// block (the receipt) so the promise and the proof can never drift apart.
const DEEP_UPLOADS: Array<{ k: string; v: string }> = [
  { k: "Per-session counts", v: "prompts, tool calls, plan-mode turns" },
  { k: "Timing summaries", v: "session length, active hours, gaps" },
  { k: "Model names", v: "which models you ran, nothing about the chats" },
  { k: "Hashed git outcomes", v: "commits, lines, tests as salted hashes" },
];
const DEEP_NEVER = "Never your prompts, code, file paths, or repo names.";

export function DisclosureList() {
  return (
    <ul className="consent-disclose">
      {DEEP_UPLOADS.map(({ k, v }) => (
        <li key={k}>
          <b>{k}</b>
          <span>{v}</span>
        </li>
      ))}
      <li className="consent-never">{DEEP_NEVER}</li>
    </ul>
  );
}

function LockedPanel({ profile, onConsentChanged }: { profile: Profile; onConsentChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = profile.insights as LockedInsights;
  const isOwner = !!profile.owner;

  const goAllIn = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`${API_HTTP}/insights/mode`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "deep" }),
      });
      if (!r.ok) {
        setError("Could not switch on Deep mode. Try again after refreshing your session.");
        return;
      }
      onConsentChanged();
    } catch {
      setError("Could not switch on Deep mode. Check your connection and try again.");
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

  // Owner already consented but no data has landed yet: processing, not idle.
  if (isOwner && profile.owner?.consent) {
    return <PendingPanel onPoll={onConsentChanged} />;
  }

  if (!isOwner) {
    return (
      <div className="arch-locked">
        <PixelGlyph name="diamond" size={13} />
        <p>This warrior has not revealed their archetype. Yours could be live in a minute: run the install command and `ccwarriors insights on`.</p>
      </div>
    );
  }

  // Owner, mode off, no consent — the honest binary choice.
  return (
    <div className="arch-locked consent-choice">
      <div className="consent-opt consent-stay">
        <div className="consent-opt-h mono">STAY PRIVATE</div>
        <p>Keep everything local. We only ever see your spend, never your sessions. This is where you are now.</p>
      </div>

      <div className="consent-opt consent-allin">
        <div className="consent-opt-h mono">GO ALL-IN</div>
        <p>Reveal your Craft Score and archetype. Here is exactly what Deep mode uploads, nothing hidden:</p>
        <DisclosureList />
        <p className="consent-purgenote">Purge anytime. One click deletes all of it.</p>
        <button className="btn x" onClick={goAllIn} disabled={busy}>
          {busy ? "Switching on Deep…" : "Reveal my Craft Score"}
        </button>
        {error && <p className="arch-error">{error}</p>}
      </div>
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
    let text: string;
    if (hasCraftScore(insights)) {
      const top = [...PILLAR_ORDER].sort((a, b) => insights.pillars[b] - insights.pillars[a])[0] ?? "verification";
      const topBit = `top pillar ${PILLAR_LABEL[top].charAt(0) + PILLAR_LABEL[top].slice(1).toLowerCase()} ${Math.round(insights.pillars[top])}`;
      text = `Craft Score ${Math.round(insights.craftScore)} on @ccwarriorsxyz · ${topBit}. What's yours?`;
    } else {
      const top = [...AXIS_ORDER].sort((a, b) => insights.axes[b] - insights.axes[a]).slice(0, 2);
      const axisBit = top.map((a) => `${AXIS_LABEL[a].toLowerCase()} ${insights.axes[a]}`).join(" · ");
      text = `I'm ${insights.archetype.toUpperCase()} on @ccwarriorsxyz. ${axisBit}. What class are you?`;
    }
    const url = `https://ccwarriors.xyz/${encodeURIComponent(profile.login)}?ref=x_share`;
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
      a.download = `ccwarriors-${profile.login}-${insights && hasCraftScore(insights) ? "craft-score" : "archetype"}.png`;
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
          hasCraftScore(insights) ? (
            <CraftScoreHero insights={insights} archetype={insights.archetype} />
          ) : (
            <>
              <div className="arch-name">{insights.archetype.toUpperCase()}</div>
              <div className="arch-trait">
                {insights.trait ? `${insights.trait} · ` : ""}
                {insights.growthEdge}
              </div>
              <AxisBars insights={insights} />
            </>
          )
        ) : (
          <LockedPanel profile={profile} onConsentChanged={onConsentChanged} />
        )}

        <div className="arch-foot mono">
          <span>ccwarriors.xyz/{profile.login}</span>
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
    </div>
  );
}
