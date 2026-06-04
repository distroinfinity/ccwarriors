import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { DB } from "../db/index.js";
import { users } from "../db/schema.js";
import { generateToken, hashToken } from "../lib/token.js";
import { randomScene } from "../lib/scenes.js";
import { createSessionToken, readSessionToken, sessionCookie, sign, verify } from "../lib/session.js";

interface AuthCfg {
  clientId: string;
  clientSecret: string;
  publicBaseUrl: string;
  webBaseUrl: string;
}

type Mode = "cli" | "web";

export function authRoute(db: DB, cfg: AuthCfg) {
  const app = new Hono();

  const redirectUri = `${cfg.publicBaseUrl}/cli/callback`;

  function githubAuthorizeUrl(statePayload: object): string {
    const state = sign(statePayload, cfg.clientSecret);
    const ghUrl = new URL("https://github.com/login/oauth/authorize");
    ghUrl.searchParams.set("client_id", cfg.clientId);
    ghUrl.searchParams.set("redirect_uri", redirectUri);
    ghUrl.searchParams.set("scope", "read:user");
    ghUrl.searchParams.set("state", state);
    ghUrl.searchParams.set("allow_signup", "true");
    return ghUrl.toString();
  }

  // CLI flow: opens GitHub, ends back at the CLI's loopback server.
  app.get("/cli/auth", (c) => {
    const portStr = c.req.query("port");
    const port = portStr ? parseInt(portStr, 10) : NaN;
    if (isNaN(port) || !Number.isInteger(port) || port < 1024 || port > 65535) {
      return c.text("Invalid port: must be an integer between 1024 and 65535", 400);
    }
    const nonce = randomBytes(16).toString("hex");
    return c.redirect(githubAuthorizeUrl({ mode: "cli", port, nonce }), 302);
  });

  // Web flow: opens GitHub, ends back on the landing page with a session.
  app.get("/auth/web", (c) => {
    const nonce = randomBytes(16).toString("hex");
    return c.redirect(githubAuthorizeUrl({ mode: "web", nonce }), 302);
  });

  // Shared GitHub callback (the OAuth app's single registered redirect URI).
  app.get("/cli/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    if (!code || !state) return c.text("Missing code or state", 400);

    const payload = verify(state, cfg.clientSecret);
    if (!payload) return c.text("Invalid state", 400);

    const mode: Mode = payload["mode"] === "web" ? "web" : "cli";
    const port = payload["port"];
    if (mode === "cli" && (typeof port !== "number" || port < 1024 || port > 65535)) {
      return c.text("Invalid port in state", 400);
    }

    const fail = () =>
      mode === "cli"
        ? c.redirect(`http://127.0.0.1:${port}/callback?error=auth_failed`, 302)
        : c.redirect(`${cfg.webBaseUrl}/?login=failed`, 302);

    try {
      const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          code,
          redirect_uri: redirectUri,
        }),
      });
      const tokenData = (await tokenRes.json()) as Record<string, unknown>;
      const accessToken = tokenData["access_token"];
      if (typeof accessToken !== "string" || !accessToken) return fail();

      const userRes = await fetch("https://api.github.com/user", {
        headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": "ccwarriors" },
      });
      const ghUser = (await userRes.json()) as Record<string, unknown>;
      const githubId = ghUser["id"];
      const login = ghUser["login"];
      const avatarUrl = ghUser["avatar_url"];
      if (typeof githubId !== "number" || typeof login !== "string" || typeof avatarUrl !== "string") {
        return fail();
      }
      const githubIdStr = String(githubId);

      // Every login (CLI or web) gets a browser session for the site.
      const session = createSessionToken({ login, avatarUrl, githubId: githubIdStr }, cfg.clientSecret);
      c.header("Set-Cookie", sessionCookie(session, cfg.publicBaseUrl));

      if (mode === "web") {
        // Web sign-in only identifies an existing/new visitor; no CLI token rotation.
        await db
          .insert(users)
          .values({
            githubId: githubIdStr,
            githubLogin: login,
            avatarUrl,
            cliTokenHash: hashToken(generateToken()),
            cardScene: randomScene(),
          })
          .onConflictDoUpdate({ target: users.githubId, set: { githubLogin: login, avatarUrl } });
        return c.redirect(`${cfg.webBaseUrl}/?u=${encodeURIComponent(login)}`, 302);
      }

      // CLI mode: rotate the CLI token and hand it to the loopback server.
      const cliToken = generateToken();
      await db
        .insert(users)
        .values({
          githubId: githubIdStr,
          githubLogin: login,
          avatarUrl,
          cliTokenHash: hashToken(cliToken),
          cardScene: randomScene(),
        })
        .onConflictDoUpdate({
          target: users.githubId,
          set: { githubLogin: login, avatarUrl, cliTokenHash: hashToken(cliToken) },
        });

      return c.redirect(
        `http://127.0.0.1:${port}/callback?token=${encodeURIComponent(cliToken)}&login=${encodeURIComponent(login)}`,
        302,
      );
    } catch (err) {
      console.error("[auth] OAuth callback error:", err);
      return fail();
    }
  });

  // Who is this browser? (session cookie → identity; null when signed out)
  // Adds client-state flags so the site can nudge old-CLI users to re-install
  // and tell quarantined users their stats are under review.
  app.get("/me", async (c) => {
    const token = getCookie(c, "ccw_session");
    const session = token ? readSessionToken(token, cfg.clientSecret) : null;
    if (!session) return c.json({ login: null });
    try {
      const [user] = await db.select().from(users).where(eq(users.githubId, session.githubId));
      return c.json({
        ...session,
        outdatedClient: !!user && !user.hasBreakdown && user.lastSyncedAt !== null,
        underReview: !!user?.flaggedAt,
      });
    } catch {
      return c.json(session);
    }
  });

  app.get("/logout", (c) => {
    c.header("Set-Cookie", sessionCookie("", cfg.publicBaseUrl, 0));
    return c.redirect(`${cfg.webBaseUrl}/?logout=1`, 302);
  });

  return app;
}
