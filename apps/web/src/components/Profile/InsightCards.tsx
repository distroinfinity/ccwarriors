import { useRef, useState } from "react";
import { getFontEmbedCSS, toPng } from "html-to-image";
import { API_HTTP } from "../../api";
import type { InsightCard } from "../../useProfile";
import { Halftone } from "./Halftone";

// A single collectible "wrapped" card: halftone band seeded by its key, the
// question as a label, a bold headline, a muted body, an optional accent stat.
// The whole card is the capture target; the share affordances live in a footer
// flagged data-noexport so the exported PNG reads clean.
function DeckCard({
  card,
  login,
  pinned,
  onTogglePin,
}: {
  card: InsightCard;
  login: string;
  // undefined = visitor (no pin affordance); boolean = owner edit mode.
  pinned?: boolean;
  onTogglePin?: () => void;
}) {
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

  // The story teaser is a doorway, not a stat — the whole card links to the
  // dossier page instead of carrying share/export chrome.
  if (card.key === "story") {
    return (
      <a className="deck-card deck-card-story" href={`/${encodeURIComponent(login)}/story`}>
        <div className="deck-corner" aria-hidden="true">
          <Halftone seed={card.key} />
        </div>
        <div className="deck-body">
          <div className="deck-q mono">{card.question}</div>
          <div className="deck-head">{card.headline}</div>
          <p className="deck-text">{card.body}…</p>
        </div>
        <div className="deck-foot mono">
          <span className="deck-share">read the full story →</span>
        </div>
      </a>
    );
  }

  return (
    <div className="deck-card" ref={ref}>
      {/* Texture retreats to a masked corner — never behind text. */}
      <div className="deck-corner" aria-hidden="true">
        <Halftone seed={card.key} />
      </div>
      {pinned !== undefined && (
        <button
          className={`deck-pin mono${pinned ? " on" : ""}`}
          onClick={onTogglePin}
          data-noexport="true"
          aria-label={pinned ? "Unpin card" : "Pin card"}
          title={pinned ? "Unpin from the top of your deck" : "Pin to the top of your deck (max 4)"}
        >
          {pinned ? "⚲ pinned" : "⚲ pin"}
        </button>
      )}
      <div className="deck-body">
        <div className="deck-q mono">{card.question}</div>
        {card.stat && (
          <span className="deck-plate mono" aria-hidden="true">
            {card.stat}
          </span>
        )}
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

export function InsightCards({
  cards,
  loading = false,
  login,
  isOwner = false,
  pinnedCards = [],
  onPinsChanged,
  sampleSessions,
  windowDays,
  featuredKeys,
  deckMonth,
}: {
  cards: InsightCard[];
  loading?: boolean;
  login: string;
  isOwner?: boolean;
  pinnedCards?: string[];
  onPinsChanged?: () => void;
  sampleSessions?: number;
  windowDays?: number;
  featuredKeys?: string[];
  deckMonth?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);
  if (loading) {
    return (
      <section className="deck">
        <div className="deck-header">
          <span className="deck-label mono">THIS MONTH</span>
        </div>
        <div className="deck-grid">
          <div className="sk-block sk-deck" style={{ marginTop: 0 }} aria-busy="true" />
          <div className="sk-block sk-deck" style={{ marginTop: 0 }} aria-busy="true" />
          <div className="sk-block sk-deck" style={{ marginTop: 0 }} aria-busy="true" />
        </div>
        <p className="deck-provenance mono"><span className="sk-block" style={{ width: 180, height: 11, display: "inline-block" }} aria-busy="true" /></p>
      </section>
    );
  }
  if (!cards || cards.length === 0) return null;

  // Default view: this month's featured subset. Fall back to all cards when the
  // server did not send a featured set (older server).
  const featured = featuredKeys && featuredKeys.length > 0
    ? cards.filter((c) => featuredKeys.includes(c.key))
    : cards;
  const visible = showAll ? cards : featured;
  const hiddenCount = cards.length - featured.length;
  const monthLabel = deckMonth
    ? new Date(`${deckMonth}-01T00:00:00Z`).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })
    : null;

  const togglePin = async (key: string) => {
    if (busy) return;
    const next = pinnedCards.includes(key)
      ? pinnedCards.filter((k) => k !== key)
      : [...pinnedCards, key].slice(0, 4); // server caps at 4 too
    setBusy(true);
    try {
      const r = await fetch(`${API_HTTP}/insights/pins`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pins: next }),
      });
      if (r.ok) onPinsChanged?.();
    } catch {
      /* leave the deck as-is */
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="deck">
      <div className="deck-header">
        <span className="deck-label mono">THIS MONTH</span>
        {monthLabel && <span className="deck-month mono">{monthLabel} · refreshes monthly</span>}
        <a className="deck-credit mono" href="https://paxel.ycombinator.com" target="_blank" rel="noopener">
          extended from YC Paxel
        </a>
      </div>
      <div className="deck-grid">
        {visible.map((card) => (
          <DeckCard
            key={card.key}
            card={card}
            login={login}
            pinned={isOwner && card.key !== "story" ? pinnedCards.includes(card.key) : undefined}
            onTogglePin={isOwner ? () => void togglePin(card.key) : undefined}
          />
        ))}
      </div>
      {!showAll && hiddenCount > 0 && (
        <button className="deck-seeall mono" onClick={() => setShowAll(true)}>
          see all {cards.length} cards →
        </button>
      )}
      {showAll && hiddenCount > 0 && (
        <button className="deck-seeall mono" onClick={() => setShowAll(false)}>
          show less
        </button>
      )}
      {(sampleSessions || windowDays) && (
        <p className="deck-provenance mono">
          {sampleSessions ? `from ${sampleSessions} sessions` : ""}
          {sampleSessions && windowDays ? " · " : ""}
          {windowDays ? `last ${windowDays} days` : ""}
        </p>
      )}
    </section>
  );
}
