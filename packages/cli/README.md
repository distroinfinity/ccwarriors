# ccwarriors CLI

Sync your AI coding usage — [Claude Code](https://claude.ai/code) and every
other agent [ccusage](https://github.com/ryoppippi/ccusage) reads — and climb
the [CCWarriors](https://ccwarriors.xyz) leaderboard.

## Install (one command — installs and enlists)

```bash
curl -fsSL https://ccwarriors.xyz/install.sh | bash
```

Requires Node.js 20+. The CLI is a zero-dependency single-file bundle installed
to `~/.ccwarriors/`, with a `ccwarriors` command linked into `~/.local/bin`.
Auth/config state lives separately in `~/.claude-warriors/config.json`. No npm
involved — the site itself serves the latest CLI on every deploy.

## Commands

| Command | Description |
|---------|-------------|
| `ccwarriors` | Sync costs (default command) |
| `ccwarriors login` | Authenticate with GitHub |
| `ccwarriors logout` | Remove stored credentials |
| `ccwarriors whoami` | Show the currently enlisted login |
| `ccwarriors watch [seconds]` | Foreground live sync loop |
| `ccwarriors autosync on` | Background daemon — streams usage in real time, survives reboots |
| `ccwarriors autosync off` | Stop the scheduled sync |
| `ccwarriors autosync status` | Show autosync state |
| `ccwarriors daemon [heartbeatMin]` | Run the daemon in the foreground |
| `ccwarriors insights on` | Enable deep profile insights and push an initial payload |
| `ccwarriors insights off` | Disable deep insights and purge server-side insights data |
| `ccwarriors insights --dry-run` | Print the exact deep payload locally without sending it |
| `ccwarriors --help` | Show usage |

## How it works

1. On first run (or after `login`) you authenticate with GitHub via a
   browser-based loopback OAuth flow — no password ever touches the CLI.
2. The CLI reads your local agent usage (a rolling 40-day window) via
   [ccusage](https://github.com/ryoppippi/ccusage).
3. The CLI uploads raw token counts per tool, per day, per model. The server
   prices them, updates your rank, and returns the current board position.
4. If you opt into deep insights, the CLI can also send per-session counts,
   timing summaries, model names, and hashed local Git outcomes. Story unlock
   adds redacted prompt extracts and transient transcripts only after an extra
   disclosure step.

## Environment overrides

| Variable | Default | Purpose |
|----------|---------|---------|
| `CCWARRIORS_API` | `https://api.ccwarriors.xyz` | API base URL (useful for local testing) |
| `CCWARRIORS_WEB` | `https://ccwarriors.xyz` | Web base URL for profile links |
| `CCWARRIORS_NO_UPDATE` | unset | Disable self-update when set to `1` |
| `CCWARRIORS_TELEMETRY` | enabled | Disable anonymous failure beacons when set to `0` |
| `CCWARRIORS_CCUSAGE_PKG` | `ccusage@20` | Pin a different ccusage version |
| `CCWARRIORS_CLAUDE_DIR` | `~/.claude/projects` | Session source for deep insights |
| `CCWARRIORS_REF` | unset | Channel attribution slug recorded at enlist |

### Local testing example

```bash
pnpm --filter claude-warriors build
CCWARRIORS_API=http://localhost:8787 node packages/cli/dist/cli.js
```

## Local state

- CLI bundle and installer assets: `~/.ccwarriors/`
- Auth/config: `~/.claude-warriors/config.json` (mode `0600`)
- Logout clears the config file. Removing the CLI bundle is separate.
