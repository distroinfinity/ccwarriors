import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { DB } from "../db/index.js";
import { users, orgMembers } from "../db/schema.js";
import { generateToken, hashToken } from "../lib/token.js";
import { randomScene } from "../lib/scenes.js";
import { createSessionToken, readSessionToken, sessionCookie, sign, verify } from "../lib/session.js";
import { orgBySlug } from "../lib/orgs.js";
import { orgWebUrl } from "./orgs.js";
import { sanitizeRef } from "./installer.js";
import { currentBuildId } from "../lib/build-id.js";
import { captureEvent } from "./telemetry.js";

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
    // Channel ref rides the state so enlistment attributes to its channel.
    const ref = sanitizeRef(c.req.query("ref"));
    return c.redirect(githubAuthorizeUrl({ mode: "cli", port, nonce, ...(ref ? { ref } : {}) }), 302);
  });

  // Web flow: opens GitHub, ends back on the landing page with a session.
  // ?org=ns rides through the OAuth state so org-page sign-ins land back on
  // the org subdomain instead of the apex.
  app.get("/auth/web", (c) => {
    const nonce = randomBytes(16).toString("hex");
    const orgParam = c.req.query("org");
    const org = orgParam && orgBySlug(orgParam) ? orgParam : undefined;
    const ref = sanitizeRef(c.req.query("ref"));
    return c.redirect(
      githubAuthorizeUrl({ mode: "web", nonce, ...(org ? { org } : {}), ...(ref ? { ref } : {}) }),
      302,
    );
  });

  // Shared GitHub callback (the OAuth app's single registered redirect URI).
  app.get("/cli/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    if (!code || !state) return c.text("Missing code or state", 400);

    const payload = verify(state, cfg.clientSecret);
    if (!payload) return c.text("Invalid state", 400);

    const mode: Mode = payload["mode"] === "web" ? "web" : "cli";
    // Channel ref carried through the state — stored on first enlistment only.
    const ref = typeof payload["ref"] === "string" ? sanitizeRef(payload["ref"]) : null;
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

      // First-touch attribution: only a brand-new row gets install_source, and
      // user_enlisted fires once so the funnel counts enlistments, not logins.
      const [existing] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.githubId, githubIdStr));
      const enlistProps = { mode, ...(ref ? { ref } : {}) };

      if (mode === "web") {
        // Web sign-in only identifies an existing/new visitor; no CLI token rotation.
        // The OAuth token is persisted for server-side PUBLIC GitHub-stats reads
        // (read:user scope only) — success path only, never clobbered with empty.
        await db
          .insert(users)
          .values({
            githubId: githubIdStr,
            githubLogin: login,
            avatarUrl,
            cliTokenHash: hashToken(generateToken()),
            cardScene: randomScene(),
            githubAccessToken: accessToken,
            ...(ref ? { installSource: ref } : {}),
          })
          .onConflictDoUpdate({
            target: users.githubId,
            set: { githubLogin: login, avatarUrl, githubAccessToken: accessToken },
          });
        if (!existing) captureEvent("user_enlisted", githubIdStr, enlistProps);
        const orgSlug =
          typeof payload["org"] === "string" && orgBySlug(payload["org"]) ? payload["org"] : null;
        return c.redirect(
          orgSlug
            ? orgWebUrl(cfg.webBaseUrl, orgSlug, { u: login })
            : `${cfg.webBaseUrl}/?u=${encodeURIComponent(login)}`,
          302,
        );
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
          githubAccessToken: accessToken,
          ...(ref ? { installSource: ref } : {}),
        })
        .onConflictDoUpdate({
          target: users.githubId,
          set: { githubLogin: login, avatarUrl, cliTokenHash: hashToken(cliToken), githubAccessToken: accessToken },
        });
      if (!existing) captureEvent("user_enlisted", githubIdStr, enlistProps);

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
      // Verified org slugs — the site uses these to hide the org verify CTA.
      const memberships = user
        ? await db
            .select({ orgSlug: orgMembers.orgSlug })
            .from(orgMembers)
            .where(eq(orgMembers.userId, user.id))
        : [];
      // "Out of date" covers two cohorts the auto-updater can't help: pre-self-
      // update clients (never sent a multi-tool breakdown → hasBreakdown=false)
      // and self-update-capable clients pinned to a build that isn't the latest
      // (their self-update silently stalled). Both miss new features like
      // profiles/insights, so the site nudges a reinstall. Build ids are commit
      // SHAs, not orderable — "is the latest" is the only computable signal.
      const latestBuildId = currentBuildId();
      const outdatedClient =
        !!user &&
        user.lastSyncedAt !== null &&
        (!user.hasBreakdown || (!!user.clientBuildId && user.clientBuildId !== latestBuildId));
      return c.json({
        ...session,
        outdatedClient,
        latestBuildId,
        clientBuildId: user?.clientBuildId ?? null,
        underReview: !!user?.flaggedAt,
        orgs: memberships.map((m) => m.orgSlug),
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
