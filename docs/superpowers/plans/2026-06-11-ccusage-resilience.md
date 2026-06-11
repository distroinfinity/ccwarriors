# ccusage Resilience + Self-Update Rollback Decoupling — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the autosync daemon survive a broken upstream ccusage by falling back to a known-good version, stop it flapping when sync is hard-down, recover from a stale-token 401, stop the self-updater from rolling back good builds for external reasons, and make rollbacks observable.

**Architecture:** CLI changes (`ccusage.ts` version fallback with broadened detection, new `backoff.ts` wired into `daemon.ts`, daemon 401 re-auth, `selfupdate.ts` `markBuildAlive` + async rollback-telemetry flush awaited in `cli.ts`) plus one server change (non-paging `ccusage_fallback` + `auth_expired` telemetry events). All TDD with vitest. Battle-tested locally against this machine's real broken `ccusage@20.0.10` before any PR.

**Tech Stack:** TypeScript (NodeNext ESM), vitest 2.x, tsup bundling, Hono + zod (server). Package manager: pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-06-11-ccusage-resilience-design.md`

---

### Task 0: Feature branch

**Files:** none (git only)

- [ ] **Step 1: Create and switch to a feature branch off main**

Run:
```bash
cd /Users/manu/.superset/projects/claude-warriors
git checkout main && git pull --ff-only || true
git checkout -b fix/ccusage-resilience
git status
```
Expected: on branch `fix/ccusage-resilience`, clean tree (the design spec is already committed on main; if not yet merged it will ride along — that's fine).

---

### Task 1: Server — add non-paging `ccusage_fallback` + `auth_expired` events

**Files:**
- Modify: `apps/server/src/routes/telemetry.ts` (event enum, lines 9-29)
- Test: `apps/server/tests/telemetry.test.ts`

- [ ] **Step 1: Write the failing test**

Add this `it(...)` block inside the `describe("telemetry endpoint", ...)` in `apps/server/tests/telemetry.test.ts`, right after the `"reports sync failures..."` test:

```ts
  it("accepts ccusage_fallback and auth_expired without counting them as failures", async () => {
    for (const event of ["ccusage_fallback", "auth_expired"]) {
      const post = await app.request("/telemetry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event, distinctId: "t-5", props: { os: "darwin" } }),
      });
      expect(post.status).toBe(200);
    }
    const res = await app.request("/telemetry/failures");
    const body = (await res.json()) as FailureStats;
    expect(body.failuresLast24h).toBe(0);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter server test -- telemetry`
Expected: FAIL with `expected 400 to be 200` — the events aren't in the enum yet, so the POST is rejected.

- [ ] **Step 3: Add the events to the enum**

In `apps/server/src/routes/telemetry.ts`, in the `z.enum([...])` inside `bodySchema`, add the two new events immediately before the `"autosync_off_failed"` line:

```ts
    "self_update_applied",
    "self_update_rollback",
    // CLI degraded to the known-good ccusage after the latest native binary
    // crashed at load. Observability, not a failure — deliberately NOT added to
    // `failureEvents`, so it never enters the rolling window or pages.
    "ccusage_fallback",
    // Daemon hit a 401 with no fresher token on disk and paused autosync until
    // the user re-logs-in. User-specific, not prod breakage — also non-paging.
    "auth_expired",
    // `autosync off` couldn't kill the daemon (macOS launchctl edge).
    "autosync_off_failed",
```

Do NOT add either to the `failureEvents` array (leave that list unchanged).

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter server test -- telemetry`
Expected: PASS (all telemetry tests green).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/routes/telemetry.ts apps/server/tests/telemetry.test.ts
git commit -m "feat(telemetry): add non-paging ccusage_fallback + auth_expired events"
```

---

### Task 2: CLI — ccusage version fallback

**Files:**
- Modify: `packages/cli/src/ccusage.ts` (const block lines 7-9; `runCcusage` lines 52-60; version read lines 201-212)
- Test: `packages/cli/tests/ccusage.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/cli/tests/ccusage.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { invokeCcusage, resetCcusageStateForTest, type CcusageRunner } from "../src/ccusage.js";

// invokeCcusage fires postTelemetry on the first fallback — stub it so no
// network call happens during the unit test.
vi.mock("../src/core.js", () => ({ postTelemetry: vi.fn(async () => {}) }));

const nativeCrash = () =>
  Object.assign(new Error("dyld[1]: Library not loaded: /nix/store/x-libiconv.2.dylib"), {
    stderr: "dyld[1]: Library not loaded: /nix/store/x-libiconv.2.dylib (no such file)",
  });

const etargetCrash = () =>
  Object.assign(new Error("Command failed: npx --yes ccusage@20 daily"), {
    stderr: "npm error code ETARGET\nnpm error notarget No matching version found for ccusage@20",
  });

describe("invokeCcusage broken-ccusage fallback", () => {
  beforeEach(() => resetCcusageStateForTest());

  it("uses the primary when healthy and never calls the fallback", async () => {
    const run = vi.fn(async (_pkg: string, _args: string[]) => '{"daily":[]}');
    const out = await invokeCcusage(["daily", "--json"], run as unknown as CcusageRunner);
    expect(out).toBe('{"daily":[]}');
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith("ccusage@20", ["daily", "--json"]);
  });

  it("falls back to the known-good version when the primary native binary crashes", async () => {
    const run = vi.fn(async (pkg: string, _args: string[]) => {
      if (pkg === "ccusage@20") throw nativeCrash();
      return '{"daily":[{"date":"2026-06-01"}]}';
    });
    const out = await invokeCcusage(["daily", "--json"], run as unknown as CcusageRunner);
    expect(out).toContain("2026-06-01");
    expect(run).toHaveBeenNthCalledWith(1, "ccusage@20", ["daily", "--json"]);
    expect(run).toHaveBeenNthCalledWith(2, "ccusage@20.0.6", ["daily", "--json"]);
  });

  it("falls back when npm cannot resolve the primary (ETARGET)", async () => {
    const run = vi.fn(async (pkg: string, _args: string[]) => {
      if (pkg === "ccusage@20") throw etargetCrash();
      return "{}";
    });
    const out = await invokeCcusage(["daily"], run as unknown as CcusageRunner);
    expect(out).toBe("{}");
    expect(run).toHaveBeenNthCalledWith(2, "ccusage@20.0.6", ["daily"]);
  });

  it("memoizes the fallback for the rest of the process", async () => {
    const run = vi.fn(async (pkg: string, _args: string[]) => {
      if (pkg === "ccusage@20") throw nativeCrash();
      return "{}";
    });
    await invokeCcusage(["daily"], run as unknown as CcusageRunner); // flips (2 calls)
    await invokeCcusage(["--version"], run as unknown as CcusageRunner); // fallback directly (1 call)
    expect(run).toHaveBeenCalledTimes(3);
    expect(run).toHaveBeenLastCalledWith("ccusage@20.0.6", ["--version"]);
  });

  it("throws when both primary and fallback are broken", async () => {
    const run = vi.fn(async (_pkg: string, _args: string[]) => {
      throw nativeCrash();
    });
    await expect(invokeCcusage(["daily"], run as unknown as CcusageRunner)).rejects.toThrow(/Library not loaded/);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("does NOT fall back on a non-ccusage error", async () => {
    const run = vi.fn(async (_pkg: string, _args: string[]) => {
      throw new Error("some transient network thing");
    });
    await expect(invokeCcusage(["daily"], run as unknown as CcusageRunner)).rejects.toThrow(/transient network/);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter claude-warriors test -- ccusage`
Expected: FAIL — `invokeCcusage` / `resetCcusageStateForTest` are not exported (import error / undefined).

- [ ] **Step 3: Replace the pinned-package const block**

In `packages/cli/src/ccusage.ts`, replace lines 7-9:

```ts
// Pinned major: we own the collection path. ccusage ships breaking output
// changes in majors; bumping this requires a CLI release (self-update ships it).
const CCUSAGE_PKG = "ccusage@20";
```

with:

```ts
// Pinned major: we own the collection path. ccusage ships breaking output
// changes in majors; bumping this requires a CLI release (self-update ships it).
// Overridable via env so ops can pin in an emergency and the battle-test can
// force a known-broken version (e.g. CCWARRIORS_CCUSAGE_PKG=ccusage@20.0.10).
const CCUSAGE_PKG = process.env["CCWARRIORS_CCUSAGE_PKG"] ?? "ccusage@20";
// Known-good fallback. Some published ccusage patches ship a broken native
// prebuilt — e.g. 20.0.10 darwin-arm64 links a dead /nix/store libiconv and
// crashes at load (fixed upstream in 20.0.11). When the primary is broken we
// degrade to this pinned build (its native binary links /usr/lib/libiconv).
const CCUSAGE_FALLBACK_PKG = "ccusage@20.0.6";

// Which spec we invoke. Flips to the fallback for the rest of the process the
// first time the primary's native binary crashes, so we never re-spawn a
// known-broken ccusage.
let activeSpec = CCUSAGE_PKG;
let fallbackNotified = false;

/** Test-only: restore module state between tests. */
export function resetCcusageStateForTest(): void {
  activeSpec = CCUSAGE_PKG;
  fallbackNotified = false;
}
```

- [ ] **Step 4: Replace `runCcusage` with the injectable runner + fallback**

In `packages/cli/src/ccusage.ts`, replace the whole `runCcusage` function (lines 52-60):

```ts
async function runCcusage(args: string[]): Promise<unknown> {
  // Windows: npx is npx.cmd and needs a shell to spawn.
  const { stdout } = await execFileAsync(
    IS_WIN ? "npx.cmd" : "npx",
    ["--yes", CCUSAGE_PKG, ...args],
    { timeout: CMD_TIMEOUT_MS, shell: IS_WIN, maxBuffer: 32 * 1024 * 1024 },
  );
  return JSON.parse(stdout) as unknown;
}
```

with:

```ts
export type CcusageRunner = (pkg: string, args: string[]) => Promise<string>;

// Windows: npx is npx.cmd and needs a shell to spawn.
const defaultRunner: CcusageRunner = async (pkg, args) => {
  const { stdout } = await execFileAsync(
    IS_WIN ? "npx.cmd" : "npx",
    ["--yes", pkg, ...args],
    { timeout: CMD_TIMEOUT_MS, shell: IS_WIN, maxBuffer: 32 * 1024 * 1024 },
  );
  return stdout;
};

/**
 * The primary ccusage is unusable — distinct from "no usage". Covers native
 * load/exec crashes of the prebuilt binary (the nix AND homebrew dyld variants
 * seen in PostHog, plus "native binary is not available") and npm failing to
 * resolve `ccusage@20` (ETARGET). The exact-pinned fallback can clear both.
 */
function isCcusageBroken(err: unknown): boolean {
  const e = err as { stderr?: unknown; message?: unknown; signal?: unknown };
  if (e && e.signal) return true; // killed by a signal (segfault/abort)
  const text = `${typeof e?.stderr === "string" ? e.stderr : ""}\n${typeof e?.message === "string" ? e.message : ""}`;
  return /dyld|Library not loaded|image not found|Bad CPU type|cannot execute binary|native binary is not (available|executable)|ETARGET|No matching version/i.test(
    text,
  );
}

/**
 * Invoke ccusage, degrading to the known-good fallback ONCE if the primary is
 * broken (native crash or npm-resolution failure). Returns raw stdout. Exported
 * for unit testing via the injectable runner.
 */
export async function invokeCcusage(args: string[], run: CcusageRunner = defaultRunner): Promise<string> {
  try {
    return await run(activeSpec, args);
  } catch (err) {
    if (activeSpec === CCUSAGE_PKG && isCcusageBroken(err)) {
      activeSpec = CCUSAGE_FALLBACK_PKG;
      if (!fallbackNotified) {
        fallbackNotified = true;
        void postTelemetry("ccusage_fallback", { from: CCUSAGE_PKG, to: CCUSAGE_FALLBACK_PKG });
      }
      return await run(activeSpec, args);
    }
    throw err;
  }
}

async function runCcusage(args: string[]): Promise<unknown> {
  return JSON.parse(await invokeCcusage(args)) as unknown;
}
```

- [ ] **Step 5: Route the version read through `invokeCcusage`**

In `packages/cli/src/ccusage.ts`, replace the version-read block (lines 201-212):

```ts
  // Best-effort version read (cached npx → fast).
  let ccusageVersion = "";
  try {
    const { stdout } = await execFileAsync(
      IS_WIN ? "npx.cmd" : "npx",
      ["--yes", CCUSAGE_PKG, "--version"],
      { timeout: 30_000, shell: IS_WIN },
    );
    ccusageVersion = stdout.trim();
  } catch {
    // optional — ignore
  }
```

with:

```ts
  // Best-effort version read (cached npx → fast). Uses the active spec so the
  // reported version matches whatever actually collected the data.
  let ccusageVersion = "";
  try {
    ccusageVersion = (await invokeCcusage(["--version"])).trim();
  } catch {
    // optional — ignore
  }
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter claude-warriors test -- ccusage`
Expected: PASS (5 tests).

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter claude-warriors typecheck`
Expected: no errors. (If tsc flags an unused `IS_WIN` import — it is still used by `defaultRunner` — there should be none.)

- [ ] **Step 8: Commit**

```bash
git add packages/cli/src/ccusage.ts packages/cli/tests/ccusage.test.ts
git commit -m "feat(cli): fall back to known-good ccusage when the primary is broken (dyld crash or ETARGET)"
```

---

### Task 3: CLI — daemon backoff

**Files:**
- Create: `packages/cli/src/backoff.ts`
- Test: `packages/cli/tests/backoff.test.ts` (new)
- Modify: `packages/cli/src/daemon.ts` (import; `failStreak` area line 42; ok/fail/catch branches; `schedule` lines 117-126; heartbeat lines 145-148)

- [ ] **Step 1: Write the failing test**

Create `packages/cli/tests/backoff.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { nextBackoffMs, shouldSync } from "../src/backoff.js";

describe("nextBackoffMs", () => {
  it("no wait until the first failure", () => {
    expect(nextBackoffMs(0)).toBe(0);
    expect(nextBackoffMs(-1)).toBe(0);
  });
  it("grows exponentially from 1 minute", () => {
    expect(nextBackoffMs(1)).toBe(60_000);
    expect(nextBackoffMs(2)).toBe(300_000);
    expect(nextBackoffMs(3)).toBe(1_500_000);
  });
  it("caps at 30 minutes", () => {
    expect(nextBackoffMs(4)).toBe(1_800_000);
    expect(nextBackoffMs(50)).toBe(1_800_000);
  });
});

describe("shouldSync", () => {
  it("allows when the cooldown has elapsed", () => {
    expect(shouldSync(1000, 1000)).toBe(true);
    expect(shouldSync(1001, 1000)).toBe(true);
  });
  it("blocks while still in cooldown", () => {
    expect(shouldSync(999, 1000)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter claude-warriors test -- backoff`
Expected: FAIL — `../src/backoff.js` does not exist.

- [ ] **Step 3: Create `backoff.ts`**

Create `packages/cli/src/backoff.ts`:

```ts
// Exponential backoff for the sync daemon: when ccusage or the network is hard
// down, stop hammering (and stop spamming telemetry). Reset on first success.
const BASE_MS = 60_000; // first cooldown: 1 minute
const FACTOR = 5; // 1m → 5m → 25m → capped
const CAP_MS = 30 * 60_000; // never wait more than 30 minutes

/** Cooldown after `failStreak` consecutive hard failures (0 ⇒ no wait). */
export function nextBackoffMs(failStreak: number): number {
  if (failStreak <= 0) return 0;
  const ms = BASE_MS * Math.pow(FACTOR, failStreak - 1);
  return Math.min(ms, CAP_MS);
}

/** Whether a sync is allowed now, given the next-allowed timestamp. */
export function shouldSync(now: number, nextAllowedSyncAt: number): boolean {
  return now >= nextAllowedSyncAt;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter claude-warriors test -- backoff`
Expected: PASS (5 tests).

- [ ] **Step 5: Wire backoff into the daemon — import + state**

In `packages/cli/src/daemon.ts`, add the import after the existing `./selfupdate.js` import (line 9):

```ts
import { nextBackoffMs, shouldSync } from "./backoff.js";
```

Then, right after `let failStreak = 0;` (line 42), add:

```ts
  // While > now, syncs are suppressed (backoff after hard failures).
  let nextAllowedSyncAt = 0;
```

- [ ] **Step 6: Wire backoff into the success / failure branches**

In `syncNow`, in the success branch, change (line 66-67):

```ts
      if (res.data?.ok) {
        failStreak = 0;
```
to:
```ts
      if (res.data?.ok) {
        failStreak = 0;
        nextAllowedSyncAt = 0;
```

In the status-failure branch, change (lines 95-97):

```ts
        log(`sync skipped (${reason}) — status ${res.status}`);
        failStreak += 1;
        if (failStreak === 3) void postTelemetry("sync_failed", { status: res.status, reason });
```
to:
```ts
        log(`sync skipped (${reason}) — status ${res.status}`);
        failStreak += 1;
        nextAllowedSyncAt = Date.now() + nextBackoffMs(failStreak);
        if (failStreak === 3) void postTelemetry("sync_failed", { status: res.status, reason });
```

In the `catch` branch, change (lines 99-107):

```ts
    } catch (err) {
      log(`sync failed (${reason}) — ${err instanceof Error ? err.message : String(err)}`);
      failStreak += 1;
      if (failStreak === 3) {
```
to:
```ts
    } catch (err) {
      log(`sync failed (${reason}) — ${err instanceof Error ? err.message : String(err)}`);
      failStreak += 1;
      nextAllowedSyncAt = Date.now() + nextBackoffMs(failStreak);
      if (failStreak === 3) {
```

- [ ] **Step 7: Gate `schedule()` and the heartbeat on the cooldown**

Replace `schedule()` (lines 117-126):

```ts
  function schedule(reason: string): void {
    // Batch, don't reset: fire DEBOUNCE_MS after the FIRST event in a burst.
    // Resetting on every fs event starved syncs during continuous agent
    // activity (the timer never fired until a 12s quiet gap appeared).
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      void syncNow(reason);
    }, DEBOUNCE_MS);
  }
```
with:
```ts
  function schedule(reason: string): void {
    // Batch, don't reset: fire DEBOUNCE_MS after the FIRST event in a burst.
    // Resetting on every fs event starved syncs during continuous agent
    // activity (the timer never fired until a 12s quiet gap appeared).
    if (timer) return;
    if (!shouldSync(Date.now(), nextAllowedSyncAt)) return; // in backoff cooldown
    timer = setTimeout(() => {
      timer = null;
      void syncNow(reason);
    }, DEBOUNCE_MS);
  }
```

Replace the heartbeat `setInterval` (lines 145-148):

```ts
  setInterval(() => {
    void syncNow("heartbeat");
    void checkForUpdate();
  }, Math.max(1, heartbeatMin) * 60_000);
```
with:
```ts
  setInterval(() => {
    if (shouldSync(Date.now(), nextAllowedSyncAt)) void syncNow("heartbeat");
    void checkForUpdate();
  }, Math.max(1, heartbeatMin) * 60_000);
```

- [ ] **Step 8: Typecheck + full CLI tests**

Run: `pnpm --filter claude-warriors typecheck && pnpm --filter claude-warriors test`
Expected: no type errors; all tests pass.

- [ ] **Step 9: Commit**

```bash
git add packages/cli/src/backoff.ts packages/cli/tests/backoff.test.ts packages/cli/src/daemon.ts
git commit -m "feat(cli): back off the sync daemon after hard failures"
```

---

### Task 4: CLI — decouple self-update rollback from external health + flush rollback telemetry

**Files:**
- Modify: `packages/cli/src/selfupdate.ts` (add `markBuildAlive` after `markUpdateSuccess` line 111; make `selfUpdateBootCheck` async + await the rollback beacon)
- Modify: `packages/cli/src/daemon.ts` (import; `syncNow` `finally`, lines 108-114)
- Modify: `packages/cli/src/cli.ts` (await `selfUpdateBootCheck()` at lines 353, 364, 370)
- Test: `packages/cli/tests/selfupdate.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/cli/tests/selfupdate.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { markBuildAlive } from "../src/selfupdate.js";

// buildId() returns "dev" under vitest (no __BUILD_ID__ define), so the markers
// we write must use "dev" to match the running build.
let dir: string;
let cliPath: string;
let marker: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ccw-selfupdate-"));
  cliPath = join(dir, "cli.js");
  marker = join(dir, "update-pending.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("markBuildAlive", () => {
  it("clears the pending marker for the current build", () => {
    writeFileSync(marker, JSON.stringify({ buildId: "dev", fromBuild: "old", starts: 2 }));
    markBuildAlive(cliPath);
    expect(existsSync(marker)).toBe(false);
  });

  it("leaves a different build's marker untouched (rollback still possible)", () => {
    writeFileSync(marker, JSON.stringify({ buildId: "some-other-build", fromBuild: "old", starts: 2 }));
    markBuildAlive(cliPath);
    expect(existsSync(marker)).toBe(true);
  });

  it("is a no-op when there is no marker", () => {
    expect(() => markBuildAlive(cliPath)).not.toThrow();
    expect(existsSync(marker)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter claude-warriors test -- selfupdate`
Expected: FAIL — `markBuildAlive` is not exported.

- [ ] **Step 3: Add `markBuildAlive` to selfupdate.ts**

In `packages/cli/src/selfupdate.ts`, immediately after the `markUpdateSuccess` function (after its closing brace on line 111), add:

```ts
/**
 * Call at the END of every sync cycle (success OR failure). Reaching here proves
 * the freshly-installed bundle's daemon path executes without crashing, so a
 * failed sync (ccusage/network/server down) is NOT the build's fault. Clears the
 * pending-rollback marker WITHOUT the self_update_applied telemetry. A genuine
 * boot/daemon-path crash exits before this runs, so selfUpdateBootCheck still
 * rolls back actually-broken bundles. The cliPath param exists for testing.
 */
export function markBuildAlive(cliPath: string | null = installedCliPath()): void {
  if (!cliPath) return;
  const marker = readMarker(cliPath);
  if (marker && marker.buildId === buildId()) {
    try {
      unlinkSync(markerPath(cliPath));
    } catch {
      /* already gone */
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter claude-warriors test -- selfupdate`
Expected: PASS (3 tests).

- [ ] **Step 5: Call `markBuildAlive` from the daemon's sync `finally`**

In `packages/cli/src/daemon.ts`, update the import on line 9 from:

```ts
import { maybeSelfUpdate, markUpdateSuccess } from "./selfupdate.js";
```
to:
```ts
import { maybeSelfUpdate, markUpdateSuccess, markBuildAlive } from "./selfupdate.js";
```

Then update the `finally` block in `syncNow` (lines 108-114):

```ts
    } finally {
      syncing = false;
      if (pending) {
        pending = false;
        schedule("queued change");
      }
    }
```
to:
```ts
    } finally {
      syncing = false;
      // We ran a full sync cycle without crashing → this build is alive even if
      // the sync itself failed for external reasons. Clears any rollback marker.
      markBuildAlive();
      if (pending) {
        pending = false;
        schedule("queued change");
      }
    }
```

- [ ] **Step 6: Typecheck + full CLI tests**

Run: `pnpm --filter claude-warriors typecheck && pnpm --filter claude-warriors test`
Expected: no type errors; all CLI tests pass (ccusage + backoff + selfupdate).

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/selfupdate.ts packages/cli/src/daemon.ts packages/cli/tests/selfupdate.test.ts
git commit -m "fix(cli): don't roll back a good build when sync fails for external reasons"
```

- [ ] **Step 8: Flush the rollback telemetry before exit — make `selfUpdateBootCheck` async**

`self_update_rollback` has 0 events in PostHog because the beacon is fire-and-forget and `process.exit(1)` runs on the next line. In `packages/cli/src/selfupdate.ts`, change the signature (line 70) from:

```ts
export function selfUpdateBootCheck(): void {
```
to:
```ts
export async function selfUpdateBootCheck(): Promise<void> {
```

Then in the rollback branch, change (lines ~79-84):

```ts
      copyFileSync(prevPath(cliPath), cliPath);
      unlinkSync(markerPath(cliPath));
      void postTelemetry("self_update_rollback", { fromBuild: marker.fromBuild, toBuild: marker.buildId });
      console.error(`ccwarriors: build ${marker.buildId} failed to sync — rolled back to ${marker.fromBuild}`);
      // Exit non-zero: launchd relaunches into the restored bundle; an
      // interactive user sees the message and can simply re-run.
      process.exit(1);
```
to:
```ts
      copyFileSync(prevPath(cliPath), cliPath);
      unlinkSync(markerPath(cliPath));
      console.error(`ccwarriors: build ${marker.buildId} failed to sync — rolled back to ${marker.fromBuild}`);
      // Await the beacon (4s timeout) so the rollback is actually observable —
      // a fire-and-forget here never flushed before the exit below.
      await postTelemetry("self_update_rollback", { fromBuild: marker.fromBuild, toBuild: marker.buildId });
      // Exit non-zero: launchd relaunches into the restored bundle; an
      // interactive user sees the message and can simply re-run.
      process.exit(1);
```

- [ ] **Step 9: Await `selfUpdateBootCheck()` at its three call sites**

In `packages/cli/src/cli.ts`, the `watch` (line 353), `daemon` (line 364), and `sync` (line 370) blocks call `selfUpdateBootCheck();` un-awaited. Change each of the three to:

```ts
    await selfUpdateBootCheck();
```

(They are already inside `async function main()`, so `await` is valid.)

- [ ] **Step 10: Typecheck + full CLI tests**

Run: `pnpm --filter claude-warriors typecheck && pnpm --filter claude-warriors test`
Expected: no type errors (the `Promise<void>` return is now awaited everywhere); all CLI tests pass. The rollback-exit path itself isn't unit-tested (it calls `process.exit`); it's exercised in the battle-test and verified by the typecheck that all callers await.

- [ ] **Step 11: Commit**

```bash
git add packages/cli/src/selfupdate.ts packages/cli/src/cli.ts
git commit -m "fix(cli): flush self_update_rollback telemetry before exit"
```

---

### Task 5: CLI — daemon 401 re-auth

**Files:**
- Create: `packages/cli/src/authstate.ts` (pure `resolveAuthAction`)
- Test: `packages/cli/tests/authstate.test.ts` (new)
- Modify: `packages/cli/src/daemon.ts` (mutable `token`; `reloadToken`; `authPaused`; 401 branch in `syncNow`; `schedule` + heartbeat guards)

- [ ] **Step 1: Write the failing test**

Create `packages/cli/tests/authstate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveAuthAction } from "../src/authstate.js";

describe("resolveAuthAction", () => {
  it("resumes when a different, non-null token is on disk", () => {
    expect(resolveAuthAction("old-token", "new-token")).toBe("resume");
  });
  it("pauses when the disk token is unchanged", () => {
    expect(resolveAuthAction("same-token", "same-token")).toBe("pause");
  });
  it("pauses when there is no token on disk", () => {
    expect(resolveAuthAction("old-token", null)).toBe("pause");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter claude-warriors test -- authstate`
Expected: FAIL — `../src/authstate.js` does not exist.

- [ ] **Step 3: Create `authstate.ts`**

Create `packages/cli/src/authstate.ts`:

```ts
// The daemon got a 401. If a newer token is on disk (the user re-logged-in
// elsewhere) we adopt it and resume; otherwise the token is genuinely expired
// and we pause until a re-login lands.
export function resolveAuthAction(currentToken: string, diskToken: string | null): "resume" | "pause" {
  return diskToken && diskToken !== currentToken ? "resume" : "pause";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter claude-warriors test -- authstate`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire 401 handling into the daemon — imports + state + mutable token**

In `packages/cli/src/daemon.ts`, add to the import added in Task 3:

```ts
import { nextBackoffMs, shouldSync } from "./backoff.js";
import { resolveAuthAction } from "./authstate.js";
```

`loadConfig` is already imported from `./config.js`. Change the token binding (currently `const token = cfg.token;`, around line 34) to mutable, and add auth state next to `nextAllowedSyncAt`:

```ts
  let token = cfg.token;
```
```ts
  // Set true after a 401 with no fresher token on disk; the heartbeat clears it
  // when a re-login appears. Suppresses syncs without thrashing launchd.
  let authPaused = false;
```

Add a token-refresh helper inside `runDaemon` (near `syncNow`):

```ts
  async function reloadToken(): Promise<string | null> {
    try {
      const c = await loadConfig();
      return c?.token ?? null;
    } catch {
      return null;
    }
  }
```

- [ ] **Step 6: Add the 401 branch in `syncNow`**

In `syncNow`, the `postIngest` result is handled by `if (res.data?.ok) … else if (res.status === 429) … else …`. Insert a dedicated 401 branch BEFORE the final `else` (between the 429 branch and the generic failure `else`):

```ts
      } else if (res.status === 401) {
        // Token rotated/expired. Adopt a fresher on-disk token (user re-logged-in
        // elsewhere) and retry without penalty; otherwise pause until re-login.
        const disk = await reloadToken();
        if (resolveAuthAction(token, disk) === "resume") {
          token = disk as string;
          log("token refreshed from disk — retrying");
          schedule(`auth-refresh ${reason}`);
        } else if (!authPaused) {
          authPaused = true;
          log("token expired — run `ccwarriors login` to re-enable autosync");
          void postTelemetry("auth_expired", { reason });
        }
```

(The existing generic `else` that does `failStreak += 1` / backoff now only handles non-401, non-429 statuses.)

- [ ] **Step 7: Gate `schedule()` and the heartbeat on `authPaused` (with auto-resume)**

In `schedule()` (already gated on backoff from Task 3), add an auth guard as the first line of the body:

```ts
  function schedule(reason: string): void {
    if (authPaused) return; // paused on auth — heartbeat handles recovery
    // Batch, don't reset: fire DEBOUNCE_MS after the FIRST event in a burst.
```

Replace the heartbeat `setInterval` — which after Task 3 reads:

```ts
  setInterval(() => {
    if (shouldSync(Date.now(), nextAllowedSyncAt)) void syncNow("heartbeat");
    void checkForUpdate();
  }, Math.max(1, heartbeatMin) * 60_000);
```
with an async callback that also recovers from `authPaused`:
```ts
  setInterval(() => {
    void (async () => {
      if (authPaused) {
        const disk = await reloadToken();
        if (resolveAuthAction(token, disk) === "resume") {
          token = disk as string;
          authPaused = false;
          log("re-authenticated — resuming autosync");
        } else {
          return; // still paused; don't sync
        }
      }
      if (shouldSync(Date.now(), nextAllowedSyncAt)) void syncNow("heartbeat");
    })();
    void checkForUpdate();
  }, Math.max(1, heartbeatMin) * 60_000);
```

- [ ] **Step 8: Typecheck + full CLI tests**

Run: `pnpm --filter claude-warriors typecheck && pnpm --filter claude-warriors test`
Expected: no type errors; all CLI tests pass (ccusage + backoff + selfupdate + authstate).

- [ ] **Step 9: Commit**

```bash
git add packages/cli/src/authstate.ts packages/cli/tests/authstate.test.ts packages/cli/src/daemon.ts
git commit -m "feat(cli): recover the daemon from a 401 instead of backing off forever"
```

---

### Task 6: Full verify + local battle-test (REQUIRED before PR)

**Files:** none (build + manual verification)

- [ ] **Step 1: Full workspace verify**

Run: `pnpm verify`
Expected: `pnpm -r test && pnpm -r typecheck && pnpm -r build` all green across server + cli + web.

- [ ] **Step 2: Confirm the broken `20.0.10` still reproduces the dyld crash on this machine**

Upstream `latest` is now `20.0.11` (fixed), so `npx ccusage@20` resolves to a healthy binary; we reproduce the failure deterministically by pinning the broken version. Run:
```bash
npx --yes ccusage@20.0.10 --version 2>&1 | head -2
```
Expected: still crashes with `dyld: Library not loaded: /nix/store/…libiconv`. (If even `20.0.10` no longer crashes here — e.g. cache cleared and re-fetched differently — note it and rely on the unit tests, which simulate the exact error shape.)

- [ ] **Step 3: Battle-test the built daemon forcing the broken primary**

Runs the freshly-built daemon in the foreground for ~80s using the real enlisted config, with the primary spec forced to the broken `ccusage@20.0.10` via `CCWARRIORS_CCUSAGE_PKG`. This proves the end-to-end fallback path (broken primary → degrade to `20.0.6` → real sync). `CCWARRIORS_NO_UPDATE=1` stops it self-updating away; telemetry stays ON so the real `ccusage_fallback` event is exercised. The existing launchd daemon keeps running — harmless (server dedupes by machineId).

Run:
```bash
CCWARRIORS_CCUSAGE_PKG=ccusage@20.0.10 CCWARRIORS_NO_UPDATE=1 \
  node packages/cli/dist/cli.js daemon 1 > /tmp/ccw-battletest.log 2>&1 &
BT=$!; sleep 80; kill "$BT" 2>/dev/null || true
echo "=== fallback / sync result ==="
grep -E "synced \(|sync failed|sync skipped|fallback" /tmp/ccw-battletest.log | head
echo "=== flap check: count of dyld/sync-failed lines (should be small, not growing) ==="
grep -c -E "dyld|sync failed" /tmp/ccw-battletest.log
```
Expected:
- At least one `synced (startup) — … · rank #…` line — proving the forced-broken primary fell back to `ccusage@20.0.6`, produced real data, and ingest succeeded.
- The dyld/sync-failed count is small (the first primary attempt logs once before the fallback engages) and does NOT keep growing for the whole 80s — proving the flap is gone.

- [ ] **Step 4: Confirm the fallback telemetry landed**

Run:
```bash
curl -fsS -m 10 https://api.ccwarriors.xyz/telemetry/failures | python3 -m json.tool
```
Expected: no NEW `sync_failed` darwin entries accumulating from the battle-test window (the daemon now succeeds via fallback). `ccusage_fallback` is non-paging so it won't appear here — that's correct; it's visible in PostHog/Railway logs.

- [ ] **Step 5: Battle-test the daemon 401 re-auth path**

Force a 401 by pointing the daemon at a junk token via a throwaway config home, then confirm it pauses (not flaps) and fires `auth_expired`. This uses an isolated `CCWARRIORS_HOME` so the real credentials are untouched.

Run:
```bash
BTH="$(mktemp -d)"; mkdir -p "$BTH"
# Minimal enlisted config with a deliberately invalid token.
printf '{"token":"invalid-token-for-battletest","login":"battletest"}\n' > "$BTH/config.json"
CCWARRIORS_HOME="$BTH" CCWARRIORS_NO_UPDATE=1 node packages/cli/dist/cli.js daemon 1 > /tmp/ccw-401test.log 2>&1 &
BT=$!; sleep 20; kill "$BT" 2>/dev/null || true
echo "=== expect a single 'token expired' pause, not a flap ==="
grep -E "token expired|re-authenticated|sync skipped" /tmp/ccw-401test.log | head
rm -rf "$BTH"
```
Expected: one `token expired — run \`ccwarriors login\`…` line (the pause), and NOT a repeating burst of 401 sync attempts. (Confirm the config path/shape matches `loadConfig` in `packages/cli/src/config.ts`; adjust the file name/fields if it differs.)

- [ ] **Step 6: Record battle-test results**

Capture the key lines from `/tmp/ccw-battletest.log` (the `synced` line + the flap count) and `/tmp/ccw-401test.log` (the single pause line) to paste into the PR description as evidence.

---

### Task 7: Open the PR (only after Task 6 passes)

**Files:** none (git/gh)

- [ ] **Step 1: Push the branch**

Run:
```bash
git push -u origin fix/ccusage-resilience
```

- [ ] **Step 2: Open the PR with battle-test evidence**

Run:
```bash
gh pr create --repo distroinfinity/ccwarriors --base main --head fix/ccusage-resilience \
  --title "fix(cli): survive broken upstream ccusage, recover from 401, stop false self-update rollbacks" \
  --body "$(cat <<'EOF'
## What

The autosync daemon ran `npx ccusage@20`, which resolved to `ccusage@20.0.10` whose
published darwin-arm64 prebuilt links a dead `/nix/store/…libiconv` and crashes at load.
Every sync failed → `sync_failed` telemetry burst (all darwin) → PostHog alert. Installs
were never affected (`installFailuresLastHour: 0`, all prod health checks green).

PostHog (7-day) confirmed the breakdown: 84 transient `fetch failed`, ~110 ccusage
failures (16 explicit dyld crashes — nix AND homebrew variants — 9 ETARGET, rest truncated),
6 stale-token 401s, plus 552 `self_update_applied` across 48 builds (~12 machines). The
self-update rollback path has 0 events because its telemetry never flushed before exit.

## Changes
- **ccusage fallback** (`packages/cli/src/ccusage.ts`): try `ccusage@20`; if the primary is
  broken — native load/exec crash (nix or homebrew dyld) OR npm ETARGET — degrade once to the
  known-good `ccusage@20.0.6` and reuse it for the process. Latest features when healthy,
  automatic recovery when a bad patch ships.
- **daemon backoff** (`packages/cli/src/backoff.ts` + `daemon.ts`): exponential cooldown
  (1m→5m→25m, cap 30m) after hard failures — no more ~15s flapping.
- **daemon 401 re-auth** (`packages/cli/src/authstate.ts` + `daemon.ts`): on a 401 the daemon
  adopts a fresher on-disk token if the user re-logged-in, else pauses (one `auth_expired`)
  and auto-resumes when a re-login lands — instead of backing off forever on a stale token.
- **self-update decoupling** (`selfupdate.ts` + `daemon.ts`): `markBuildAlive()` clears the
  rollback marker once the new bundle proves its daemon path runs, so a good build is no
  longer rolled back when ccusage/network/server is down. Genuine boot crashes still roll back.
- **rollback observability** (`selfupdate.ts` + `cli.ts`): `selfUpdateBootCheck` is now async
  and awaits the `self_update_rollback` beacon before `process.exit` (it never flushed before).
- **telemetry** (`apps/server/src/routes/telemetry.ts`): non-paging `ccusage_fallback` +
  `auth_expired` events for early warning of bad upstream patches / expired tokens.

## Testing
- New vitest suites: ccusage fallback (6, incl. ETARGET), backoff (5), authstate (3),
  selfupdate markBuildAlive (3); server telemetry enum test. `pnpm verify` green.
- Battle-tested locally against this machine's real broken `ccusage@20.0.10`: built daemon
  fell back to 20.0.6 and synced successfully, no flapping; forced 401 paused once and didn't
  flap. (Evidence below.)

## Battle-test evidence
```
<paste the `synced (...)` line + flap count from /tmp/ccw-battletest.log, and the
single `token expired` line from /tmp/ccw-401test.log>
```

## Notes
- Upstream `ccusage@20.0.11` (current `latest`) already links `/usr/lib/libiconv` and is
  fixed — only `20.0.10` was broken. So this is defense-in-depth for the next bad patch, not
  a workaround for an open bug. No upstream issue filed.
- Primary spec is overridable via `CCWARRIORS_CCUSAGE_PKG` (ops escape-hatch; the battle-test
  uses it to force `20.0.10`).

## Follow-up
- Add `machineId` to daemon telemetry (today daemon events are anonymous → 1 person_id).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Report the PR URL to the user.**

---

## Self-review notes

- **Spec coverage:** Component 1 → Task 2 (incl. ETARGET); Component 2 → Task 3; Component 3 → Task 4 (steps 1-7); Component 4 (`ccusage_fallback` + `auth_expired`) → Task 1; Component 5 (daemon 401 re-auth) → Task 5; Component 6 (rollback flush) → Task 4 (steps 8-11); battle-test rollout rule → Task 6; PR-not-merge rule → Task 7. All covered.
- **Telemetry paging:** `ccusage_fallback` and `auth_expired` added to the enum only, NOT to `failureEvents` — matches the spec ("never enters the rolling window").
- **Type/name consistency:** `invokeCcusage`, `resetCcusageStateForTest`, `CcusageRunner`, `isCcusageBroken`, `nextBackoffMs`, `shouldSync`, `markBuildAlive`, `resolveAuthAction` are defined in the task that first references them and used identically thereafter. (Detection fn renamed `isNativeFailure` → `isCcusageBroken` consistently in Task 2.)
- **daemon.ts edit ordering:** Tasks 3, 4 (step 5), and 5 all modify `daemon.ts`. They are applied in order; Task 5's heartbeat block explicitly supersedes the Task-3 heartbeat edit (noted inline). The 401 branch in `syncNow` sits between the existing 429 branch and the generic failure `else`.
- **Backoff curve:** spec said "~1m→5m→15m, cap 30m"; implemented as factor-5 (1m→5m→25m→cap 30m) — simpler closed form, same shape and cap; tests pin the exact values.
- **Mutable token:** `const token` → `let token` in the daemon; the closures (`syncNow`, heartbeat) read the current binding, so an adopted token takes effect on the next cycle.
