import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import type { DB } from "../db/index.js";
import { donations } from "../db/schema.js";

// Public sponsor wall: paid Razorpay donors, newest first. The web client
// merges this with the static sponsorkit JSON (GitHub Sponsors side).
export function sponsorsRoute(db: DB) {
  const app = new Hono();

  app.get("/", async (c) => {
    const rows = await db
      .select({ name: donations.name, amount: donations.amount, currency: donations.currency })
      .from(donations)
      .where(eq(donations.status, "paid"))
      .orderBy(desc(donations.createdAt))
      .limit(100);
    return c.json(
      rows.map((r) => ({
        name: r.name ?? "Anonymous warrior",
        amount: Number(r.amount),
        currency: r.currency,
      })),
    );
  });

  return app;
}
