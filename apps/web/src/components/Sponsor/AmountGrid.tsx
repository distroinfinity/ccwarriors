import { TIERS } from "../../sponsorTiers";

/** 6 tier cards, 3×2 (2-col on mobile). Shows ₹ when the Razorpay tab is active. */
export function AmountGrid({
  tierIdx,
  setTierIdx,
  showInr,
}: {
  tierIdx: number;
  setTierIdx: (i: number) => void;
  showInr: boolean;
}) {
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
          <span className="amt-emoji" aria-hidden>
            {t.emoji}
          </span>
          <span className="amt-name">{t.name}</span>
          <span className="amt-val mono">{showInr ? `₹${t.inr.toLocaleString("en-IN")}` : `$${t.usd}`}</span>
          <span className="amt-copy">{t.copy}</span>
        </button>
      ))}
    </div>
  );
}
