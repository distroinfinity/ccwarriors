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

## PostHog evidence (7-day window, queried 2026-06-11)

The live event stream confirmed and sharpened the diagnosis. `sync_failed`
(205 events, all `darwin`) broke down as:

| Category | Count | Meaning |
|---|---|---|
| `network_fetch_failed` | 84 | transient connectivity (`fetch()` to API failed) |
| ccusage command failed | 66 | `npx ccusage@20 daily …` failing (reason truncated at 120 chars) |
| `usage collection failed` | 19 | `readUsage()` threw — downstream of ccusage failures |
| ccusage **native crash** | 16 | `dyld: Library not loaded` — two variants: `/nix/store/…libiconv` AND `/opt/homebrew/opt/ll…`, plus "native binary is not available" |
| ccusage npm resolve | 9 | `npm error ETARGET … No matching version` for `ccusage@20` |
| `auth_401` | 6 | expired/invalid ingest token |
| `server_5xx` | 3 | transient Railway |
| `spawn EAGAIN` | 2 | OS resource exhaustion |

Corrections this forced on the original framing:

- **Not "fleet-wide."** `self_update_applied` fired 552× across 48 distinct
  builds in 7 days ⇒ ~12 active machines, ~7 deploys/day. The ccusage 20.0.10
  bug *would* hit any Mac that pulls it, but observed blast radius is a handful
  of (Mac) machines, heavily the dev's own. Telemetry carries no machine id, so
  exact per-machine counts aren't available (a follow-up: add `machineId` to
  daemon telemetry).
- **The ccusage error signatures match the fix's detection** — nix dyld,
  homebrew dyld, and "native binary is not available" are all covered; the 66
  truncated "command failed" rows are the same `ccusage@20` invocation whose
  full stderr the runtime fallback still inspects. ETARGET is a separate
  npm-resolution failure now also handled (see Component 1).
- **Rollback has *never* been observed** — `self_update_rollback` isn't in the
  project taxonomy (0 events), partly a real bug: the rollback emits
  `void postTelemetry(...)` then `process.exit(1)` on the next line, so the
  fire-and-forget beacon never flushes. Rollbacks (if any) are invisible.
  Addressed by Component 6.

## Goals

1. Keep `ccusage@20` (latest features) on healthy machines, but **automatically
   fall back to a known-good version** when the native binary crashes — sync
   never stops.
2. **Stop the daemon flapping** (~every 12s) when ccusage is hard-broken.
3. **Decouple self-update rollback from external (ccusage/network/server)
   health** so a good new build is never rolled back for a reason that isn't the
   bundle's fault — while preserving rollback for genuinely broken bundles.
4. Add observability so the next bad upstream ccusage patch is visible early.
5. **Recover the daemon from a 401** instead of backing off forever on a stale
   token (the daemon can't run an interactive login and holds the token it read
   at startup, so a re-login elsewhere never reaches it today).
6. **Make rollbacks observable** — flush the rollback telemetry before the
   process exits.

