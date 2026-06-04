// "How it works" — plain mechanics, written like the README. Short sentences,
// one column, read top to bottom.

const GH = "https://github.com/distroinfinity/ccwarriors";

const FLOW = `your machine                          api.ccwarriors.xyz                   ccwarriors.xyz
────────────                          ──────────────────                   ──────────────
ccusage prices your local logs        verifies your token                  WebSocket push
daemon sends two numbers      ──►     stores the numbers, reranks    ──►   your row moves ~1s later`;

export function HowItWorks() {
  return (
    <div className="how">
      <div className="seclabel">How it works</div>
      <h1 className="how-h">The whole pipeline, nothing hidden.</h1>

      <pre className="how-flow mono">
        <code>{FLOW}</code>
      </pre>

      <section className="how-sec">
        <h2>What the number is</h2>
        <p>
          Your Claude Code usage over the last 30 days, priced in API dollars. Claude Code
          writes usage logs to <code>~/.claude/projects</code> on your machine. We read them
          with{" "}
          <a href="https://github.com/ryoppippi/ccusage" target="_blank" rel="noopener">
            ccusage
          </a>
          , an open source tool, right on your machine. We never see the logs.
        </p>
      </section>

      <section className="how-sec">
        <h2>What the install does</h2>
        <p>
          The install script downloads the CLI and starts a small daemon. The daemon watches
          your local usage logs. When they change, it syncs. About every 12 seconds while you
          code. Every 5 minutes when idle. You can read the installer before running it:{" "}
          <code>curl -fsSL https://api.ccwarriors.xyz/install.sh</code>
        </p>
      </section>

      <section className="how-sec">
        <h2>What we send</h2>
        <p>
          This is the entire payload: <code>{'{"cost30d": 1234.56, "costAllTime": 2345.67}'}</code>
          . Two numbers and a ccusage version string. No code. No prompts. No file names.
        </p>
      </section>

      <section className="how-sec">
        <h2>What we store</h2>
        <p>
          Your GitHub login and avatar, from OAuth with public profile scope only. Your two
          cost numbers. That is the whole row.
        </p>
      </section>

      <section className="how-sec">
        <h2>How the board updates</h2>
        <p>
          The server pushes changes over a WebSocket about a second after a sync. No polling.
          When a number ticks, someone is coding right now.
        </p>
      </section>

      <section className="how-sec">
        <h2>How to leave</h2>
        <pre className="how-leave mono">{`ccwarriors autosync off       stops the daemon
rm -rf ~/.ccwarriors          removes the CLI
rm ~/.local/bin/ccwarriors    removes the symlink`}</pre>
      </section>

      <p className="how-foot">
        All the code is public. Read it:{" "}
        <a href={GH} target="_blank" rel="noopener" className="mono">
          github.com/distroinfinity/ccwarriors
        </a>
      </p>

      <a className="how-back" href="/">
        ← back to the board
      </a>
    </div>
  );
}
