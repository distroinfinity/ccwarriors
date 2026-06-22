---
title: Install and First Sync
description: What the one command does, and every command after it.
---

# Install and First Sync

```bash
curl -fsSL https://ccwarriors.xyz/install.sh | bash
```

Windows (PowerShell):

```powershell
irm https://ccwarriors.xyz/install.ps1 | iex
```

Requires Node.js 20+. You can read either script before running it — fetch the URL without the pipe.

## What the script does

Downloads the CLI (a single-file bundle — no npm, no dependencies) to `~/.ccwarriors/`, links a `ccwarriors` command into `~/.local/bin`, and immediately runs your first sync:

1. **GitHub login opens in your browser.** The CLI listens on a local port for the redirect — you never type a password or token into the terminal.
2. **ccusage reads your agents' local logs** — last 40 days, on your machine.
3. **Raw token counts upload**, the server prices them, and the CLI prints your tier, your 30-day and all-time rank, and your profile link.

On macOS and Linux the installer also enables autosync. Re-sync manually any time: just `ccwarriors`.

## Commands

| Command | Does |
|---|---|
| `ccwarriors` | sync now (the default) |
| `ccwarriors login` / `logout` / `whoami` | manage the GitHub link |
| `ccwarriors watch [seconds]` | foreground re-sync loop (default 30s) |
| `ccwarriors autosync on [minutes] \| off \| status` | background daemon |
| `ccwarriors insights on \| off \| status \| --dry-run` | opt-in deep insights |
| `ccwarriors --version` / `--help` | the usual |

## Where things live

The program lives in `~/.ccwarriors/`; your login and settings live in `~/.claude-warriors/config.json` (readable only by you). They're separate on purpose — `logout` clears your credentials without touching the install, and reinstalling never logs you out.

## It keeps itself updated

Before each sync the CLI checks for a newer build and swaps itself atomically. A broken update rolls itself back automatically after a few failed starts. Opt out with `CCWARRIORS_NO_UPDATE=1`.

## Uninstall

```
ccwarriors autosync off
rm -rf ~/.ccwarriors ~/.claude-warriors
rm ~/.local/bin/ccwarriors
```
