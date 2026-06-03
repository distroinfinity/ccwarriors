# ccwarriors CLI

Sync your [Claude Code](https://claude.ai/code) costs and climb the
[CCWarriors](https://ccwarriors.xyz) leaderboard.

## Install (one command — installs and enlists)

```bash
curl -fsSL https://ccwarriors.xyz/install.sh | bash
```

Requires Node.js 20+. The CLI is a zero-dependency single-file bundle installed
to `~/.ccwarriors/`, with a `ccwarriors` command linked into `~/.local/bin`.
No npm involved — the site itself serves the latest CLI on every deploy.

## Commands

| Command | Description |
|---------|-------------|
| `ccwarriors` | Sync costs (default command) |
| `ccwarriors login` | Authenticate with GitHub |
| `ccwarriors logout` | Remove stored credentials |
| `ccwarriors whoami` | Show the currently enlisted login |
| `ccwarriors autosync on` | Background daemon — streams usage in real time, survives reboots |
| `ccwarriors autosync off` | Stop the scheduled sync |
| `ccwarriors --help` | Show usage |

## How it works

1. On first run (or after `login`) you authenticate with GitHub via a
   browser-based loopback OAuth flow — no password ever touches the CLI.
2. The CLI reads your local Claude Code usage via
   [ccusage](https://github.com/ryoppippi/ccusage).
3. The two cost totals (and nothing else) are posted to the CCWarriors API and
   your rank is printed.

## Environment overrides

| Variable | Default | Purpose |
|----------|---------|---------|
| `CCWARRIORS_API` | `https://api.ccwarriors.xyz` | API base URL (useful for local testing) |
| `CCWARRIORS_WEB` | `https://ccwarriors.xyz` | Web base URL for profile links |

### Local testing example

```bash
pnpm --filter claude-warriors build
CCWARRIORS_API=http://localhost:8787 node packages/cli/dist/cli.js
```

## Stored credentials

Credentials are stored in `~/.claude-warriors/config.json` (mode `0600`).
Run `ccwarriors logout` to remove them.
