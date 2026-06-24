// Single source of truth for "what CLI build is this server serving?". The CLI
// bundle is stamped by tsup with a `// ccw-build:<id>` banner; the self-updater
// check (/cli/version), the web outdated-client nudge (/me), and fleet
// telemetry (ingest) all read it from the same on-disk bundle so they never
// disagree about which build is current.
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// Walk up from cwd until the workspace root (works from apps/server in dev,
// tests, and the Railway container, all of which run inside the monorepo).
export function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

/** Absolute path of the built CLI bundle the fleet downloads as /cli.js. */
export function cliBundlePath(): string {
  return path.join(repoRoot(), "packages", "cli", "dist", "cli.js");
}

// Build id embedded in the served bundle. Cached per (file, mtime) so the
// daemon fleet's polling doesn't re-read the file on every hit. The path is
// part of the key: two different bundles can share an mtimeMs (built in the
// same second), so keying on mtime alone could return one file's id for another.
let cachedBuild: { file: string; mtimeMs: number; buildId: string } | null = null;

// Build ids are tsup's `// ccw-build:<id>` banner: a 7-char commit SHA in
// prod, or `local-<date>` for dev/CI builds (hence `.` and `-` in the charset).
// The health check uses a tighter `[0-9a-f]{7}` to reject non-SHA prod builds.
/** Read the `ccw-build:` id from a specific bundle file. Throws if unreadable. */
export function readBuildId(file: string): string {
  const stat = statSync(file);
  if (cachedBuild && cachedBuild.file === file && cachedBuild.mtimeMs === stat.mtimeMs) {
    return cachedBuild.buildId;
  }
  const head = readFileSync(file, "utf8").slice(0, 500);
  const m = head.match(/\/\/ ccw-build:([\w.-]+)/);
  const buildId = m?.[1] ?? "unknown";
  cachedBuild = { file, mtimeMs: stat.mtimeMs, buildId };
  return buildId;
}

/**
 * The build id this server is currently serving, or "unknown" when the bundle
 * is missing/unreadable. Never throws — callers on the sync/render path must
 * not break on a missing artifact.
 */
export function currentBuildId(): string {
  try {
    const file = cliBundlePath();
    if (!existsSync(file)) return "unknown";
    return readBuildId(file);
  } catch {
    return "unknown";
  }
}

/**
 * Whether a synced client should be nudged to reinstall. Single source of truth
 * shared by /me (web nudge) and ingest (fleet telemetry) so they never diverge.
 * Callers gate on "has synced at least once" themselves.
 *
 * A client is outdated when it is NOT provably on the latest build:
 *   - `!hasBreakdown` — a pre-self-update (legacy) client. It never sent a
 *     multi-tool breakdown, so it predates the self-updater entirely and can
 *     only be reached by a reinstall. Flagged regardless of `latestBuildId`.
 *   - `clientBuildId !== latestBuildId` — a self-update-capable client that
 *     isn't on the current build (stalled updater, or — same release as the
 *     breakdown — a missing/dev build id). Build ids are commit SHAs, not
 *     orderable, so "≠ latest" is the only signal: anything but the latest.
 *
 * Guarded on `latestBuildId !== "unknown"`: when the server can't read its own
 * bundle we don't know what "latest" is, so we must NOT flag the whole fleet on
 * a mismatch — only the unambiguous legacy signal still applies.
 */
export function isBuildOutdated(opts: {
  hasBreakdown: boolean;
  clientBuildId: string | null;
  latestBuildId: string;
}): boolean {
  if (!opts.hasBreakdown) return true;
  if (opts.latestBuildId === "unknown") return false;
  return opts.clientBuildId !== opts.latestBuildId;
}
