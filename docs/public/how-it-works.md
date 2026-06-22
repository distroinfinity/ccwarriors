---
title: How It Works
description: The pipeline, the number, what gets counted, and how to leave.
---

# How It Works

```
your machine                          api.ccwarriors.xyz                   ccwarriors.xyz
────────────                          ──────────────────                   ──────────────
ccusage reads your agents' logs       verifies, prices the tokens          live board + profile
CLI sends raw token counts     ──►    sanity-checks, reranks         ──►   your row moves
```

## The number

Your AI coding usage over the last 30 days, priced in API dollars. [ccusage](https://github.com/ryoppippi/ccusage) reads your agents' local logs on your machine — we never see the logs. The CLI uploads raw token counts (per tool, per day, per model), and the server prices them itself from a public per-model pricing table refreshed daily. Dollar figures computed on your machine are never trusted — that's what makes the board hard to cheat.

The CLI uploads a rolling 40-day window of token history; the board ranks the last 30 days and all-time.

## What gets counted

Every agent ccusage can read. Currently tracked by name: Claude Code, Codex, OpenCode, Amp, Droid, Codebuff, Hermes, pi, Goose, Kilo, Copilot, Gemini, Kimi, Qwen, OpenClaw — and anything it reads that we don't recognize yet still counts in your total under **Other**.

## More than one machine?

Each machine gets a stable anonymous id (a one-way hash — no serial numbers), and the server **sums** machines instead of letting them overwrite each other. Reinstalling keeps the same id, so nothing double-counts.

## How the board updates

The global board updates over a WebSocket about a second after anyone syncs — when a number ticks, someone is coding right now. Org boards refresh their scoped slice about every 10 seconds.

## How to leave

```
ccwarriors autosync off                  stops the daemon
rm -rf ~/.ccwarriors ~/.claude-warriors  removes the CLI + local auth/config
rm ~/.local/bin/ccwarriors               removes the symlink
```

Deep-mode data, if you ever enabled it, is purged server-side with `ccwarriors insights off`. Details: [What Leaves Your Machine](privacy-and-trust/privacy-model.md).
