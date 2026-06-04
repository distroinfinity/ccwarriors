import { defineConfig } from "tsup";

// Build id: Vercel commit SHA in prod, CCW_BUILD_ID override for local
// self-update testing, dated fallback otherwise. The `ccw-build:` banner line
// is machine-read by the server's /cli/version endpoint and by the
// self-updater's download verification — keep the format stable.
const BUILD_ID =
  process.env["CCW_BUILD_ID"] ??
  process.env["VERCEL_GIT_COMMIT_SHA"]?.slice(0, 7) ??
  `local-${new Date().toISOString().slice(0, 10)}`;

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
