---
title: Autosync and Watch Mode
description: How your number stays live without you running anything.
---

# Autosync and Watch Mode

## Autosync

`ccwarriors autosync on` installs a small background service — launchd on macOS, cron on Linux — that survives reboots. `off` removes it, `status` tells you which state you're in.

On macOS it's a real-time daemon: it watches the folders your agents write usage to (Claude Code, Codex, Gemini, Copilot) and syncs when they change — batching a burst of writes into a 12-second window, because the server won't accept syncs less than 10 seconds apart anyway. When nothing's happening, a heartbeat syncs every 5 minutes (configurable: `ccwarriors autosync on 10`). On Linux, cron runs a plain sync on your chosen interval.

While you're coding, your row on the board moves about 13 seconds behind your keystrokes.

## When things go wrong

The daemon backs off after failures (1 minute, then 5, then 25, capping at 30) and recovers on its own. If your login expires it pauses quietly and resumes after you run `ccwarriors login` again — check `ccwarriors autosync status` if your number seems frozen.

## Watch mode

```bash
ccwarriors watch          # re-sync every 30s, live rank in your terminal
ccwarriors watch 60       # your own interval
```

A foreground loop: same syncs, no background service. It's the answer on Windows (where autosync isn't supported yet) and for anyone who'd rather not run a daemon. Ctrl-C stops it.
