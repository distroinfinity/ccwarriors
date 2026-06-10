import { useState } from "react";

type Os = "unix" | "win";

// Channel attribution: a stored ref (captured from ?ref= on arrival). We pass it
// to the install shell as the CCWARRIORS_REF env var (which the script already
// reads) rather than a ?ref= URL query, for two reasons: the apex below serves a
// *static* script that drops query params, and a bare `?` in a pasted URL is a
// glob in zsh ("zsh: no matches found") that aborts the command before curl runs.
function refSlug(): string {
  try {
    return (localStorage.getItem("ccw_ref") ?? "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 64);
  } catch {
    return "";
  }
}

// Bootstrap from the Vercel apex (ccwarriors.xyz), not the api subdomain: the
// apex is a plain A-record with rock-solid DNS, whereas the Railway CNAME chain
// on api.ccwarriors.xyz can transiently fail to resolve ("could not resolve
// host") and stall installs. The script itself still pulls cli.js from the api.
const COMMANDS: Record<Os, { label: string; prompt: string; display: string; copy: (ref: string) => string }> = {
  unix: {
    label: "macOS / Linux",
    prompt: "$",
    display: "curl -fsSL https://ccwarriors.xyz/install.sh | bash",
    copy: (ref) => `curl -fsSL https://ccwarriors.xyz/install.sh | ${ref ? `CCWARRIORS_REF=${ref} ` : ""}bash`,
  },
  win: {
    label: "Windows",
    prompt: ">",
    display: "irm https://ccwarriors.xyz/install.ps1 | iex",
    copy: (ref) => `${ref ? `$env:CCWARRIORS_REF='${ref}'; ` : ""}irm https://ccwarriors.xyz/install.ps1 | iex`,
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
    // displayed command is always clean; copied text carries the attribution ref
    navigator.clipboard?.writeText(COMMANDS[os].copy(refSlug()));
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
