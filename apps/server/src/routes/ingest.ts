import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { DB } from "../db/index.js";
import type { LeaderboardStore } from "../lib/leaderboard-store.js";
import { ingestUsage } from "../services/ingest.js";

const bodySchema = z.object({
  cost30d: z.number().nonnegative(),
  costAllTime: z.number().nonnegative(),
  ccusageVersion: z.string().optional(),
});

export function ingestRoute(db: DB, store: LeaderboardStore, onIngest: () => void) {
  const app = new Hono();
  app.post("/", zValidator("json", bodySchema), async (c) => {
    const auth = c.req.header("authorization") ?? "";
    const token = auth.replace(/^Bearer\s+/i, "");
    const res = await ingestUsage(db, store, token, c.req.valid("json"));
    if (!res.ok) {
      const status = res.error === "unauthorized" ? 401 : res.error === "rate_limited" ? 429 : 422;
      return c.json({ error: res.error }, status);
    }
    onIngest();
    return c.json(res);
  });
  return app;
}
