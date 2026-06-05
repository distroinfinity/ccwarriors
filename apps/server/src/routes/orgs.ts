import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { DB } from "../db/index.js";
import type { LeaderboardStore } from "../lib/leaderboard-store.js";
import { users, orgMembers } from "../db/schema.js";
import { orgBySlug, guildIdFor } from "../lib/orgs.js";
import { readSessionToken, sign, verify } from "../lib/session.js";

export interface DiscordCfg {
  clientId: string;
  clientSecret: string;
  // HMAC secret shared with the session/state machinery (the GitHub client
  // secret today — same key auth.ts signs with).
  sessionSecret: string;
  publicBaseUrl: string;
  webBaseUrl: string;
}

/** Org-scoped web URL: ns.ccwarriors.xyz in prod, ?org=ns on localhost. */
export function orgWebUrl(webBaseUrl: string, slug: string, params: Record<string, string>): string {
  const url = new URL(webBaseUrl);
  const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (isLocal) url.searchParams.set("org", slug);
  else url.hostname = `${slug}.${url.hostname}`;
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

// Discord membership verification: an additive check linked to the existing
// GitHub identity. The user OAuths with `identify guilds`; we look for the
// org's guild in their server list. No bot, no org-admin cooperation needed.
export function orgsRoute(db: DB, store: LeaderboardStore, cfg: DiscordCfg, onChange: () => void) {
  const app = new Hono();

  const redirectUri = `${cfg.publicBaseUrl}/discord/callback`;

  app.get("/orgs/:slug/verify/start", (c) => {
    const slug = c.req.param("slug");
    if (!orgBySlug(slug)) return c.text("Unknown org", 404);

    const token = getCookie(c, "ccw_session");
    const session = token ? readSessionToken(token, cfg.sessionSecret) : null;
    // No GitHub identity yet — sign in first (returning to the org page),
    // then re-trigger verify from the site.
    if (!session) return c.redirect(`${cfg.publicBaseUrl}/auth/web?org=${slug}`, 302);

    const state = sign(
      {
        slug,
        githubId: session.githubId,
        nonce: randomBytes(16).toString("hex"),
        // Short-lived: a leaked state token shouldn't be replayable forever.
        exp: Math.floor(Date.now() / 1000) + 600,
      },
      cfg.sessionSecret,
    );
    const url = new URL("https://discord.com/api/oauth2/authorize");
    url.searchParams.set("client_id", cfg.clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "identify guilds");
    url.searchParams.set("state", state);
    return c.redirect(url.toString(), 302);
  });

  app.get("/discord/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    if (!state) return c.text("Missing state", 400);

    const payload = verify(state, cfg.sessionSecret);
    const slug = payload?.["slug"];
    const githubId = payload?.["githubId"];
    const exp = payload?.["exp"];
    if (typeof slug !== "string" || typeof githubId !== "string") {
      return c.text("Invalid state", 400);
    }
    if (typeof exp !== "number" || exp * 1000 < Date.now()) {
      return c.text("Expired state — start verification again", 400);
    }
    const org = orgBySlug(slug);
    if (!org) return c.text("Unknown org", 400);

    const back = (verified: "1" | "notmember" | "failed") =>
      c.redirect(orgWebUrl(cfg.webBaseUrl, slug, { verified }), 302);

    if (!code) return back("failed"); // user denied the Discord prompt

    try {
      const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
        }),
      });
      if (!tokenRes.ok) return back("failed");
      const tokenData = (await tokenRes.json()) as Record<string, unknown>;
      const accessToken = tokenData["access_token"];
      if (typeof accessToken !== "string" || !accessToken) return back("failed");

      const auth = { Authorization: `Bearer ${accessToken}` };
      const meRes = await fetch("https://discord.com/api/users/@me", { headers: auth });
      if (!meRes.ok) return back("failed");
      const me = (await meRes.json()) as Record<string, unknown>;
      const discordUserId = me["id"];
      if (typeof discordUserId !== "string" || !discordUserId) return back("failed");

      const guildsRes = await fetch("https://discord.com/api/users/@me/guilds", { headers: auth });
      if (!guildsRes.ok) return back("failed");
      const guilds = (await guildsRes.json()) as Array<{ id?: unknown }>;
      const guildId = guildIdFor(org);
      const isMember =
        !!guildId && Array.isArray(guilds) && guilds.some((g) => g.id === guildId);
      if (!isMember) return back("notmember");

      const [user] = await db.select().from(users).where(eq(users.githubId, githubId));
      if (!user) return back("failed");

      await db
        .insert(orgMembers)
        .values({ userId: user.id, orgSlug: slug, discordUserId })
        .onConflictDoUpdate({
          target: [orgMembers.userId, orgMembers.orgSlug],
          set: { discordUserId, verifiedAt: new Date() },
        });

      // Live store update so the member shows up without waiting for a restart.
      const existing = store.get(user.id);
      if (existing) {
        if (!existing.orgs?.includes(slug)) {
          store.setOrgs(user.id, [...(existing.orgs ?? []), slug]);
          onChange();
        }
      } else {
        // Verified before their first CLI sync: put them on the boards at $0
        // now (warm-up would do the same after a restart; sync fills in spend).
        const cost30d = Number(user.cost30d);
        store.upsert({
          id: user.id,
          githubLogin: user.githubLogin,
          avatarUrl: user.avatarUrl,
          xHandle: user.xHandle,
          tier: user.tier,
          cardScene: user.cardScene,
          cost30d,
          costAllTime: Number(user.costAllTime),
          breakdown: cost30d > 0 ? { claude: cost30d } : {},
          flagged: !!user.flaggedAt,
          orgs: [slug],
        });
        onChange();
      }
      return back("1");
    } catch (err) {
      console.error("[orgs] discord callback error:", err);
      return back("failed");
    }
  });

  return app;
}
