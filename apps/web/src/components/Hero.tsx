import { useState } from "react";

export function Hero() {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText("npx claude-warriors");
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  return (
    <div className="hero">
      <h1>
        Token burn rate, <span className="o">ranked.</span>
      </h1>
      <p>See who's burning the most Claude Code tokens.</p>
      <div className="install">
        <code>
          <span className="p">$</span> npx claude-warriors
        </code>
        <button onClick={copy}>{copied ? "Copied" : "Copy"}</button>
      </div>
    </div>
  );
}
