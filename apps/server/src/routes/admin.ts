import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { DB } from "../db/index.js";
import { users } from "../db/schema.js";
import type { LeaderboardStore } from "../lib/leaderboard-store.js";
import { captureEvent } from "./telemetry.js";

// Manual quarantine controls. Mounted only when ADMIN_TOKEN is set; every
// request must present it. Used to clear false-positive plausibility flags
// (legit whales) and to flag riggers found by scripts/audit-snapshots.ts.

const bodySchema = z.object({
  githubLogin: z.string().min(1).max(100),
  reason: z.string().max(300).optional(),
});

export function adminRoute(db: DB, store: LeaderboardStore, onChange: () => void) {
  const app = new Hono();

  app.use("*", async (c, next) => {
    const expected = process.env["ADMIN_TOKEN"];
    if (!expected || c.req.header("x-admin-token") !== expected) {
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  });

  app.post("/flag", zValidator("json", bodySchema), async (c) => {
    const { githubLogin, reason } = c.req.valid("json");
    const [user] = await db.select().from(users).where(eq(users.githubLogin, githubLogin));
    if (!user) return c.json({ error: "not_found" }, 404);
    await db
      .update(users)
      .set({ flaggedAt: new Date(), flagReason: reason ?? "manual" })
      .where(eq(users.id, user.id));
    store.setFlagged(user.id, true);
    onChange();
    captureEvent("admin_flag", githubLogin, { reason: reason ?? "manual" });
    return c.json({ ok: true });
  });

  app.post("/unflag", zValidator("json", bodySchema), async (c) => {
    const { githubLogin } = c.req.valid("json");
    const [user] = await db.select().from(users).where(eq(users.githubLogin, githubLogin));
    if (!user) return c.json({ error: "not_found" }, 404);
    await db.update(users).set({ flaggedAt: null, flagReason: null }).where(eq(users.id, user.id));
    store.setFlagged(user.id, false);
    onChange();
    captureEvent("admin_unflag", githubLogin, {});
    return c.json({ ok: true });
  });

  return app;
}
