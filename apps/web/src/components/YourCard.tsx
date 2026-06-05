import { useRef, useState } from "react";
import { getFontEmbedCSS, toPng } from "html-to-image";
import { API_HTTP } from "../api";
import type { Entry } from "../types";
import { ClawdLogo } from "./ClawdLogo";
import { CardScene } from "./CardScene";
import { InstallBlock } from "./InstallBlock";
import { ToolGlyph } from "./ToolGlyph";
import { formatUsd, tierLabel } from "../util";
import { TickerValue } from "./TickerValue";
import type { WebOrg } from "../orgs";

/** Discord verify CTA — shown to signed-in visitors not yet on the org board. */
function VerifyNudge({ org }: { org: WebOrg }) {
  return (
    <div className="nudge verify" role="status">
      <span className="nudge-glyph">◈</span>
      <span>
        {org.name} member? Verify with Discord to join the board.
        <a className="verifybtn" href={`${API_HTTP}/orgs/${org.slug}/verify/start`}>
          Verify with Discord →
        </a>
      </span>
    </div>
  );
}

/** Shown in the side panel when the viewer has no card to display yet. */
export function EnlistCard({ org, verifyOrg }: { org?: WebOrg | null; verifyOrg?: WebOrg | null }) {
  return (
    <aside className="side">
      <div className="seclabel">Your card</div>
      <div className="enlist">
        <ClawdLogo className="empty-clawd" />
        <h3>{org ? `Enlist to join the ${org.name} board.` : "Enlist to pull your card."}</h3>
        <InstallBlock />
        {/* verifyOrg implies an existing GitHub session — the sign-in link is noise then. */}
        {!verifyOrg && (
          <a className="ghsign" href={`${API_HTTP}/auth/web${org ? `?org=${org.slug}` : ""}`}>
            Already enlisted? Sign in with GitHub →
          </a>
        )}
      </div>
      {verifyOrg && <VerifyNudge org={verifyOrg} />}
    </aside>
  );
}

/** Per-tool spend rows inside the card — top 4, biggest first. Renders
    nothing for entries without a breakdown (old server / legacy client). */
function ToolBreakdownRows({ entry }: { entry: Entry }) {
  const parts = Object.entries(entry.breakdown ?? {})
    .filter((kv): kv is [string, number] => typeof kv[1] === "number" && kv[1] > 0)
    .sort((a, b) => b[1] - a[1]);
  if (parts.length < 2) return null; // single-tool: the big number already says it
  return (
    <div className="cbreak">
      {parts.slice(0, 4).map(([tool, cost]) => (
        <div className="cbrow" key={tool}>
          <ToolGlyph tool={tool} />
          <span className="cbk">{tool}</span>
          <span className="cbv mono">{formatUsd(cost)}</span>
        </div>
      ))}
    </div>
  );
}

export function YourCard({
  entry,
  rank,
  outdatedClient,
  underReview,
  verifyOrg,
  onLocate,
}: {
  entry: Entry;
  rank: number;
  /** True when this user's CLI still syncs Claude-only data (pre-multi-tool). */
  outdatedClient?: boolean;
  /** True while plausibility flags keep this user off the boards. */
  underReview?: boolean;
  /** Set on org pages when the viewer hasn't verified membership yet. */
  verifyOrg?: WebOrg | null;
  /** Scrolls the leaderboard to this warrior's row. */
  onLocate?: () => void;
}) {
  const [portraitFailed, setPortraitFailed] = useState(false);
  const [exporting, setExporting] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const monogram = (entry.githubLogin[0] ?? "?").toUpperCase();

  const shareOnX = () => {
    // Whole dollars in the tweet — "$1,234.00 burned" reads like machine output.
    const burned = "$" + Math.round(entry.cost30d).toLocaleString("en-US");
    const text = `${burned} burned across my AI coding tools in the last 30 days 🔥\nrank #${rank} · ${tierLabel(entry.tier)} tier ⚔️\n\ncheck your rank now:`;
    const url = "https://ccwarriors.xyz";
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
      // Embed the webfonts (Geist/Geist Mono) so the export doesn't fall back to
      // system fonts, and render at 4x for a crisp ~1330px-wide card.
      const fontEmbedCSS = await getFontEmbedCSS(cardRef.current);
      const dataUrl = await toPng(cardRef.current, {
        pixelRatio: 4,
        cacheBust: true,
        fontEmbedCSS,
      });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `ccwarriors-${entry.githubLogin}.png`;
      a.click();
    } catch (err) {
      console.error("card export failed", err);
      alert("Export failed — try again (avatar image may still be loading).");
    } finally {
      setExporting(false);
    }
  };

  return (
    <aside className="side">
      <div className="seclabel">Your card</div>
      <div className="card" ref={cardRef}>
        <div className="edge" />
        <div className="cc">
          <div className="b">
            <ClawdLogo />
            <span>CCWARRIORS</span>
          </div>
          <div className="r">RANK #{rank}</div>
        </div>
        <div className="cart">
          <CardScene scene={entry.cardScene} />
          {!entry.avatarUrl || portraitFailed ? (
            <div className="pf">{monogram}</div>
          ) : (
            <img
              className="pf"
              src={entry.avatarUrl}
              alt={entry.githubLogin}
              crossOrigin="anonymous"
              onError={() => setPortraitFailed(true)}
            />
          )}
          <div className="sc" />
        </div>
        <div className="cm">
          <div>
            <div className="n">{entry.githubLogin}</div>
            <div className="h">@{entry.xHandle ?? entry.githubLogin}</div>
          </div>
          <div className="t">{tierLabel(entry.tier)}</div>
        </div>
        <div className="cs">
          <div className="bn mono">
            {/* Live tick on screen; the PNG export must capture the confirmed
                value, so snap to it (and drop the flash) while exporting. */}
            {exporting ? (
              formatUsd(entry.cost30d)
            ) : (
              <TickerValue target={entry.cost30d} durationMs={4000} format={formatUsd} />
            )}
            <small>30D</small>
          </div>
          {/* all-time hidden — local logs only go back ~30 days (see Leaderboard note) */}
        </div>
        <ToolBreakdownRows entry={entry} />
        <div className="cfo">
          <span>ccwarriors.xyz</span>
          <span>RANK #{rank}</span>
        </div>
      </div>
      {/* Nudges live OUTSIDE cardRef so they never leak into the PNG export. */}
      {verifyOrg && <VerifyNudge org={verifyOrg} />}
      {underReview && (
        <div className="nudge review" role="status">
          <span className="nudge-glyph">⚖</span>
          Your stats are under review — they'll return to the board once cleared.
        </div>
      )}
      {!underReview && outdatedClient && (
        <div className="nudge" role="status">
          <span className="nudge-glyph">⟳</span>
          Tracking Claude Code only. Re-run the install command to count all your AI tools.
        </div>
      )}
      <button className="btn x" onClick={shareOnX}>
        Share on X
      </button>
      <button className="btn g" onClick={downloadCard} disabled={exporting}>
        {exporting ? "Exporting…" : "Download card"}
      </button>
      {onLocate && (
        <button className="btn g" onClick={onLocate}>
          Find me on the board ↓
        </button>
      )}
    </aside>
  );
}
