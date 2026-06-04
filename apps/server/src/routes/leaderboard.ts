import { Hono } from "hono";
import type { LeaderboardStore, Board } from "../lib/leaderboard-store.js";

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
    return c.json({
      board,
      tool: tool ?? null,
      count: store.count(),
      offset,
      limit,
      entries: store.getTop(board, limit, offset, tool),
    });
  });
  return app;
}
