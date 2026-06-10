# ccusage resilience + self-update rollback decoupling

**Date:** 2026-06-11
**Status:** Approved design — ready for implementation plan

## Background / incident

A PostHog alert (labeled "install failure") fired on a burst of `sync_failed`
telemetry events, all on `darwin`. Investigation found:

- The **install funnel is healthy** — `/telemetry/failures` showed
  `installFailuresLastHour: 0`, no open GitHub `health-alert` issue, and all 10
  prod health checks pass. The alert was the background **autosync daemon**, not
  the installer.
- Root cause: the daemon runs `npx --yes ccusage@20` (`packages/cli/src/ccusage.ts`),
  which resolves to the latest 20.x = **`ccusage@20.0.10`**. That version's
  published `@ccusage/ccusage-darwin-arm64` prebuilt binary is linked against a
  dead Nix-store libiconv:

  ```
  dyld: Library not loaded: /nix/store/xvmhk…-libiconv-109.100.2/lib/libiconv.2.dylib (no such file)
    Referenced from: …/@ccusage/ccusage-darwin-arm64/bin/ccusage
  ```

  ccusage crashes at load → `readUsage()` throws → every sync fails → after 3
  strikes (and again after each restart) the daemon beacons `sync_failed`.
- **Verified upstream, not local:** a fresh download of `ccusage@20.0.10` into a
  clean cache still links the dead Nix path; `20.0.6` links
  `/usr/lib/libiconv.2.dylib` and works. Nix is not installed on the affected
  machine. So this is a fleet-wide regression for any macOS-arm64 user whose
  `npx ccusage@20` resolves to 20.0.10.
- **ccusage v20 has no pure-JS path** — its `dist/cli.js` is purely a launcher
  that spawns the platform native binary; no env var bypasses it. So resilience
  must come from falling back to a known-good *version*, not from forcing JS.

A second, independent bug surfaced: the CLI self-update **rolls a new build
back** when it can't complete a sync within 5 starts
(`MAX_STARTS_BEFORE_ROLLBACK`). On the affected Macs the sync fails because
*ccusage* crashes, not because the new bundle is bad — so good builds get
wrongly rolled back (`self_update_rollback`), and the fleet can loop. The
self-update health signal ("completed a sync") is confounded by ccusage/network
health.

## Goals

1. Keep `ccusage@20` (latest features) on healthy machines, but **automatically
   fall back to a known-good version** when the native binary crashes — sync
   never stops.
2. **Stop the daemon flapping** (~every 12s) when ccusage is hard-broken.
3. **Decouple self-update rollback from external (ccusage/network/server)
   health** so a good new build is never rolled back for a reason that isn't the
   bundle's fault — while preserving rollback for genuinely broken bundles.
4. Add observability so the next bad upstream ccusage patch is visible early.

