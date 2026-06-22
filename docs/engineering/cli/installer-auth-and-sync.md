---
title: Installer, Auth, and Sync
description: How the CLI ships, logs in, reads usage, and uploads it.
---

# Installer, Auth, and Sync

## Distribution — the site is the registry

`packages/cli` bundles (tsup) to a zero-dependency single-file ES module with a `// ccw-build:<id>` banner. The web app's `prebuild` copies it to `apps/web/public/cli.js`, so **every Vercel deploy is a CLI release** — no npm, no publish step. The API server mirrors the same assets (`routes/installer.ts` serves `/install.sh`, `/install.ps1`, `/cli.js`) for clients blocked by Vercel's edge policy; the installer's fallback host is `get.ccwarriors.xyz`, and each script is served with its `BASE` rewritten to whichever host delivered it so the follow-up `cli.js` download stays on the working host.

`install.sh` (`apps/web/public/install.sh`): checks Node ≥20 (with distinct telemetry step names per failure mode), downloads `cli.js` to `~/.ccwarriors/`, writes a `{"type":"module"}` package.json beside it (Node 20/21 would otherwise parse the ESM bundle as CommonJS), creates a wrapper at `~/.ccwarriors/bin/ccwarriors`, symlinks it into `~/.local/bin`, persists the channel ref, and runs the first sync. Installer-only env: `CCWARRIORS_NO_RUN=1` (skip the auto-run), `CCWARRIORS_BASE` / `CCWARRIORS_FALLBACK` (host overrides), `CCWARRIORS_TELEMETRY=0` (no beacons).

## Auth (`src/auth.ts`, `src/config.ts`)

Loopback OAuth: the CLI binds a random `127.0.0.1` port, opens `${API_BASE}/cli/auth?port=<port>&ref=<ref>` in the browser (manual link printed if that fails), and waits up to 2 minutes for the server's redirect to `/callback?token=…&login=…`. Nothing is ever typed into the terminal.

Config persists at `~/.claude-warriors/config.json` — directory mode 0700, file mode 0600 (`config.ts:37-38`):

```ts
{ token, login, machineId?, insightsSalt?, ackConsentVersion? }
```

`machineId = sha256(hostname|username|platform|arch)` truncated to 16 hex (`config.ts:42-67`). **Deterministic on purpose**: reinstalls and re-logins produce the same id, so the server's per-machine ledger doesn't double count; an existing stored id is never rehashed. `insightsSalt` (16 random bytes, hex) salts git repo/branch hashes and **never leaves the machine**.

On 401: interactive sync re-runs the login flow and retries once; `watch` clears config and exits; the daemon pauses and recovers when a re-login lands on disk (see [Autosync](autosync-and-self-update.md)).

## Sync (`src/cli.ts`, `src/ccusage.ts`, `src/core.ts`)

Bare `ccwarriors` runs a sync:

1. **Read usage** via `npx --yes ccusage@20` (`CCWARRIORS_CCUSAGE_PKG` override, `ccusage.ts:11`), one `ccusage <key> daily` call per tool key in `src/tools.ts` — the registry mirrored from the server's `lib/tools.ts` ("keep both in sync"). Window: last 40 days. If the pinned ccusage's native binary crashes (dyld errors, ETARGET, "native binary is not available"), the CLI falls back to `ccusage@20.0.6` for the rest of the process and beacons `ccusage_fallback` (`ccusage.ts:87-113`). Partial per-tool failures continue with the successful tools (+ `tool_collection_failed` beacon); only all-tools failure aborts.
2. **Upload** `POST /ingest` with `{tools, machineId, clientBuildId, ccusageVersion}` (`core.ts:50-62`). Client-side cost estimates ride along per day as a cross-check only.
3. **Handle the response:** 200 prints tier, 30d/all-time rank, and the profile link; 429 means "already synced" (the server's 10s floor) and is not an error; 401 triggers re-login.

Referral attribution: `CCWARRIORS_REF` env or the `~/.ccwarriors/ref` file written by the installer (`core.ts:13-23`), sanitized to a ≤64-char `[a-z0-9_-]` slug.

## Environment variables

| Var | Default | Purpose |
|---|---|---|
| `CCWARRIORS_API` | `https://api.ccwarriors.xyz` | API base (`core.ts:8`) |
| `CCWARRIORS_WEB` | `https://ccwarriors.xyz` | Web base for printed links (`core.ts:9`) |
| `CCWARRIORS_REF` | ref file | Channel attribution (`core.ts:15`) |
| `CCWARRIORS_HOME` | *(two meanings — see [gotchas](../invariants-and-gotchas.md))* | `~/.ccwarriors` in `core.ts:18`, `~/.claude-warriors` in `insights.ts:330` |
| `CCWARRIORS_CLAUDE_DIR` | `~/.claude/projects` | Session source for deep insights/transcripts (`insights.ts:332`) |
| `CCWARRIORS_NO_UPDATE` | unset | `1` disables self-update (`selfupdate.ts:151`) |
| `CCWARRIORS_CCUSAGE_PKG` | `ccusage@20` | Pin the ccusage spec (`ccusage.ts:11`) |
| `CCWARRIORS_TELEMETRY` | enabled | `0` disables anonymous beacons (`core.ts:161`) |

Plus installer-only `CCWARRIORS_NO_RUN` / `CCWARRIORS_BASE` / `CCWARRIORS_FALLBACK`.

## Command surface (`src/cli.ts`)

`ccwarriors` (sync, default) · `login` · `logout` · `whoami` · `watch [seconds]` (foreground loop, min 10s, default 30s) · `autosync on [minutes] | off | status` · `daemon [heartbeatMin]` · `insights on | off | status | --dry-run` · `--version` (prints the build id) · `--help`. `watch`, `daemon`, and the default sync all run the self-update boot check first.
