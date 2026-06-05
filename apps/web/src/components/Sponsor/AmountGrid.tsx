import { CUSTOM_COPY, CUSTOM_TIER, MAX_CUSTOM_USD, MIN_CUSTOM_USD, TIERS } from "../../sponsorTiers";
import { TierGlyph } from "./TierGlyph";

/** 6 tier cards + a custom-amount cell. Everything reads in USD; the INR
 *  conversion happens only when an order is sent to Razorpay. */
export function AmountGrid({
  tierIdx,
  setTierIdx,
  customUsd,
  setCustomUsd,
}: {
  tierIdx: number;
  setTierIdx: (i: number) => void;
  customUsd: string;
  setCustomUsd: (v: string) => void;
}) {
  const customOn = tierIdx === CUSTOM_TIER;
  return (
    <div className="amtgrid" role="radiogroup" aria-label="Donation amount">
      {TIERS.map((t, i) => (
        <button
          key={t.name}
          role="radio"
          aria-checked={i === tierIdx}
          className={`amtbtn${i === tierIdx ? " on" : ""}`}
          onClick={() => setTierIdx(i)}
        >
          <TierGlyph tier={t.glyph} />
          <span className="amt-name">{t.name}</span>
          <span className="amt-val mono">${t.usd}</span>
          <span className="amt-copy">{t.copy}</span>
        </button>
      ))}
      <div
        role="radio"
        aria-checked={customOn}
        tabIndex={0}
        className={`amtbtn amt-custom${customOn ? " on" : ""}`}
        onClick={() => setTierIdx(CUSTOM_TIER)}
        onKeyDown={(e) => e.key === "Enter" && setTierIdx(CUSTOM_TIER)}
      >
        <TierGlyph tier="custom" />
        <span className="amt-name">Custom</span>
        <span className="amt-val mono">
          $
          <input
            className="amt-input mono"
            type="number"
            inputMode="numeric"
            min={MIN_CUSTOM_USD}
            max={MAX_CUSTOM_USD}
            placeholder="64"
            value={customUsd}
            onFocus={() => setTierIdx(CUSTOM_TIER)}
            onChange={(e) => setCustomUsd(e.target.value)}
            aria-label="Custom amount in dollars"
          />
        </span>
        <span className="amt-copy">{CUSTOM_COPY}</span>
      </div>
    </div>
  );
}
