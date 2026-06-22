---
title: Autosync and Self-Update
description: The background daemon and the atomic update/rollback machinery.
---

# Autosync and Self-Update

## Autosync setup (`src/autosync.ts`)

`ccwarriors autosync on [minutes]` installs a platform service; `off` removes it; `status` reads the marker file (`~/.claude-warriors/autosync.json`).

- **macOS:** a LaunchAgent labeled `xyz.ccwarriors.sync` at `~/Library/LaunchAgents/xyz.ccwarriors.sync.plist`, `RunAtLoad` + `KeepAlive`, running `ccwarriors daemon <minutes>` with stdout/stderr to `~/.ccwarriors/autosync.log`. This is a persistent event-driven daemon, not a polling timer.
- **Linux:** a crontab line running plain `ccwarriors sync` — `*/N * * * *` for N < 60, hourly multiples otherwise — tagged with the `# xyz.ccwarriors.sync` label comment for identification.

Teardown uses `launchctl bootout gui/<uid>/xyz.ccwarriors.sync` first; legacy `unload` can fail silently on newer macOS, leaving a KeepAlive daemon running while we claim it's off (seen in the wild — `autosync.ts:90-95`). If the job is still alive after both attempts, `autosync off` throws with the manual command instead of lying.

## The daemon (`src/daemon.ts`)

`runDaemon(heartbeatMin = 5)`:

- **Watchers:** recursive `fs.watch` on the agent log dirs that exist — `~/.claude/projects`, `~/.codex`, `~/.gemini`, `~/.copilot` (`WATCH_DIRS`, `daemon.ts:19-26`). No dirs found → heartbeat-only mode.
- **Debounce:** `DEBOUNCE_MS = 12_000`, deliberately above the server's 10s sync floor. Batching, not resetting: the timer fires 12s after the **first** event in a burst, so a busy session can't starve the sync forever.
- **Heartbeat:** every `heartbeatMin` minutes — catches agents without a watched dir, retries after failures, re-checks auth, and re-runs the self-update check.
- **One sync at a time;** changes during a sync queue a follow-up.

Failure handling:

- **429:** not a failure — the debounce already queued the next attempt.
- **401:** adopt a fresher token from disk if one exists (the user re-logged-in elsewhere); otherwise set `authPaused` and suppress syncs until a heartbeat finds a new token. No launchd thrash.
- **Hard failures:** exponential backoff via `src/backoff.ts` — 1m → 5m → 25m → capped at 30m, reset on success. After 3 consecutive hard failures, one `sync_failed` beacon (not per-failure — fleet signal, not spam).
- **Deep insights** ride the daemon fire-and-forget: extraction/upload failures log and beacon but never block the sync path.

## Self-update (`src/selfupdate.ts`)

Runs at the start of `watch`, `daemon`, and the default sync:

1. `GET /cli/version` (10s timeout) → `{buildId, updateEnabled}`. Skip when: `CCWARRIORS_NO_UPDATE=1`, not an installed copy (dev checkout), `updateEnabled: false` (the server-side `CLI_UPDATE_ENABLED=0` kill switch), target equals current, or this process already attempted this build.
2. Download `/cli.js` (60s timeout) to `<cliPath>.next.mjs`.
3. **Validate twice:** the file must contain `ccw-build:<target>` (stale CDN / mismatched deploy fails closed), and spawning it with `--version` must print the target build id.
4. **Swap atomically:** back up the current bundle to `<cliPath>.prev`, write `~/.ccwarriors/update-pending.json` (`{buildId, fromBuild, starts: 0}`), rename the new bundle into place. Under launchd, KeepAlive restarts the daemon on the new code.

**Rollback:** every boot increments `starts` in the pending marker. If `MAX_STARTS_BEFORE_ROLLBACK = 5` boots pass without the build proving itself, `.prev` is restored and a `self_update_rollback` beacon is sent (awaited up to 4s — the process is about to exit). The bar for "proving itself" is deliberately low: the daemon marks the build alive after a sync **attempt** completes, even a failed one — a broken network or a broken upstream ccusage must not roll back a healthy CLI. A successful sync clears the marker and deletes `.prev` (`self_update_applied`).