Non-goals: changing the install funnel (it's healthy); fixing ccusage upstream
(filed separately); forcing a ccusage JS path (doesn't exist in v20).

## Components

### 1. ccusage version fallback — `packages/cli/src/ccusage.ts` (core)

- Keep `CCUSAGE_PKG = "ccusage@20"` as the **primary** spec.
- Add `CCUSAGE_FALLBACK_PKG = "ccusage@20.0.6"` — last-known-good pin whose
  native binary links `/usr/lib/libiconv.2.dylib`. (Bump occasionally as upstream
  ships fixed versions; see follow-ups.)
- Module-level `activeSpec`, initialized to the primary. `runCcusage` invokes
  `activeSpec`.
- **Native-failure detection.** A ccusage invocation is treated as a native
  load/crash failure when the thrown exec error's `stderr`/`message` matches any
  of: `dyld`, `Library not loaded`, `image not found`, `Bad CPU type`,
  `cannot execute binary`, `native binary is not available`,
  `native binary is not executable` — or the child was killed by a signal
  (`err.signal != null`).
- **Fallback flip.** On a native failure while `activeSpec` is the primary: set
  `activeSpec = CCUSAGE_FALLBACK_PKG` **once**, fire the `ccusage_fallback`
  telemetry event once, and retry the current call with the fallback. All
  subsequent calls in this process use the fallback directly — so we never
  re-spawn the broken primary (this is the per-call half of the flap fix).
- **Both broken.** If the fallback invocation also fails with a native
  signature, throw (as today) so `readUsage` surfaces the failure and the daemon
  records it.
- **Empty data is not failure.** Legitimate "no usage found" / empty `daily`
  results must never trigger fallback — only the native crash signature does.
- Route the trailing `--version` read (currently calling `CCUSAGE_PKG`
  directly) through `activeSpec`.
- **Testability seam.** `runCcusage` takes an injectable exec runner
  (default = the real `execFile`-based runner) so tests can simulate
  primary-crash / fallback-success / both-crash without spawning processes.

### 2. Daemon backoff — `packages/cli/src/daemon.ts` (core)

- Add a `nextAllowedSyncAt` timestamp gate. On a hard sync failure, set it to
  `now + nextBackoffMs(failStreak)`. Both `schedule()` and the heartbeat tick
  skip syncing while `now < nextAllowedSyncAt`. Reset `failStreak` and clear the
  gate on the first successful sync.
- `nextBackoffMs(streak)`: exponential with a floor and cap — approximately
  1m → 5m → 15m, capped at ~30m. Exact curve defined in the plan; extracted as a
  **pure function** alongside `shouldSync(now, gate)` for unit testing.
- Healthy machines are unaffected (gate is in the past, event-driven sync stays
  responsive). Broken machines stop spamming syncs and telemetry.

### 3. Self-update rollback decoupling — `packages/cli/src/selfupdate.ts` + daemon (core)

- Add `markBuildAlive()`: clears the pending rollback marker for the current
  build **without** emitting `self_update_applied`. Idempotent and cheap.
- Call `markBuildAlive()` in `syncNow`'s `finally` block. Reaching the end of a
  sync *cycle* — even one where `readUsage` threw or ingest returned 5xx —
  proves the new bundle's daemon path executed without crashing, so the build is
  not at fault. A bundle with a genuine boot/daemon-path crash exits before
  `finally` runs → marker stays → `selfUpdateBootCheck` still rolls it back after
  `MAX_STARTS_BEFORE_ROLLBACK`.
- `markUpdateSuccess()` is unchanged: still called in the genuine-success branch
  (`res.data?.ok`) to clear the marker and emit `self_update_applied`.
- Rationale: `maybeSelfUpdate` already validates the bundle can run `--version`
  before swapping, so a swapped bundle is guaranteed to execute. This change
  narrows rollback to its real purpose — catching a bundle that crashes in the
  daemon path — and removes false rollbacks caused by ccusage, network, or
  server outages.

### 4. Telemetry / observability — `apps/server/src/routes/telemetry.ts` (supporting)

- Add `ccusage_fallback` to the event enum. The CLI fires it once per process
  when it flips to the fallback spec — early warning that upstream-latest ccusage
  is broken in the fleet.
- `ccusage_fallback` is **not** added to the `failureEvents` list, so it is
  captured/forwarded to PostHog and Railway logs but never enters the rolling
  failure window — it is a successful-degraded state, not a failure, and never
  pages. No change to `recordFailure` or the `/telemetry/failures` `nonPaging`
  set is needed.
- `sync_failed` still fires only when even the fallback dies.

## Error handling summary

| Situation | Behavior |
|---|---|
| Primary ccusage healthy | Use latest; never touch fallback. |
| Primary native crash, fallback healthy | Flip to fallback once, `ccusage_fallback` fired once, sync succeeds. |
| Primary + fallback both crash | `readUsage` throws → daemon records `sync_failed`, backoff engages. |
| ccusage empty/no-usage | Treated as success-with-no-data; no fallback. |
| New bundle runs but sync fails (ccusage/net/server) | `markBuildAlive` clears marker → no rollback. |
| New bundle crashes in daemon path | Marker never cleared → rollback after 5 starts (unchanged). |

## Testing (TDD, vitest in `packages/cli`)

New tests (first CLI tests in the package; `pnpm --filter cli test`):

- **ccusage fallback** (injected exec runner):
  - primary native-crash → flips to fallback → returns parsed data;
  - both crash → throws;
  - healthy primary → fallback never invoked;
  - `activeSpec` memoized (second call uses fallback directly);
  - empty/no-usage output → no fallback.
- **backoff** (pure functions): `nextBackoffMs(streak)` curve + cap;
  `shouldSync(now, gate)` boundaries.
- **selfupdate**: `markBuildAlive()` clears the pending marker without
  `self_update_applied`; `selfUpdateBootCheck` still rolls back when the marker
  is never cleared.

Gate: `pnpm -r test && pnpm -r typecheck && pnpm -r build` (`pnpm verify`).

## Rollout

- **Battle-test locally before any PR.** Required workflow: implement on a
  feature branch, run `pnpm verify` (tests + typecheck + build), then exercise
  the real failure path on this machine — force the broken primary and confirm
  the daemon falls back to the known-good version, syncs successfully, stops
  flapping, and does not trigger a self-update rollback. Only after the local
  battle-test passes do we open a PR. **Never merge straight to main.**
- Ship as a normal CLI release; the build self-updates the fleet. Once a Mac
  picks up the new build, the fallback engages on the next sync and it recovers.
- The currently-running (pre-fix) daemons keep flapping until they self-update;
  acceptable and self-healing.

## Follow-ups (out of scope for this change)

- File an upstream issue on `ryoppippi/ccusage`: the published
  `@ccusage/ccusage-darwin-arm64@20.0.10` prebuilt links a dead
  `/nix/store/…libiconv-109.100.2/lib/libiconv.2.dylib` rpath and crashes at
  load on any machine without that exact Nix store path.
- Revisit `CCUSAGE_FALLBACK_PKG` once upstream ships a fixed 20.x; consider
  bumping the pin or switching the fallback to "latest known-good" tracking.
