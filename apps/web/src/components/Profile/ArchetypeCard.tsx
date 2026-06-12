import { useCallback, useEffect, useRef, useState } from "react";
import { getFontEmbedCSS, toPng } from "html-to-image";
import { API_HTTP } from "../../api";
import type { Profile, ProfileInsights, ProfilePillars, LockedInsights } from "../../useProfile";
import { ClawdLogo } from "../ClawdLogo";
import { PixelGlyph } from "../PixelGlyph";
import { tierLabel, formatUsd, formatTokens } from "../../util";

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

// Plain-language pillar explanations (#58). kind: outcome pillars are measured
// against real git results; behavioral pillars from how sessions are run.
const PILLAR_INFO: Record<(typeof PILLAR_ORDER)[number], { weight: string; kind: "outcome" | "behavioral"; tip: string }> = {
  verification: { weight: "22%", kind: "outcome", tip: "Do long runs survive? Tests touched in shipping sessions, and how little of your work gets reverted." },
  yield: { weight: "22%", kind: "outcome", tip: "Verified output per dollar. Surviving lines and commits against your spend." },
  direction: { weight: "16%", kind: "behavioral", tip: "Do your instructions land? Crisp mid-length specs, and sessions that explore the code before shipping." },
  autonomy: { weight: "16%", kind: "behavioral", tip: "How long the agent runs unsupervised, counted only when that work survives." },
  orchestration: { weight: "12%", kind: "behavioral", tip: "Parallel subagents and model range that lead to shipped work, not just spawns." },
  throughput: { weight: "12%", kind: "outcome", tip: "Sustained shipping pace. Surviving lines and commits per active day." },
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
      {sorted.map((pillar, i) => {
        const info = PILLAR_INFO[pillar];
        return (
          // Hover or keyboard-focus a row to reveal what the pillar measures (#58).
          <div className="axis pillar-row" key={pillar} tabIndex={0}>
            <span className="axis-k pillar-k">{PILLAR_LABEL[pillar]}</span>
            <span className="axis-track">
              <span className={`axis-fill f${Math.min(i, 2)}`} style={{ width: `${pillars[pillar]}%` }} />
            </span>
            <b className="axis-v">{Math.round(pillars[pillar])}</b>
            <span className="pillar-tip" role="tooltip">
              <span className="pillar-tip-head">
                <b>{PILLAR_LABEL[pillar]}</b>
                <span className="pillar-tip-meta">{info.weight} of score · {info.kind}</span>
              </span>
              {info.tip}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// "How the Craft Score works" — the plain-language expander (#58).
function CraftExplainer() {
  const [open, setOpen] = useState(false);
  return (
    <div className="craft-explain" data-noexport="true">
      <button className="linklike" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? "Hide how the score works" : "How the Craft Score works"}
      </button>
      {open && (
        <div className="craft-explain-body">
          <p>
            Craft Score is a weighted mean of six pillars: <b>Verification</b> and <b>Yield</b> carry 22% each,{" "}
            <b>Direction</b> and <b>Autonomy</b> 16%, <b>Orchestration</b> and <b>Throughput</b> 12%. A spiky
            profile pulls the score down, so being elite at one pillar can't hide weak ones.
          </p>
          <p>
            Outcome pillars (Verification, Yield, Throughput) are measured against your real git results:
            commits, surviving lines, tests, reverts. Behavioral pillars (Direction, Autonomy, Orchestration)
            come from how you run your sessions. Hover any bar for what it measures.
          </p>
          <p>
            <b>LOCAL-GIT VERIFIED</b> means the outcomes come from real commits on your machine (uploaded as
            counts and salted hashes, never code). <b>GITHUB-LINKED</b> means your public GitHub activity
            corroborates the same window.
          </p>
        </div>
      )}
    </div>
  );
}

// Small-sample marker: scores are real but not yet rank-stable. Shown while
// the sample is under 10 sessions (the percentile-pool floor).
function EarlyReadBadge({ insights }: { insights: ProfileInsights }) {
  const n = insights.sampleSessions;
  if (!insights.provisional || typeof n !== "number" || n >= 10) return null;
  return (
    <span
      className="trust-badge early mono"
      title="Fewer than 10 sessions — scores are real but not yet rank-stable; this profile is not in the percentile pool yet."
    >
      EARLY READ · {n} SESSION{n === 1 ? "" : "S"}
    </span>
  );
}

// Calibrated badge: enough sessions to be meaningful, but percentile ranking
// hasn't activated yet (consented population below the minimum threshold).
function CalibratedBadge({ insights }: { insights: ProfileInsights }) {
  const n = insights.sampleSessions;
  if (insights.scoresArePercentiles || typeof n !== "number" || n < 10) return null;
  return (
    <span
      className="trust-badge early mono"
      title="Scores use fixed calibration anchors — percentile ranking activates once the consented population reaches 30."
    >
      CALIBRATED
    </span>
  );
}

// Persistent provenance line: shows the session count and window behind scores.
function ProvenanceLine({ insights }: { insights: ProfileInsights }) {
  const n = insights.sampleSessions;
  const w = insights.windowDays;
  if (!n && !w) return null;
  const parts: string[] = [];
  if (n) parts.push(`${n} session${n === 1 ? "" : "s"}`);
  if (w) parts.push(`last ${w} days`);
  return (
    <p className="craft-provenance mono">based on {parts.join(" over the ")}</p>
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
  const tier = insights.craftTier;
  return (
    <div className="craft">
      <div className="craft-top">
        <div className="craft-num-wrap">
          <span className="craft-label mono">CRAFT SCORE</span>
          <span className={`craft-score mono${tier ? ` tier-${tier.key}` : ""}`}>
            {Math.round(insights.craftScore)}
          </span>
          {tier && <span className={`craft-tier px tier-${tier.key}`}>{tier.name.toUpperCase()}</span>}
        </div>
        <div className="craft-badges">
          <span className={`trust-badge mono${tier1 ? " t1" : " t0"}`}>
            {tier1 && <PixelGlyph name="check" size={9} />}
            {tier1 ? "LOCAL-GIT VERIFIED" : "UNVERIFIED"}
          </span>
          {insights.githubVerified && (
            <span className="trust-badge t1 mono">
              <PixelGlyph name="check" size={9} />
              GITHUB-LINKED
            </span>
          )}
          <EarlyReadBadge insights={insights} />
          <CalibratedBadge insights={insights} />
        </div>
      </div>
      <div className="craft-flavor">
        plays as <b>THE {archetype.toUpperCase().replace(/^THE\s+/, "")}</b>
      </div>
      <PillarBars pillars={insights.pillars} />
      <ProvenanceLine insights={insights} />
      <CraftExplainer />
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
      <p className="arch-pending-h">Building your profile…</p>
      <p>
        Your first sync fills this in from your local sessions — usually within minutes, and this page
        updates itself the moment it lands. To see it in seconds, run:
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
  { k: "Model names", v: "which models you ran" },
  { k: "Hashed git outcomes", v: "commits, lines, tests as salted hashes" },
  { k: "Your top prompts", v: "the short prompts you repeat most, secrets stripped" },
  { k: "Redacted transcripts", v: "power your story page — analyzed once, then deleted" },
];
const DEEP_NEVER =
  "Never your code, file contents, file paths, or repo names. Secrets are stripped on your machine before anything leaves it.";

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
      // One call: deep on + the v2 disclosure acknowledged (the list above IS
      // the full v2 disclosure). The CLI adopts this ack on its next sync.
      const r = await fetch(`${API_HTTP}/insights/consent`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ consent: true, consentVersion: 2 }),
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

  // "forging" now means exactly one thing: consented, but no data has landed
  // yet. The pending panel polls and swaps the card in live the moment the
  // first sync arrives. (Old servers still emit forging for <10 sessions
  // during the deploy window — polling degrades gracefully there too.)
  if (locked.reason === "forging") {
    return <PendingPanel onPoll={onConsentChanged} />;
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
      const dataUrl = await toPng(cardRef.current, {
        pixelRatio: 4,
        cacheBust: true,
        fontEmbedCSS,
        // Keep interactive chrome (explainer, tooltips) out of the share image.
        filter: (node) => !(node instanceof HTMLElement && node.dataset.noexport === "true"),
      });
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
                {!profile.underReview && profile.costAllTime > 0 && (
                  <span>
                    {" "}&middot;{" "}
                    {formatUsd(Math.round(profile.costAllTime))} all&#8209;time
                    {profile.rankAllTime ? ` (#${profile.rankAllTime})` : ""}
                  </span>
                )}
              </div>
              {profile.tokensAllTime != null && profile.tokensAllTime > 0 && (
                <div className="arch-rank mono" style={{ marginTop: 1 }}>
                  {formatTokens(profile.tokensAllTime)} tokens since enlisting
                </div>
              )}
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
              <EarlyReadBadge insights={insights} />
              <CalibratedBadge insights={insights} />
              <AxisBars insights={insights} />
              <ProvenanceLine insights={insights} />
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
          {insights.cards.some((c) => c.key === "story") && (
            <a className="btn story-btn" href={`/${encodeURIComponent(profile.login)}/story`}>
              Read your story →
            </a>
          )}
        </div>
      )}
    </div>
  );
}
