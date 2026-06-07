import { useState } from "react";

type Os = "unix" | "win";

// Channel attribution: a stored ref (captured from ?ref= on arrival) rides the
// install URL so the served script can embed it and the funnel attributes.
function refQuery(): string {
  try {
    const ref = (localStorage.getItem("ccw_ref") ?? "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 64);
    return ref ? `?ref=${encodeURIComponent(ref)}` : "";
  } catch {
    return "";
  }
}

const COMMANDS: Record<Os, { label: string; prompt: string; display: string; copy: (ref: string) => string }> = {
  unix: {
    label: "macOS / Linux",
    prompt: "$",
    display: "curl -fsSL https://api.ccwarriors.xyz/install.sh | bash",
    copy: (ref) => `curl -fsSL https://api.ccwarriors.xyz/install.sh${ref} | bash`,
  },
  win: {
    label: "Windows",
    prompt: ">",
    display: "irm https://api.ccwarriors.xyz/install.ps1 | iex",
    copy: (ref) => `irm https://api.ccwarriors.xyz/install.ps1${ref} | iex`,
  },
};

function detectOs(): Os {
  try {
    const probe = `${navigator.platform ?? ""} ${navigator.userAgent ?? ""}`;
    return /win/i.test(probe) && !/darwin|mac os/i.test(probe) ? "win" : "unix";
  } catch {
    return "unix";
  }
}

/** Copyable install command with OS detection. Shared by the Hero and empty states. */
export function InstallBlock() {
  const [os, setOs] = useState<Os>(detectOs);
  const [copied, setCopied] = useState(false);
  const { prompt, display } = COMMANDS[os];

  const copy = () => {
    // displayed URL is always clean; copied text carries the attribution ref
    navigator.clipboard?.writeText(COMMANDS[os].copy(refQuery()));
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="installwrap">
      <div className="ostabs">
        {(Object.keys(COMMANDS) as Os[]).map((key) => (
          <button key={key} className={os === key ? "on" : ""} onClick={() => setOs(key)}>
            {COMMANDS[key].label}
          </button>
        ))}
      </div>
      <div className="install">
        <code>
          <span className="p">{prompt}</span> {display}
        </code>
        <button onClick={copy}>{copied ? "Copied" : "Copy"}</button>
      </div>
    </div>
  );
}
