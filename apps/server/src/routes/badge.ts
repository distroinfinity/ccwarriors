import { Hono } from "hono";
import type { LeaderboardStore } from "../lib/leaderboard-store.js";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const TIER_GLYPH: Record<string, string> = {
  netherite: "☄",
  diamond: "❖",
  gold: "◆",
  iron: "✦",
  stone: "⬡",
};

const LOGIN_RE = /^[a-zA-Z0-9-]{1,39}$/;

// Approximate 11px Verdana advance; close enough for badge layout and avoids
// shipping a font-metrics table.
const textWidth = (s: string) => Math.round(s.length * 6.8);

function renderBadge(brand: string, stat: string, statColor: string): string {
  const pad = 9;
  const brandW = textWidth(brand) + pad * 2;
  const statW = textWidth(stat) + pad * 2;
  const w = brandW + statW;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${esc(brand)}: ${esc(stat)}">
<title>${esc(brand)}: ${esc(stat)}</title>
<rect width="${brandW}" height="20" fill="#111214"/>
<rect x="${brandW}" width="${statW}" height="20" fill="#1a1b1e"/>
<rect width="${w}" height="20" fill="none" stroke="#CC785C" stroke-opacity=".25"/>
<g font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11" text-anchor="middle">
<text x="${brandW / 2}" y="14" fill="#ECEAE3">${esc(brand)}</text>
<text x="${brandW + statW / 2}" y="14" fill="${statColor}" font-weight="bold">${esc(stat)}</text>
</g>
</svg>`;
}

/** README badge: a permanent ad in every profile that embeds it (#31).
    Unknown, flagged, or malformed logins all get the generic enlist badge —
    a broken image in someone's README kills the loop. */
export function badgeRoute(store: LeaderboardStore) {
  const app = new Hono();
  app.get("/:file", (c) => {
    const file = c.req.param("file");
    if (!file.endsWith(".svg")) return c.text("not found", 404);
    const login = file.slice(0, -4);

    let svg: string;
    const entry = LOGIN_RE.test(login) ? store.getByLogin(login) : undefined;
    if (entry && !entry.flagged) {
      const rank = store.getRank("30d", entry.id);
      const glyph = TIER_GLYPH[entry.tier.toLowerCase()];
      const tier = `${glyph ? glyph + " " : ""}${entry.tier.toUpperCase()}`;
      const burn = "$" + Math.round(entry.cost30d).toLocaleString("en-US");
      const stat = `${rank ? `#${rank} · ` : ""}${tier} · ${burn} 30d`;
      svg = renderBadge(`⚔ CCWarriors · ${entry.githubLogin}`, stat, "#CC785C");
    } else {
      svg = renderBadge("⚔ CCWarriors", "enlist →", "#3FB97A");
    }

    c.header("Content-Type", "image/svg+xml; charset=utf-8");
    // GitHub camo re-fetches when this expires — ~1h keeps ranks fresh enough
    // without hammering the board on every README view.
    c.header("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
    return c.body(svg);
  });
  return app;
}
