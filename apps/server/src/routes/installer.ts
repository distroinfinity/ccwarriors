import { Hono } from "hono";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// Fallback installer endpoints. The primary host (ccwarriors.xyz, Vercel) can
// be challenge-gated by Vercel's firewall, which 403s every curl/PowerShell
// client. Serving the same assets from this server (get.ccwarriors.xyz on
// Railway) keeps the install funnel alive regardless of Vercel policy.

// Origins to rewrite to the serving host (longest first so the apex match
// doesn't clobber the api subdomain).
const REWRITE_ORIGINS = ["https://api.ccwarriors.xyz", "https://ccwarriors.xyz"];

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

export function installerRoute() {
  const app = new Hono();
  const root = repoRoot();

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
      }
      return c.body(body, 200, { "content-type": asset.type, "cache-control": "no-cache" });
    });
  }
  return app;
}
