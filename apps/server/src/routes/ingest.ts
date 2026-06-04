import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { DB } from "../db/index.js";
import type { LeaderboardStore } from "../lib/leaderboard-store.js";
import { ingestUsage, type IngestPayload } from "../services/ingest.js";

// Two accepted shapes, one authority:
//   v1 (legacy clients, accepted forever): client-computed dollar totals.
//   v3 (current clients): raw per-tool/day/model token counts — the server
//   prices and validates everything; client dollars are never trusted.

const MAX_TOKENS_PER_DAY = 50_000_000_000;

const tokenCount = z.number().int().nonnegative().max(MAX_TOKENS_PER_DAY).default(0);

const modelTokensSchema = z.object({
  modelName: z.string().min(1).max(100),
  inputTokens: tokenCount,
  outputTokens: tokenCount,
  cacheCreationTokens: tokenCount,
  cacheReadTokens: tokenCount,
});

const rawDaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  models: z.array(modelTokensSchema).min(1).max(24),
  // ccusage's own price for the day — display hint only, never trusted blindly
  // (the server corroborates it against its own token math).
  costEstimate: z.number().nonnegative().max(1_000_000).optional(),
});

const bodySchema = z
  .object({
    // v1 fields — required when `tools` is absent.
    cost30d: z.number().nonnegative().optional(),
    costAllTime: z.number().nonnegative().optional(),
    ccusageVersion: z.string().max(64).optional(),
    // v3 fields.
    tools: z
      .record(z.string().min(1).max(32), z.array(rawDaySchema).max(45))
      .optional(),
    machineId: z
      .string()
      .regex(/^[a-f0-9]{8,64}$/i)
      .optional(),
    clientBuildId: z.string().max(64).optional(),
  })
  .refine(
    (b) =>
      (b.tools !== undefined && Object.keys(b.tools).length <= 24) ||
      (b.cost30d !== undefined && b.costAllTime !== undefined),
    { message: "either tools or cost30d+costAllTime required" },
  );

export function ingestRoute(db: DB, store: LeaderboardStore, onIngest: () => void) {
  const app = new Hono();
  app.post("/", zValidator("json", bodySchema), async (c) => {
    const auth = c.req.header("authorization") ?? "";
    const token = auth.replace(/^Bearer\s+/i, "");
    const body = c.req.valid("json");

    const payload: IngestPayload = body.tools
      ? {
          kind: "raw",
          tools: Object.fromEntries(
            Object.entries(body.tools).map(([k, days]) => [
              k,
              days.map((d) => ({ date: d.date, models: d.models, costEstimate: d.costEstimate })),
            ]),
          ),
          machineId: (body.machineId ?? "").toLowerCase(),
          clientBuildId: body.clientBuildId,
          ccusageVersion: body.ccusageVersion,
        }
      : {
          kind: "legacy",
          cost30d: body.cost30d!,
          costAllTime: body.costAllTime!,
          ccusageVersion: body.ccusageVersion,
        };

    const res = await ingestUsage(db, store, token, payload);
    if (!res.ok) {
      const status = res.error === "unauthorized" ? 401 : res.error === "rate_limited" ? 429 : 422;
      return c.json({ error: res.error }, status);
    }
    onIngest();
    return c.json(res);
  });
  return app;
}
