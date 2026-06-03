import { Hono } from "hono";
import type { LeaderboardStore, Board } from "../lib/leaderboard-store.js";

export function leaderboardRoute(store: LeaderboardStore) {
  const app = new Hono();
  app.get("/", (c) => {
    const board = (c.req.query("board") === "allTime" ? "allTime" : "30d") as Board;
    const limit = Math.max(1, Math.min(Number(c.req.query("limit") ?? 30) || 30, 100));
    return c.json({ board, count: store.count(), entries: store.getTop(board, limit) });
  });
  return app;
}
