import { useState } from "react";
import { DEFAULT_TIER, EVM_ADDRESS, tierAt } from "../../sponsorTiers";
import { AmountGrid } from "./AmountGrid";
import { GithubSponsorButton } from "./GithubSponsorButton";
import { RazorpayButton } from "./RazorpayButton";
import { CryptoPanel } from "./CryptoPanel";
import { SponsorsWall } from "./SponsorsWall";

type Method = "github" | "razorpay" | "crypto";
type Frequency = "once" | "monthly";

const METHODS: { key: Method; label: string }[] = [
  { key: "github", label: "GitHub Sponsors" },
  { key: "razorpay", label: "UPI / Card (India)" },
  { key: "crypto", label: "Crypto" },
];

/** "Fuel the board" — the funding section between the main content and the footer. */
export function Sponsor() {
  const [tierIdx, setTierIdx] = useState(DEFAULT_TIER);
  const [frequency, setFrequency] = useState<Frequency>("once");
  const [method, setMethod] = useState<Method>("github");
  // Bumped after a successful Razorpay donation so the wall refetches.
  const [wallSeq, setWallSeq] = useState(0);

  const methods = EVM_ADDRESS ? METHODS : METHODS.filter((m) => m.key !== "crypto");

  return (
    <section className="sponsor" id="sponsor">
      <div className="seclabel">Fuel the board</div>
      <div className="sponsor-head">
        <h2 className="sponsor-h">
          Keep the tokens <span className="o">burning</span>
        </h2>
        <p className="sponsor-p">
          CCWarriors is free and open source. Servers aren't. Back the board and claim your tier —{" "}
          {tierAt(tierIdx).copy}.
        </p>
      </div>

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
