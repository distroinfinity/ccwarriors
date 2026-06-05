import { Hono } from "hono";
import type { LeaderboardStore, Board } from "../lib/leaderboard-store.js";
import { orgBySlug } from "../lib/orgs.js";

const TOOL_RE = /^[a-z0-9_-]{1,32}$/;

export function leaderboardRoute(store: LeaderboardStore) {
  const app = new Hono();
  app.get("/", (c) => {
    const board = (c.req.query("board") === "allTime" ? "allTime" : "30d") as Board;
    const limit = Math.max(1, Math.min(Number(c.req.query("limit") ?? 30) || 30, 100));
    const offset = Math.max(0, Math.min(Number(c.req.query("offset") ?? 0) || 0, 100_000));
    // Optional per-tool board (ranked by that tool's 30d cost). Unknown keys
    // return an empty board rather than erroring.
    const toolParam = c.req.query("tool");
    const tool = toolParam && TOOL_RE.test(toolParam) ? toolParam : undefined;
    // Optional org-scoped board. Unknown orgs 400 — silently serving the
    // global board under an org banner would misrepresent it.
    const orgParam = c.req.query("org");
    if (orgParam && !orgBySlug(orgParam)) return c.json({ error: "unknown org" }, 400);
    const org = orgParam || undefined;
    return c.json({
      board,
      tool: tool ?? null,
      org: org ?? null,
      count: store.count(org),
      totals: store.totals(org),
      offset,
      limit,
      entries: store.getTop(board, limit, offset, tool, org),
    });
  });
  return app;
}
