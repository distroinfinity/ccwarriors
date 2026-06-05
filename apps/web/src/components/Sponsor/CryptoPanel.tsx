import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { EVM_ADDRESS } from "../../sponsorTiers";

/** Self-custody EVM address + QR. The QR sits on a white card so it scans in dark mode. */
export function CryptoPanel() {
  const [qr, setQr] = useState<string>("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    QRCode.toString(EVM_ADDRESS, { type: "svg", margin: 1, width: 132 })
      .then(setQr)
      .catch(() => setQr(""));
  }, []);

  const copy = () => {
    navigator.clipboard?.writeText(EVM_ADDRESS);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="crypto">
      {qr && <div className="qr" dangerouslySetInnerHTML={{ __html: qr }} />}
      <div className="crypto-meta">
        <div className="crypto-label">ETH / any EVM chain</div>
        <div className="crypto-addr">
          <code className="mono">{EVM_ADDRESS}</code>
          <button onClick={copy}>{copied ? "Copied" : "Copy"}</button>
        </div>
        <div className="crypto-hint">Send from any wallet — it all fuels the board.</div>
      </div>
    </div>
  );
}
