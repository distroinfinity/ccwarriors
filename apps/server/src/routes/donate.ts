import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { DB } from "../db/index.js";
import { donations } from "../db/schema.js";
import { createOrder, verifySignature, type RazorpayKeys } from "../lib/razorpay.js";

// Must equal TIERS.map(t => t.inr) in apps/web/src/sponsorTiers.ts —
// the Minecraft tier ladder (wood → netherite), rupees.
export const ALLOWED_INR = [400, 800, 1600, 3200, 6400, 25600];

const orderSchema = z.object({
  amount: z.number().int(),
});

const verifySchema = z.object({
  razorpay_order_id: z.string().min(1).max(64),
  razorpay_payment_id: z.string().min(1).max(64),
  razorpay_signature: z.string().min(1).max(128),
  name: z.string().trim().max(60).optional(),
});

export function donateRoute(db: DB, keys: RazorpayKeys) {
  const app = new Hono();

  app.post("/order", zValidator("json", orderSchema), async (c) => {
    const { amount } = c.req.valid("json");
    if (!ALLOWED_INR.includes(amount)) {
      return c.json({ error: "amount not in tier list" }, 422);
    }
    let order: { id: string };
    try {
      order = await createOrder(keys, amount, randomUUID());
    } catch (err) {
      console.error("razorpay order failed:", err instanceof Error ? err.message : err);
      return c.json({ error: "payment provider unavailable" }, 502);
    }
    await db.insert(donations).values({ razorpayOrderId: order.id, amount: String(amount) });
    return c.json({ orderId: order.id, amount, currency: "INR", keyId: keys.keyId });
  });

  app.post(
    "/verify",
    zValidator("json", verifySchema, (result, c) => {
      if (!result.success) return c.json({ error: "missing fields" }, 400);
    }),
    async (c) => {
      const body = c.req.valid("json");
      const ok = verifySignature(
        keys.keySecret,
        body.razorpay_order_id,
        body.razorpay_payment_id,
        body.razorpay_signature,
      );
      if (!ok) return c.json({ error: "signature mismatch" }, 400);
      const updated = await db
        .update(donations)
        .set({
          status: "paid",
          razorpayPaymentId: body.razorpay_payment_id,
          ...(body.name ? { name: body.name } : {}),
        })
        .where(eq(donations.razorpayOrderId, body.razorpay_order_id))
        .returning();
      if (updated.length === 0) return c.json({ error: "unknown order" }, 400);
      return c.json({ status: "paid" });
    },
  );

  return app;
}
