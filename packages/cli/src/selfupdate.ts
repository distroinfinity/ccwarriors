// Atomic self-update. The installed CLI is a single bundle at
// ~/.ccwarriors/cli.js, run by launchd (macOS, KeepAlive) or cron (Linux).
// On each sync/heartbeat we compare our build id with the server's, and when
// they differ: download → validate → backup → atomic rename. Every step is
// guarded so a bad bundle or a flaky network can never brick the fleet:
//   - server kill switch: /cli/version can answer updateEnabled=false
//   - validate-before-swap: the downloaded bundle must print the advertised id
//   - rollback: cli.js.prev is restored if the new build can't complete a sync
//   - loop guard: one attempt per build id per process
//   - user opt-out: CCWARRIORS_NO_UPDATE=1
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  copyFileSync,
  existsSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { API_BASE, postTelemetry } from "./core.js";

const execFileAsync = promisify(execFile);

declare const __BUILD_ID__: string;
const buildId = (): string => (typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev");

// How many process starts the marker survives before we assume the new build
// is broken and roll back. Generous: transient network errors shouldn't revert.
const MAX_STARTS_BEFORE_ROLLBACK = 5;

let attemptedBuild: string | null = null;

export type UpdateOutcome = "updated" | "current" | "skipped" | "failed";

/** Path of the installed bundle this process is running from, or null when not installed (dev/tsx). */
function installedCliPath(): string | null {
  try {
    const script = realpathSync(process.argv[1] ?? "");
    return path.basename(script) === "cli.js" ? script : null;
  } catch {
    return null;
  }
}

const markerPath = (cliPath: string) => path.join(path.dirname(cliPath), "update-pending.json");
const prevPath = (cliPath: string) => `${cliPath}.prev`;

interface UpdateMarker {
  buildId: string;
  fromBuild: string;
  starts: number;
}

function readMarker(cliPath: string): UpdateMarker | null {
  try {
    return JSON.parse(readFileSync(markerPath(cliPath), "utf8")) as UpdateMarker;
  } catch {
    return null;
  }
}

/**
 * Run FIRST on every process start. If we're the freshly-installed build and
 * we've failed to complete a sync after several starts, restore the previous
 * bundle and exit so launchd/cron relaunches into the known-good build.
 */
export function selfUpdateBootCheck(): void {
  const cliPath = installedCliPath();
  if (!cliPath) return;
  const marker = readMarker(cliPath);
  if (!marker || marker.buildId !== buildId()) return;

  if (marker.starts >= MAX_STARTS_BEFORE_ROLLBACK && existsSync(prevPath(cliPath))) {
    try {
      copyFileSync(prevPath(cliPath), cliPath);
      unlinkSync(markerPath(cliPath));
      void postTelemetry("self_update_rollback", { fromBuild: marker.fromBuild, toBuild: marker.buildId });
      console.error(`ccwarriors: build ${marker.buildId} failed to sync — rolled back to ${marker.fromBuild}`);
      // Exit non-zero: launchd relaunches into the restored bundle; an
      // interactive user sees the message and can simply re-run.
      process.exit(1);
    } catch {
      // Rollback itself failed — keep running, the next sync may still work.
    }
    return;
  }

  try {
    writeFileSync(markerPath(cliPath), JSON.stringify({ ...marker, starts: marker.starts + 1 }));
  } catch {
    /* marker is best-effort */
  }
}

/** Call after any successful sync: the running build is good, clear update state. */
export function markUpdateSuccess(): void {
  const cliPath = installedCliPath();
  if (!cliPath) return;
  const marker = readMarker(cliPath);
  if (marker && marker.buildId === buildId()) {
    try {
      unlinkSync(markerPath(cliPath));
    } catch {
      /* already gone */
    }
    void postTelemetry("self_update_applied", { fromBuild: marker.fromBuild, toBuild: marker.buildId });
  }
}

async function fail(step: string, toBuild: string, detail?: string): Promise<"failed"> {
  void postTelemetry("self_update_failed", {
    step,
    fromBuild: buildId(),
    toBuild,
    ...(detail ? { detail: detail.slice(0, 120) } : {}),
  });
  return "failed";
}

/**
 * Check the server for a newer build and atomically install it.
 * Never throws. Callers decide what to do with "updated" (daemon: exit(0) so
 * launchd restarts on the new bundle; sync/cron: next run picks it up).
 */
export async function maybeSelfUpdate(): Promise<UpdateOutcome> {
  if (process.env["CCWARRIORS_NO_UPDATE"] === "1") return "skipped";
  const cliPath = installedCliPath();
  if (!cliPath) return "skipped"; // dev checkout — never touch it

  let remote: { buildId?: string; updateEnabled?: boolean };
  try {
    const res = await fetch(`${API_BASE}/cli/version`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return "skipped";
    remote = (await res.json()) as typeof remote;
  } catch {
    return "skipped";
  }

  const target = remote.buildId;
  if (!target || target === "unknown" || remote.updateEnabled === false) return "skipped";
  if (target === buildId()) return "current";
  if (attemptedBuild === target) return "skipped"; // one attempt per build per process
  attemptedBuild = target;

  // 1. Download next to the live bundle (same dir → rename is atomic).
  // .mjs so the validation run is ESM regardless of the dir's package.json
  // marker — Node refuses unknown extensions like ".next" outright.
  const next = `${cliPath}.next.mjs`;
  try {
    const res = await fetch(`${API_BASE}/cli.js`, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return fail("download", target, `status ${res.status}`);
    const body = await res.text();
    // The bundle must self-identify as the advertised build — guards a stale
    // CDN or a torn deploy serving a mismatched file.
    if (!body.includes(`ccw-build:${target}`)) return fail("verify_download", target, "build id mismatch");
    writeFileSync(next, body, { mode: 0o755 });
  } catch (err) {
    return fail("download", target, err instanceof Error ? err.message : String(err));
  }

  // 2. Validate: the downloaded bundle must run and print its own id.
  try {
    const { stdout } = await execFileAsync(process.execPath, [next, "--version"], { timeout: 15_000 });
    if (!stdout.includes(target)) {
      unlinkSync(next);
      return fail("validate", target, `got: ${stdout.trim()}`);
    }
  } catch (err) {
    try {
      unlinkSync(next);
    } catch {
      /* best-effort cleanup */
    }
    return fail("validate", target, err instanceof Error ? err.message : String(err));
  }

  // 3. Backup + atomic swap + pending marker (cleared on first good sync).
  try {
    copyFileSync(cliPath, prevPath(cliPath));
    writeFileSync(
      markerPath(cliPath),
      JSON.stringify({ buildId: target, fromBuild: buildId(), starts: 0 } satisfies UpdateMarker),
    );
    renameSync(next, cliPath);
  } catch (err) {
    return fail("swap", target, err instanceof Error ? err.message : String(err));
  }

  return "updated";
}
