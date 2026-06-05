import { useState } from "react";
import { DEFAULT_TIER, tierAt } from "../../sponsorTiers";
import { AmountGrid } from "./AmountGrid";
import { GithubSponsorButton } from "./GithubSponsorButton";
import { RazorpayButton } from "./RazorpayButton";
import { CHAINS, CryptoPanel } from "./CryptoPanel";
import { SponsorsWall } from "./SponsorsWall";

type Method = "github" | "razorpay" | "crypto";
type Frequency = "once" | "monthly";

const METHODS: { key: Method; label: string }[] = [
  { key: "razorpay", label: "UPI / Card" },
  { key: "crypto", label: "Crypto" },
  // GitHub Sponsors hidden until the profile passes KYC — see issue #9.
  // { key: "github", label: "GitHub Sponsors" },
];

/** "Fuel the board" — the funding section between the main content and the footer. */
export function Sponsor() {
  const [tierIdx, setTierIdx] = useState(DEFAULT_TIER);
  const [frequency, setFrequency] = useState<Frequency>("once");
  const [method, setMethod] = useState<Method>("razorpay");
  // Bumped after a successful Razorpay donation so the wall refetches.
  const [wallSeq, setWallSeq] = useState(0);

  const methods = CHAINS.length > 0 ? METHODS : METHODS.filter((m) => m.key !== "crypto");

  return (
    <section className="sponsor" id="sponsor">
      <div className="seclabel">Fuel the board</div>
      <p className="sponsor-p">
        CCWarriors is free and open source. Servers aren't. Back the board and claim your tier,{" "}
        <span className="o">{tierAt(tierIdx).copy}</span>.
      </p>

      <AmountGrid tierIdx={tierIdx} setTierIdx={setTierIdx} showInr={method === "razorpay"} />

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
          <RazorpayButton tierIdx={tierIdx} onPaid={() => setWallSeq((s) => s + 1)} />
        )}
        {method === "crypto" && <CryptoPanel />}
      </div>

      <SponsorsWall refreshKey={wallSeq} />
    </section>
  );
}
