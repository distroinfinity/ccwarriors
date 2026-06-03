import { useRef, useState } from "react";
import { getFontEmbedCSS, toPng } from "html-to-image";
import { API_HTTP } from "../api";
import type { Entry } from "../types";
import { ClawdLogo } from "./ClawdLogo";
import { CardScene } from "./CardScene";
import { InstallBlock } from "./InstallBlock";
import { formatUsd, tierLabel } from "../util";

/** Shown in the side panel when the viewer has no card to display yet. */
export function EnlistCard() {
  return (
    <aside className="side">
      <div className="seclabel">Your card</div>
      <div className="enlist">
        <ClawdLogo className="empty-clawd" />
        <h3>Enlist to pull your card.</h3>
        <InstallBlock />
        <a className="ghsign" href={`${API_HTTP}/auth/web`}>
          Already enlisted? Sign in with GitHub →
        </a>
      </div>
    </aside>
  );
}

export function YourCard({ entry, rank }: { entry: Entry; rank: number }) {
  const [portraitFailed, setPortraitFailed] = useState(false);
  const [exporting, setExporting] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const monogram = (entry.githubLogin[0] ?? "?").toUpperCase();

  const shareOnX = () => {
    const text = `${formatUsd(entry.cost30d)} burned on Claude Code in the last 30 days 🔥\nrank #${rank} · ${tierLabel(entry.tier)} tier ⚔️\n\n@claudeai devs — check your rank now:`;
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
            {formatUsd(entry.cost30d)}
            <small>30D</small>
          </div>
          {/* all-time hidden — local logs only go back ~30 days (see Leaderboard note) */}
        </div>
        <div className="cfo">
          <span>ccwarriors.xyz</span>
          <span>RANK #{rank}</span>
        </div>
      </div>
      <button className="btn x" onClick={shareOnX}>
        Share on X
      </button>
      <button className="btn g" onClick={downloadCard} disabled={exporting}>
        {exporting ? "Exporting…" : "Download card"}
      </button>
    </aside>
  );
}