Non-goals: changing the install funnel (it's healthy); fixing ccusage upstream
(filed separately); forcing a ccusage JS path (doesn't exist in v20); adding a
machine id to daemon telemetry (separate follow-up).

## Components

### 1. ccusage version fallback — `packages/cli/src/ccusage.ts` (core)

- Keep `CCUSAGE_PKG = "ccusage@20"` as the **primary** spec.
- Add `CCUSAGE_FALLBACK_PKG = "ccusage@20.0.6"` — last-known-good pin whose
  native binary links `/usr/lib/libiconv.2.dylib`. (Bump occasionally as upstream
  ships fixed versions; see follow-ups.)
- Module-level `activeSpec`, initialized to the primary. `runCcusage` invokes
  `activeSpec`.
- **Broken-ccusage detection** (`isCcusageBroken`). A ccusage invocation is
  treated as broken when the thrown exec error's `stderr`/`message` matches any
  of: `dyld`, `Library not loaded`, `image not found`, `Bad CPU type`,
  `cannot execute binary`, `native binary is not available`,
  `native binary is not executable` (native load/exec crashes — both the nix and
  homebrew dyld variants seen in PostHog), OR `npm error code ETARGET` /
  `No matching version` (npm fails to resolve `ccusage@20` — PostHog showed 9
  such failures; the exact-pinned fallback can resolve where the `@20` range
  hiccups, and is harmless if the registry is genuinely down since backoff still
  applies) — OR the child was killed by a signal (`err.signal != null`).
- **Fallback flip.** On a broken-ccusage failure while `activeSpec` is the primary: set
  `activeSpec = CCUSAGE_FALLBACK_PKG` **once**, fire the `ccusage_fallback`
  telemetry event once, and retry the current call with the fallback. All
  subsequent calls in this process use the fallback directly — so we never
  re-spawn the broken primary (this is the per-call half of the flap fix).
- **Both broken.** If the fallback invocation also fails the broken-ccusage
  check, throw (as today) so `readUsage` surfaces the failure and the daemon
  records it.
- **Empty data is not failure.** Legitimate "no usage found" / empty `daily`
  results must never trigger fallback — only the broken-ccusage signatures do.
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

- Add `ccusage_fallback` and `auth_expired` to the event enum. Neither is added
  to the `failureEvents` list, so they are captured/forwarded to PostHog and
  Railway logs but never enter the rolling failure window or page — they are
  degraded-but-known states, not prod breakage. No change to `recordFailure` or
  the `/telemetry/failures` `nonPaging` set is needed.
- `ccusage_fallback` fires once per process when the CLI flips to the fallback
  spec (early warning of a bad upstream patch). `sync_failed` still fires only
  when even the fallback dies.

### 5. Daemon 401 re-auth — `packages/cli/src/daemon.ts` (core)

PostHog showed 6 `auth_401` failures; the daemon currently treats 401 as a
generic failure and backs off forever, because (a) it can't run the interactive
browser login and (b) it captured `config.token` once at startup, so a re-login
on disk never reaches the running process.

- Make the daemon's `token` mutable (`let token = cfg.token`).
- Add `reloadToken()` → re-reads `loadConfig()` from disk, returns the on-disk
  token or null.
- Handle `res.status === 401` as its own branch in `syncNow`, before the generic
  failure branch:
  - Call `reloadToken()`. If the disk token differs from the in-memory token
    (the user re-logged-in elsewhere), adopt it, log "token refreshed", and
    reschedule a sync — **not** counted as a hard failure, no backoff.
  - Otherwise the token is genuinely expired: set `authPaused = true`, log
    "token expired — run `ccwarriors login` to re-enable autosync", and fire
    `auth_expired` **once**. Do not exit (avoids launchd restart-thrash).
- While `authPaused`, `schedule()` and the heartbeat skip syncing — but the
  heartbeat first calls `reloadToken()`; if the token changed, clear
  `authPaused`, adopt the new token, and resume. This auto-recovers when the
  user re-logs-in interactively, with no thrash and one telemetry signal.
- Decision helper `resolveAuthAction(currentToken, diskToken)` →
  `"resume" | "pause"` is extracted as a **pure function** for unit testing.

### 6. Rollback telemetry flush — `packages/cli/src/selfupdate.ts` + `cli.ts` (supporting)

`self_update_rollback` has 0 events in PostHog because `selfUpdateBootCheck()`
emits `void postTelemetry("self_update_rollback", …)` and then `process.exit(1)`
on the next line — the fire-and-forget beacon never flushes.

- Make `selfUpdateBootCheck()` `async` and `await postTelemetry(...)` (it already
  has a 4s timeout) before `process.exit(1)` in the rollback branch.
- `await` it at its three call sites in `cli.ts` (`watch`, `daemon`, `sync` —
  lines 353, 364, 370). They currently call it un-awaited; awaiting is safe (it
  either returns quickly or rolls back and exits).

## Error handling summary

| Situation | Behavior |
|---|---|
| Primary ccusage healthy | Use latest; never touch fallback. |
| Primary broken (dyld crash or ETARGET), fallback healthy | Flip to fallback once, `ccusage_fallback` fired once, sync succeeds. |
| Primary + fallback both broken | `readUsage` throws → daemon records `sync_failed`, backoff engages. |
| ccusage empty/no-usage | Treated as success-with-no-data; no fallback. |
| New bundle runs but sync fails (ccusage/net/server) | `markBuildAlive` clears marker → no rollback. |
| New bundle crashes in daemon path | Marker never cleared → rollback after 5 starts; rollback telemetry now flushes. |
| Daemon gets 401, newer token on disk | Adopt it, retry, no backoff. |
| Daemon gets 401, no newer token | `authPaused` + `auth_expired` once; heartbeat auto-resumes when a re-login lands. |

## Testing (TDD, vitest in `packages/cli`)

New tests (first CLI tests in the package; `pnpm --filter cli test`):

- **ccusage fallback** (injected exec runner):
  - primary native-crash (dyld) → flips to fallback → returns parsed data;
  - primary ETARGET / "No matching version" → flips to fallback;
  - both broken → throws;
  - healthy primary → fallback never invoked;
  - `activeSpec` memoized (second call uses fallback directly);
  - empty/no-usage output → no fallback.
- **backoff** (pure functions): `nextBackoffMs(streak)` curve + cap;
  `shouldSync(now, gate)` boundaries.
- **auth** (pure function): `resolveAuthAction(current, disk)` → `resume` when
  the disk token is new and non-null, `pause` otherwise (incl. null).
- **selfupdate**: `markBuildAlive()` clears the pending marker without
  `self_update_applied`; leaves a different build's marker intact; no-op with no
  marker.

Gate: `pnpm -r test && pnpm -r typecheck && pnpm -r build` (`pnpm verify`).

## Rollout

- **Battle-test locally before any PR.** Required workflow: implement on a
  feature branch, run `pnpm verify` (tests + typecheck + build), then exercise
  the real failure path on this machine — force the broken primary and confirm
  the daemon falls back to the known-good version, syncs successfully, stops
  flapping, and does not trigger a self-update rollback. Also force a 401 (point
  the daemon at a bad token) and confirm it pauses, fires `auth_expired`, and
  resumes after a re-login lands on disk. Only after the local battle-test
  passes do we open a PR. **Never merge straight to main.**
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
- Add a `machineId` property to daemon telemetry so failure counts can be
  attributed per-machine (today daemon events are anonymous and collapse to one
  `person_id`).
