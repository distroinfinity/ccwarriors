import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { EVM_ADDRESS, SOL_ADDRESS } from "../../sponsorTiers";

interface Chain {
  key: string;
  label: string;
  hint: string;
  address: string;
}

// Chains with no configured address drop out; the whole tab is hidden by
// Sponsor.tsx when this list is empty.
export const CHAINS: Chain[] = [
  { key: "evm", label: "ETH / EVM", hint: "ETH or any EVM chain", address: EVM_ADDRESS },
  { key: "sol", label: "Solana", hint: "Solana mainnet", address: SOL_ADDRESS },
].filter((c) => c.address);

/** Self-custody wallets + QR, one chain at a time. The QR sits on a white card
 *  so it scans in dark mode. */
export function CryptoPanel() {
  const [chainIdx, setChainIdx] = useState(0);
  const [qr, setQr] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const chain = useMemo(() => CHAINS[chainIdx] ?? CHAINS[0], [chainIdx]);

  useEffect(() => {
    if (!chain) return;
    QRCode.toString(chain.address, { type: "svg", margin: 1, width: 132 })
      .then(setQr)
      .catch(() => setQr(""));
  }, [chain]);

  if (!chain) return null;

  const copy = () => {
    navigator.clipboard?.writeText(chain.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="crypto">
      {qr && <div className="qr" dangerouslySetInnerHTML={{ __html: qr }} />}
      <div className="crypto-meta">
        {CHAINS.length > 1 && (
          <div className="seg seg-sm crypto-seg">
            {CHAINS.map((c, i) => (
              <button
                key={c.key}
                className={i === chainIdx ? "on" : ""}
                onClick={() => {
                  setChainIdx(i);
                  setCopied(false);
                }}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}
        <div className="crypto-label">{chain.hint}</div>
        <div className="crypto-addr">
          <code className="mono">{chain.address}</code>
          <button onClick={copy}>{copied ? "Copied" : "Copy"}</button>
        </div>
        <div className="crypto-hint">Send from any wallet — it all fuels the board.</div>
      </div>
    </div>
  );
}
