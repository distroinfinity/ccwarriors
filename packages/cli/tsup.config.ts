import { defineConfig } from "tsup";

// Build id: commit SHA in prod (Railway builds + serves the bundle the
// self-updater downloads; Vercel builds the copy at ccwarriors.xyz/cli.js —
// same commit, same id), CCW_BUILD_ID override for local self-update testing,
// dated fallback otherwise. Without the commit SHA, two same-day deploys
// would share a `local-<date>` id and the fleet would skip the second one.
// The `ccw-build:` banner line is machine-read by /cli/version and by the
// self-updater's download verification — keep the format stable.
const COMMIT_BUILD_ID =
  process.env["CCW_BUILD_ID"] ??
  process.env["RAILWAY_GIT_COMMIT_SHA"]?.slice(0, 7) ??
  process.env["VERCEL_GIT_COMMIT_SHA"]?.slice(0, 7);

// A `local-<date>` id can't propagate (two same-day deploys collide, and it
// never advances past the served build), so the fleet's self-update silently
// stalls. Fine for dev/CI; fatal in a real deploy. Refuse to stamp one when we
// detect we're building on Railway/Vercel but no commit SHA resolved.
const inDeploy = !!(
  process.env["RAILWAY_ENVIRONMENT"] ||
  process.env["RAILWAY_SERVICE_ID"] ||
  process.env["VERCEL"] ||
  process.env["VERCEL_ENV"]
);
if (inDeploy && !COMMIT_BUILD_ID) {
  throw new Error(
    "ccwarriors build: deploy environment detected but no commit SHA " +
      "(RAILWAY_GIT_COMMIT_SHA / VERCEL_GIT_COMMIT_SHA / CCW_BUILD_ID). Refusing to " +
      "stamp a non-propagating local-<date> build id that would stall fleet self-update.",
  );
}

const BUILD_ID = COMMIT_BUILD_ID ?? `local-${new Date().toISOString().slice(0, 10)}`;

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  banner: { js: `#!/usr/bin/env node\n// ccw-build:${BUILD_ID}` },
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
});
