import { useState } from "react";

type Os = "unix" | "win";

const COMMANDS: Record<Os, { label: string; prompt: string; cmd: string }> = {
  unix: {
    label: "macOS / Linux",
    prompt: "$",
    cmd: "curl -fsSL https://ccwarriors.xyz/install.sh | bash",
  },
  win: {
    label: "Windows",
    prompt: ">",
    cmd: "irm https://ccwarriors.xyz/install.ps1 | iex",
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
  const { prompt, cmd } = COMMANDS[os];

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
