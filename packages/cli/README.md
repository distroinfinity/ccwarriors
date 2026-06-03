# claude-warriors CLI

Sync your [Claude Code](https://claude.ai/code) costs and climb the [Claude Warriors](https://ccwarriors.xyz) leaderboard.

## Install & run

```bash
# No install needed — just use npx:
npx claude-warriors

# Or install globally:
npm install -g claude-warriors
claude-warriors
```

## Commands

| Command | Description |
|---------|-------------|
| `npx claude-warriors` | Sync costs (default command) |
| `npx claude-warriors login` | Authenticate with GitHub |
| `npx claude-warriors logout` | Remove stored credentials |
| `npx claude-warriors whoami` | Show the currently enlisted login |
| `npx claude-warriors --help` | Show usage |

## How it works

1. On first run (or after `login`) you authenticate with GitHub via a browser-based OAuth flow.
2. The CLI reads your local Claude Code usage via [ccusage](https://github.com/ryoppippi/ccusage).
3. Costs are posted to the Claude Warriors API and your rank is printed.

## Environment overrides

| Variable | Default | Purpose |
|----------|---------|---------|
| `CCWARRIORS_API` | `https://api.ccwarriors.xyz` | API base URL (useful for local testing) |
| `CCWARRIORS_WEB` | `https://ccwarriors.xyz` | Web base URL for profile links |

### Local testing example

```bash
CCWARRIORS_API=http://localhost:3000 npx claude-warriors
```

## Stored credentials

Credentials are stored in `~/.claude-warriors/config.json` (mode `0600`).
Run `npx claude-warriors logout` to remove them.
