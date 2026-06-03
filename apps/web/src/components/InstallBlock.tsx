import { useState } from "react";

export const INSTALL_CMD = "curl -fsSL https://ccwarriors.xyz/install.sh | bash";

/** Copyable mono install command block. Shared by the Hero and empty states. */
export function InstallBlock() {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(INSTALL_CMD);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  return (
    <div className="install">
      <code>
        <span className="p">$</span> {INSTALL_CMD}
      </code>
      <button onClick={copy}>{copied ? "Copied" : "Copy"}</button>
    </div>
  );
}
