import { useRef, useState } from "react";
import { getFontEmbedCSS, toPng } from "html-to-image";
import type { InsightCard } from "../../useProfile";
import { Halftone } from "./Halftone";

// A single collectible "wrapped" card: halftone band seeded by its key, the
// question as a label, a bold headline, a muted body, an optional accent stat.
// The whole card is the capture target; the share affordances live in a footer
// flagged data-noexport so the exported PNG reads clean.
function DeckCard({ card, login }: { card: InsightCard; login: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);

  const shareOnX = () => {
    const url = `https://ccwarriors.xyz/${encodeURIComponent(login)}?ref=x_share`;
    window.open(
      `https://x.com/intent/tweet?text=${encodeURIComponent(card.shareText)}&url=${encodeURIComponent(url)}`,
      "_blank",
      "noopener",
    );
  };

  const download = async () => {
    if (!ref.current || exporting) return;
    setExporting(true);
    try {
      const fontEmbedCSS = await getFontEmbedCSS(ref.current);
      const dataUrl = await toPng(ref.current, {
        pixelRatio: 4,
        cacheBust: true,
        fontEmbedCSS,
        // Drop the share footer from the captured image so the card is clean.
        filter: (node) => !(node instanceof HTMLElement && node.dataset.noexport === "true"),
      });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `ccwarriors-${login}-${card.key}.png`;
      a.click();
    } catch (err) {
      console.error("card export failed", err);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="deck-card" ref={ref}>
      <div className="deck-band">
        <Halftone seed={card.key} />
        {card.stat && <span className="deck-stat mono">{card.stat}</span>}
      </div>
      <div className="deck-body">
        <div className="deck-q mono">{card.question}</div>
        <div className="deck-head">{card.headline}</div>
        <p className="deck-text">{card.body}</p>
      </div>
      <div className="deck-foot mono" data-noexport="true">
        <button className="deck-share" onClick={shareOnX} aria-label="Share on X">
          share on X
        </button>
        <button className="deck-dl" onClick={download} disabled={exporting} aria-label="Download card">
          {exporting ? "saving" : "save png"}
        </button>
      </div>
    </div>
  );
}

export function InsightCards({ cards, login }: { cards: InsightCard[]; login: string }) {
  if (!cards || cards.length === 0) return null;
  return (
    <section className="deck">
      <div className="deck-header">
        <span className="deck-label mono">YOUR BUILD PROFILE</span>
        <a
          className="deck-credit mono"
          href="https://paxel.ycombinator.com"
          target="_blank"
          rel="noopener"
        >
          extended from YC Paxel
        </a>
      </div>
      <div className="deck-grid">
        {cards.map((card) => (
          <DeckCard key={card.key} card={card} login={login} />
        ))}
      </div>
    </section>
  );
}
