import { Hono } from "hono";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { captureEvent } from "./telemetry.js";
import { repoRoot, readBuildId } from "../lib/build-id.js";

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

const ASSETS = {
  "install.sh": { rel: path.join("apps", "web", "public", "install.sh"), type: "text/x-shellscript; charset=utf-8", rewrite: true },
  "install.ps1": { rel: path.join("apps", "web", "public", "install.ps1"), type: "text/plain; charset=utf-8", rewrite: true },
  "cli.js": { rel: path.join("packages", "cli", "dist", "cli.js"), type: "application/javascript; charset=utf-8", rewrite: false },
} as const;

// Asset bodies cached per (file, mtime): the multi-MB CLI bundle was being
// readFileSync'd on every request (daemon self-updates + the health cron's
// e2e installs), a steady source of allocation churn on a memory-billed host.
// A statSync per hit keeps dev rebuilds and hotfixes visible.
const bodyCache = new Map<string, { mtimeMs: number; body: string }>();

function readAssetCached(file: string): string | null {
  let mtimeMs: number;
  try {
    mtimeMs = statSync(file).mtimeMs;
  } catch {
    return null;
  }
  const hit = bodyCache.get(file);
  if (hit && hit.mtimeMs === mtimeMs) return hit.body;
  const body = readFileSync(file, "utf8");
  bodyCache.set(file, { mtimeMs, body });
  return body;
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
      const cached = readAssetCached(file);
      if (cached === null) return c.json({ error: "asset_unavailable" }, 503);

      // The bundle is immutable per deploy and never rewritten — let clients
      // and any intermediary cache it briefly, and 304 the self-updaters that
      // already have this build. Rewritten scripts stay no-cache (they vary by
      // host and ?ref).
      if (!asset.rewrite) {
        const etag = `"${readBuildId(file)}"`;
        if (c.req.header("if-none-match") === etag) {
          return c.body(null, 304, { etag });
        }
        return c.body(cached, 200, {
          "content-type": asset.type,
          "cache-control": "public, max-age=300",
          etag,
        });
      }

      // Point the script's default BASE at whichever host served it, so the
      // follow-up cli.js download stays on the working host.
      const url = new URL(c.req.url);
      const proto = c.req.header("x-forwarded-proto") ?? url.protocol.replace(":", "");
      const host = c.req.header("x-forwarded-host") ?? c.req.header("host") ?? url.host;
      let body = cached;
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
      return c.body(body, 200, { "content-type": asset.type, "cache-control": "no-cache" });
    });
  }
  return app;
}
