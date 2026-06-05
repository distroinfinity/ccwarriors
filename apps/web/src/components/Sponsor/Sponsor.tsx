import { useState } from "react";
import {
  CUSTOM_COPY,
  CUSTOM_TIER,
  DEFAULT_TIER,
  MAX_CUSTOM_USD,
  MIN_CUSTOM_USD,
  tierAt,
} from "../../sponsorTiers";
import { AmountGrid } from "./AmountGrid";
import { GithubSponsorButton } from "./GithubSponsorButton";
import { RazorpayButton } from "./RazorpayButton";
import { CHAINS, CryptoPanel } from "./CryptoPanel";
import { SponsorsWall } from "./SponsorsWall";
import { detectOrg } from "../../orgs";

type Method = "github" | "razorpay" | "crypto";
type Frequency = "once" | "monthly";

// Org pages can flip the ordering (NS is a crypto-first crowd); the apex
// stays Card/UPI first.
const CRYPTO_FIRST = detectOrg()?.payments === "crypto-first";

const METHODS: { key: Method; label: string }[] = [
  { key: "razorpay", label: "Card / UPI" },
  { key: "crypto", label: "Crypto" },
  // GitHub Sponsors hidden until the profile passes KYC — see issue #9.
  // { key: "github", label: "GitHub Sponsors" },
];
if (CRYPTO_FIRST) METHODS.reverse();

/** "Fuel the board" — the funding section between the main content and the footer. */
export function Sponsor() {
  const [tierIdx, setTierIdx] = useState(DEFAULT_TIER);
  const [customUsd, setCustomUsd] = useState("");
  const [frequency, setFrequency] = useState<Frequency>("once");
  const [method, setMethod] = useState<Method>(
    CRYPTO_FIRST && CHAINS.length > 0 ? "crypto" : "razorpay",
  );
  // Bumped after a successful Razorpay donation so the wall refetches.
  const [wallSeq, setWallSeq] = useState(0);

  const methods = CHAINS.length > 0 ? METHODS : METHODS.filter((m) => m.key !== "crypto");

  // Selected amount in USD; null while the custom cell is empty/invalid.
  const isCustom = tierIdx === CUSTOM_TIER;
  const parsed = Math.floor(Number(customUsd));
  const usd = isCustom
    ? Number.isFinite(parsed) && parsed >= MIN_CUSTOM_USD && parsed <= MAX_CUSTOM_USD
      ? parsed
      : null
    : tierAt(tierIdx).usd;
  const copy = isCustom ? CUSTOM_COPY : tierAt(tierIdx).copy;

  return (
    <section className="sponsor" id="sponsor">
      <div className="seclabel">Fuel the board</div>
      <p className="sponsor-p">
        CCWarriors is free and open source. Servers aren't. Back the board and claim your tier,{" "}
        <span className="o">{copy}</span>.
      </p>

      <AmountGrid
        tierIdx={tierIdx}
        setTierIdx={setTierIdx}
        customUsd={customUsd}
        setCustomUsd={setCustomUsd}
      />

      <div className="sponsor-row">
        <div className="ostabs">
          {methods.map((m) => (
            <button
              key={m.key}
              className={method === m.key ? "on" : ""}
              onClick={() => setMethod(m.key)}
            >
              {m.label}
            </button>
          ))}
        </div>
        {method === "github" && (
          <div className="seg seg-sm">
            {(["once", "monthly"] as Frequency[]).map((f) => (
              <button
                key={f}
                className={frequency === f ? "on" : ""}
                onClick={() => setFrequency(f)}
              >
                {f === "once" ? "One-time" : "Monthly"}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="sponsor-action">
        {method === "github" && <GithubSponsorButton tierIdx={tierIdx} frequency={frequency} />}
        {method === "razorpay" && (
          <RazorpayButton usd={usd} desc={copy} onPaid={() => setWallSeq((s) => s + 1)} />
        )}
        {method === "crypto" && <CryptoPanel />}
      </div>

      <SponsorsWall refreshKey={wallSeq} />
    </section>
  );
}
