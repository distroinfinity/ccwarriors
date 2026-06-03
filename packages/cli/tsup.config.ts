import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
  define: {
    __BUILD_ID__: JSON.stringify(
      process.env["VERCEL_GIT_COMMIT_SHA"]?.slice(0, 7) ??
        `local-${new Date().toISOString().slice(0, 10)}`,
    ),
  },
});
