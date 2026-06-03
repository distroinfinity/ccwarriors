import { useState } from "react";
import type { Entry } from "../types";
import { ClawdLogo } from "./ClawdLogo";
import { CardScene } from "./CardScene";
import { formatUsd, tierLabel } from "../util";

export function YourCard({ entry, rank }: { entry: Entry; rank: number }) {
  const [portraitFailed, setPortraitFailed] = useState(false);
  const monogram = (entry.githubLogin[0] ?? "?").toUpperCase();

  const shareOnX = () => {
    const text = `I'm ranked #${rank} on @CCWarriors, burning ${formatUsd(
      entry.cost30d,
    )} of Claude Code tokens this month. ${tierLabel(entry.tier)} tier. Outburn me.`;
    const url = `https://ccwarriors.xyz/u/${entry.githubLogin}`;
    window.open(
      `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
      "_blank",
      "noopener",
    );
  };

  const downloadCard = () => {
    alert("PNG export is coming soon. For now, screenshot your card or share it on X.");
  };

  return (
    <aside className="side">
      <div className="seclabel">Your card</div>
      <div className="card">
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
              onError={() => setPortraitFailed(true)}
            />
          )}
          <div className="sc" />
        </div>
        <div className="cm">
          <div>
            <div className="n">{entry.githubLogin}</div>
            <div className="h">{entry.xHandle ? "@" + entry.xHandle : "—"}</div>
          </div>
          <div className="t">{tierLabel(entry.tier)}</div>
        </div>
        <div className="cs">
          <div className="bn mono">
            {formatUsd(entry.cost30d)}
            <small>30D</small>
          </div>
          <div className="at">all time · {formatUsd(entry.costAllTime)}</div>
        </div>
        <div className="cfo">
          <span>ccwarriors.xyz</span>
          <span>RANK #{rank}</span>
        </div>
      </div>
      <button className="btn x" onClick={shareOnX}>
        Share on X
      </button>
      <button className="btn g" onClick={downloadCard}>
        Download card
      </button>
    </aside>
  );
}
