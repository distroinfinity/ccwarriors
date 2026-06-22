// "How it works" — plain mechanics, written like the README. Short sentences,
// one column, read top to bottom.

const GH = "https://github.com/distroinfinity/ccwarriors";

const FLOW = `your machine                          api.ccwarriors.xyz                   ccwarriors.xyz
────────────                          ──────────────────                   ──────────────
ccusage reads your agents' logs       verifies, prices the tokens          live board + profile
CLI sends raw token counts     ──►    sanity-checks, reranks         ──►   update after sync`;

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
          Your AI-coding usage over the last 30 days, priced in API dollars. Every agent
          writes usage logs locally — Claude Code to <code>~/.claude/projects</code>, Codex to{" "}
          <code>~/.codex</code>, the others to their own folders. We read them with{" "}
          <a href="https://github.com/ryoppippi/ccusage" target="_blank" rel="noopener">
            ccusage
          </a>
          , an open source tool, right on your machine. We never see the logs.
        </p>
      </section>

      <section className="how-sec">
        <h2>Which tools we count</h2>
        <p>
          Claude Code, Codex, Gemini CLI, Copilot, OpenCode, Amp, Droid — 15 agents tracked
          in all — plus every other agent ccusage can read, which still counts toward your
          total under Other. Your total is the sum across all of them. Filter the board
          to a single tool with the icons above the leaderboard — new tools light up
          automatically as support lands.
        </p>
      </section>

      <section className="how-sec">
        <h2>What the install does</h2>
        <p>
          The install script downloads the CLI, runs the first sync, and on macOS/Linux
          enables autosync. The daemon watches known agent folders, batches writes into a
          12-second window, and sends a heartbeat every 5 minutes when idle. Windows stays
          manual unless you run <code>ccwarriors watch</code>. You can read the installer
          before running it:{" "}
          <code>curl -fsSL https://ccwarriors.xyz/install.sh</code>
        </p>
      </section>

      <section className="how-sec">
        <h2>What we send</h2>
        <p>
          Raw token counts per tool, per day, per model — like{" "}
          <code>{'{"claude": [{"date": "2026-06-04", "models": [{"modelName": "claude-opus-4-8", "inputTokens": 1024, …}]}]}'}</code>
          . No dollars (the server prices them), no code, no file names, no repo names.
        </p>
      </section>

      <section className="how-sec">
        <h2>Optional deep mode</h2>
        <p>
          Profile insights are opt-in. Deep mode adds per-session counts, timing summaries,
          model names, and hashed local Git outcomes. If you unlock the story tier, it can also
          send redacted repeated prompts and redacted transcripts to write your story page.
          No code, file paths, commit messages, or SHAs are sent.
        </p>
      </section>

      <section className="how-sec">
        <h2>Why you can't cheat it</h2>
        <p>
          The server prices every token itself and sanity-checks every sync: how fast spend
          grows, how big a single day can be, whether history quietly rewrites itself.
          Numbers that can't be real come off the board until a human looks. Estimates stay
          estimates — but they're honest estimates.
        </p>
      </section>

      <section className="how-sec">
        <h2>What we store</h2>
        <p>
          Your GitHub login and avatar. Your cost totals, per-tool split, and the daily token
          counts behind them. If you sign in, we also keep a GitHub OAuth token with{" "}
          <code>read:user</code> scope for public GitHub-stats refresh. Deep mode adds profile
          metrics and, if you unlock story generation, a derived story document. Transcript
          source payloads are transient and deleted after story generation.
        </p>
      </section>

      <section className="how-sec">
        <h2>How the board updates</h2>
        <p>
          The global board updates over a WebSocket about a second after a sync. Org boards poll
          their scoped slice every few seconds. When a number ticks, someone is coding right now.
        </p>
      </section>

      <section className="how-sec">
        <h2>How to leave</h2>
        <pre className="how-leave mono">{`ccwarriors autosync off                 stops the daemon
rm -rf ~/.ccwarriors ~/.claude-warriors removes the CLI + local auth/config
rm ~/.local/bin/ccwarriors              removes the symlink`}</pre>
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
