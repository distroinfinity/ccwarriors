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

// Build id embedded in the served bundle. Cached per mtime so the daemon
// fleet's polling doesn't re-read the file on every hit.
let cachedBuild: { mtimeMs: number; buildId: string } | null = null;

/** Read the `ccw-build:` id from a specific bundle file. Throws if unreadable. */
export function readBuildId(file: string): string {
  const stat = statSync(file);
  if (cachedBuild && cachedBuild.mtimeMs === stat.mtimeMs) return cachedBuild.buildId;
  const head = readFileSync(file, "utf8").slice(0, 500);
  const m = head.match(/\/\/ ccw-build:([\w.-]+)/);
  const buildId = m?.[1] ?? "unknown";
  cachedBuild = { mtimeMs: stat.mtimeMs, buildId };
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
