import { Hono } from "hono";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { captureEvent } from "./telemetry.js";

// Fallback installer endpoints. The primary host (ccwarriors.xyz, Vercel) can
// be challenge-gated by Vercel's firewall, which 403s every curl/PowerShell
// client. Serving the same assets from this server (get.ccwarriors.xyz on
// Railway) keeps the install funnel alive regardless of Vercel policy.

// Origins to rewrite to the serving host (longest first so the apex match
// doesn't clobber the api subdomain).
const REWRITE_ORIGINS = ["https://api.ccwarriors.xyz", "https://ccwarriors.xyz"];

/** Channel ref (?ref=hn): lowercase slug only — it gets embedded in scripts. */
export function sanitizeRef(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const ref = raw.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 64);
  return ref || null;
}

// Walk up from cwd until the workspace root (works from apps/server in dev,
// tests, and the Railway container, all of which run inside the monorepo).
function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

const ASSETS = {
  "install.sh": { rel: path.join("apps", "web", "public", "install.sh"), type: "text/x-shellscript; charset=utf-8", rewrite: true },
  "install.ps1": { rel: path.join("apps", "web", "public", "install.ps1"), type: "text/plain; charset=utf-8", rewrite: true },
  "cli.js": { rel: path.join("packages", "cli", "dist", "cli.js"), type: "application/javascript; charset=utf-8", rewrite: false },
} as const;

// Build id embedded in the served cli.js bundle (tsup banner: `// ccw-build:<id>`).
// Drives the CLI's self-update check; cached per mtime so we don't re-read on
// every poll from the daemon fleet.
let cachedBuild: { mtimeMs: number; buildId: string } | null = null;

function readBuildId(file: string): string {
  const stat = statSync(file);
  if (cachedBuild && cachedBuild.mtimeMs === stat.mtimeMs) return cachedBuild.buildId;
  const head = readFileSync(file, "utf8").slice(0, 500);
  const m = head.match(/\/\/ ccw-build:([\w.-]+)/);
  const buildId = m?.[1] ?? "unknown";
  cachedBuild = { mtimeMs: stat.mtimeMs, buildId };
  return buildId;
}

export function installerRoute() {
  const app = new Hono();
  const root = repoRoot();

  // Self-update version check. CLI_UPDATE_ENABLED=0 is the central kill
  // switch: stops the whole fleet from updating without needing a deploy.
  app.get("/cli/version", (c) => {
    const file = path.join(root, ASSETS["cli.js"].rel);
    if (!existsSync(file)) return c.json({ error: "asset_unavailable" }, 503);
    const updateEnabled = !["0", "false"].includes(process.env["CLI_UPDATE_ENABLED"] ?? "");
    return c.json({ buildId: readBuildId(file), updateEnabled });
  });

  for (const [name, asset] of Object.entries(ASSETS)) {
    app.get(`/${name}`, (c) => {
      const file = path.join(root, asset.rel);
      if (!existsSync(file)) return c.json({ error: "asset_unavailable" }, 503);

      let body = readFileSync(file, "utf8");
      if (asset.rewrite) {
        // Point the script's default BASE at whichever host served it, so the
        // follow-up cli.js download stays on the working host.
        const url = new URL(c.req.url);
        const proto = c.req.header("x-forwarded-proto") ?? url.protocol.replace(":", "");
        const host = c.req.header("x-forwarded-host") ?? c.req.header("host") ?? url.host;
        for (const origin of REWRITE_ORIGINS) body = body.replaceAll(origin, `${proto}://${host}`);

        // Channel attribution: ?ref=hn is baked into the served script as the
        // CCWARRIORS_REF default, so beacons + enlistment attribute even though
        // the script runs far from the browser that carried the ref. Strict
        // whitelist — the value lands inside a shell/PowerShell script.
        const ref = sanitizeRef(c.req.query("ref"));
        if (ref) {
          body = body
            .replaceAll('${CCWARRIORS_REF:-}', `\${CCWARRIORS_REF:-${ref}}`) // install.sh
            .replaceAll('"%CCW_REF_DEFAULT%"', `"${ref}"`); // install.ps1
        }
        captureEvent(`${name === "install.ps1" ? "install_ps1" : "install_sh"}_download`, "anonymous", {
          ...(ref ? { ref } : {}),
        });
      }
      return c.body(body, 200, { "content-type": asset.type, "cache-control": "no-cache" });
    });
  }
  return app;
}
