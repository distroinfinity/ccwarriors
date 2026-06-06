import { useState } from "react";

type Os = "unix" | "win";

// Channel attribution: a stored ref (captured from ?ref= on arrival) rides the
// install URL so the served script can embed it and the funnel attributes.
function refQuery(): string {
  try {
    const ref = localStorage.getItem("ccw_ref");
    return ref ? `?ref=${ref}` : "";
  } catch {
    return "";
  }
}

const COMMANDS: Record<Os, { label: string; prompt: string; cmd: (ref: string) => string }> = {
  unix: {
    label: "macOS / Linux",
    prompt: "$",
    cmd: (ref) => `curl -fsSL https://api.ccwarriors.xyz/install.sh${ref} | bash`,
  },
  win: {
    label: "Windows",
    prompt: ">",
    cmd: (ref) => `irm https://api.ccwarriors.xyz/install.ps1${ref} | iex`,
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
  const { prompt } = COMMANDS[os];
  const cmd = COMMANDS[os].cmd(refQuery());

  const copy = () => {
    navigator.clipboard?.writeText(cmd);
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
          <span className="p">{prompt}</span> {cmd}
        </code>
        <button onClick={copy}>{copied ? "Copied" : "Copy"}</button>
      </div>
    </div>
  );
}
