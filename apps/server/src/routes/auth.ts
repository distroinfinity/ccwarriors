import { Hono } from "hono";
import { createHmac, randomBytes } from "node:crypto";
import type { DB } from "../db/index.js";
import { users } from "../db/schema.js";
import { generateToken, hashToken } from "../lib/token.js";
import { randomScene } from "../lib/scenes.js";

interface AuthCfg {
  clientId: string;
  clientSecret: string;
  publicBaseUrl: string;
}

// Build a signed state token: base64url(JSON payload) + "." + HMAC-SHA256
function buildState(payload: object, secret: string): string {
  const payloadStr = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(payloadStr).digest("hex");
  return `${payloadStr}.${sig}`;
}

// Verify and decode the state. Returns the parsed payload or null if invalid.
function verifyState(state: string, secret: string): Record<string, unknown> | null {
  const dotIdx = state.lastIndexOf(".");
  if (dotIdx === -1) return null;
  const payloadStr = state.slice(0, dotIdx);
  const sig = state.slice(dotIdx + 1);
  const expected = createHmac("sha256", secret).update(payloadStr).digest("hex");
  // Constant-time comparison
  if (sig.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) {
    diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  if (diff !== 0) return null;
  try {
    return JSON.parse(Buffer.from(payloadStr, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function authRoute(db: DB, cfg: AuthCfg) {
  const app = new Hono();

  // GET /cli/auth?port=<loopbackPort>
  // Initiates the GitHub OAuth flow.
  app.get("/auth", (c) => {
    const portStr = c.req.query("port");
    const port = portStr ? parseInt(portStr, 10) : NaN;
    if (isNaN(port) || !Number.isInteger(port) || port < 1024 || port > 65535) {
      return c.text("Invalid port: must be an integer between 1024 and 65535", 400);
    }

    const nonce = randomBytes(16).toString("hex");
    const state = buildState({ port, nonce }, cfg.clientSecret);

    const redirectUri = `${cfg.publicBaseUrl}/cli/callback`;
    const ghUrl = new URL("https://github.com/login/oauth/authorize");
    ghUrl.searchParams.set("client_id", cfg.clientId);
    ghUrl.searchParams.set("redirect_uri", redirectUri);
    ghUrl.searchParams.set("scope", "read:user");
    ghUrl.searchParams.set("state", state);
    ghUrl.searchParams.set("allow_signup", "true");

    return c.redirect(ghUrl.toString(), 302);
  });

  // GET /cli/callback?code=<code>&state=<state>
  // GitHub redirects here after user authorization.
  app.get("/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");

    if (!code || !state) {
      return c.text("Missing code or state", 400);
    }

    // Verify state HMAC
    const payload = verifyState(state, cfg.clientSecret);
    if (!payload) {
      return c.text("Invalid state", 400);
    }

    const port = payload["port"];
    if (typeof port !== "number" || port < 1024 || port > 65535) {
      return c.text("Invalid port in state", 400);
    }

    const loopbackBase = `http://127.0.0.1:${port}/callback`;

    try {
      // Exchange code for access token
      const redirectUri = `${cfg.publicBaseUrl}/cli/callback`;
      const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          code,
          redirect_uri: redirectUri,
        }),
      });

      const tokenData = await tokenRes.json() as Record<string, unknown>;
      const accessToken = tokenData["access_token"];
      if (typeof accessToken !== "string" || !accessToken) {
        return c.redirect(`${loopbackBase}?error=auth_failed`, 302);
      }

      // Fetch GitHub user info
      const userRes = await fetch("https://api.github.com/user", {
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "User-Agent": "ccwarriors",
        },
      });

      const ghUser = await userRes.json() as Record<string, unknown>;
      const githubId = ghUser["id"];
      const login = ghUser["login"];
      const avatarUrl = ghUser["avatar_url"];

      if (typeof githubId !== "number" || typeof login !== "string" || typeof avatarUrl !== "string") {
        return c.redirect(`${loopbackBase}?error=auth_failed`, 302);
      }

      // Generate a fresh CLI token
      const cliToken = generateToken();
      const cliTokenHash = hashToken(cliToken);
      const githubIdStr = String(githubId);

      // Upsert the user — insert or update on conflict with github_id
      await db
        .insert(users)
        .values({
          githubId: githubIdStr,
          githubLogin: login,
          avatarUrl,
          cliTokenHash,
          cardScene: randomScene(),
        })
        .onConflictDoUpdate({
          target: users.githubId,
          set: {
            githubLogin: login,
            avatarUrl,
            cliTokenHash,
          },
        });

      // Redirect the browser back to the CLI's loopback server
      const callbackUrl = `${loopbackBase}?token=${encodeURIComponent(cliToken)}&login=${encodeURIComponent(login)}`;
      return c.redirect(callbackUrl, 302);
    } catch (err) {
      console.error("[auth] OAuth callback error:", err);
      return c.redirect(`${loopbackBase}?error=auth_failed`, 302);
    }
  });

  return app;
}
