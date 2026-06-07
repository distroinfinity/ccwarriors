import { Hono } from "hono";
import type { LeaderboardStore } from "../lib/leaderboard-store.js";
import type { DB } from "../db/index.js";
import { users } from "../db/schema.js";
import { sql } from "drizzle-orm";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Crawler-facing OG shell for /u/:login (Vercel routes bot UAs here).
    Static brand image, dynamic title/description; humans get redirected. */
export function ogRoute(db: DB, store: LeaderboardStore, webBaseUrl: string) {
  const app = new Hono();
  app.get("/u/:login", async (c) => {
    const raw = c.req.param("login");
    if (!/^[a-zA-Z0-9-]{1,39}$/.test(raw)) return c.text("not found", 404);
    const entry = store.getByLogin(raw);
    const [user] = await db
      .select({ login: users.githubLogin, archetype: users.archetype, visibility: users.insightsVisibility })
      .from(users)
      .where(sql`lower(${users.githubLogin}) = ${raw.toLowerCase()}`);
    if (!entry && !user) return c.text("not found", 404);
    const login = user?.login ?? entry!.githubLogin;
    const rank = entry ? store.getRank("30d", entry.id) : null;
    const archetype = user?.visibility === "public" ? user?.archetype : null;
    const title = archetype
      ? `${login} is ${archetype} on CCWarriors`
      : `${login} on CCWarriors`;
    const desc = rank
      ? `Rank #${rank} on the AI coding leaderboard. See the archetype, habits, and rhythm.`
      : `Warrior profile on the AI coding leaderboard.`;
    const url = `${webBaseUrl}/u/${encodeURIComponent(login)}`;
    return c.html(`<!doctype html>
<html><head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(webBaseUrl)}/og.png">
<meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0;url=${esc(url)}">
</head><body><a href="${esc(url)}">${esc(title)}</a></body></html>`);
  });
  return app;
}
