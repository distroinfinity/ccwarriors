import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { DB } from "../db/index.js";
import { donations } from "../db/schema.js";
import {
  createOrder,
  verifySignature,
  verifyWebhookSignature,
  type RazorpayKeys,
} from "../lib/razorpay.js";
import { createRateLimiter } from "../lib/ratelimit.js";
import { getUsdInr } from "../lib/fx.js";

export interface DonateDeps extends RazorpayKeys {
  // Set when a payment.captured webhook is configured in the dashboard —
  // catches donors whose tab died before the browser verify call.
  webhookSecret?: string;
  // USD→INR rate source; tests inject a fixed rate.
  usdInr?: () => number;
}

// Tiers display in dollars ($4–$256 plus a custom cell); the server converts
// to rupees at the live rate and Razorpay charges INR.
export const MIN_USD = 1;
export const MAX_USD = 1000;

// Order creation is anonymous and costs a Razorpay API call + a DB row.
const ORDERS_PER_MINUTE = 5;

const orderSchema = z.object({
  usd: z.number().int(),
});

const verifySchema = z.object({
  razorpay_order_id: z.string().min(1).max(64),
  razorpay_payment_id: z.string().min(1).max(64),
  razorpay_signature: z.string().min(1).max(128),
  name: z.string().trim().max(60).optional(),
});

export function donateRoute(db: DB, keys: DonateDeps) {
  const app = new Hono();
  const allowOrder = createRateLimiter(ORDERS_PER_MINUTE, 60_000);
  const rate = keys.usdInr ?? getUsdInr;

  // Current rate so the client can preview the ₹ amount before checkout.
  app.get("/rate", (c) => c.json({ usdInr: rate() }));

  app.post("/order", zValidator("json", orderSchema), async (c) => {
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    if (!allowOrder(ip)) {
      return c.json({ error: "too many orders, slow down" }, 429);
    }
    const { usd } = c.req.valid("json");
    if (usd < MIN_USD || usd > MAX_USD) {
      return c.json({ error: `amount must be $${MIN_USD}–$${MAX_USD}` }, 422);
    }
    const amount = Math.round(usd * rate()); // whole rupees
    let order: { id: string };
    try {
      order = await createOrder(keys, amount, randomUUID());
    } catch (err) {
      console.error("razorpay order failed:", err instanceof Error ? err.message : err);
      return c.json({ error: "payment provider unavailable" }, 502);
    }
    await db.insert(donations).values({ razorpayOrderId: order.id, amount: String(amount) });
    return c.json({ orderId: order.id, amount, usd, currency: "INR", keyId: keys.keyId });
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

  // Server-to-server safety net: payment.captured fires even when the donor's
  // tab died before the browser verify call. Signature covers the raw body.
  if (keys.webhookSecret) {
    const webhookSecret = keys.webhookSecret;
    app.post("/webhook", async (c) => {
      const raw = await c.req.text();
      const signature = c.req.header("x-razorpay-signature") ?? "";
      if (!verifyWebhookSignature(webhookSecret, raw, signature)) {
        return c.json({ error: "signature mismatch" }, 400);
      }
      let event: { event?: string; payload?: { payment?: { entity?: { id?: string; order_id?: string } } } };
      try {
        event = JSON.parse(raw);
      } catch {
        return c.json({ error: "bad payload" }, 400);
      }
      if (event.event === "payment.captured") {
        const entity = event.payload?.payment?.entity;
        if (entity?.order_id && entity.id) {
          // Only lift created → paid; a row the browser already verified
          // keeps its payment id and donor name.
          await db
            .update(donations)
            .set({ status: "paid", razorpayPaymentId: entity.id })
            .where(and(eq(donations.razorpayOrderId, entity.order_id), eq(donations.status, "created")));
        }
      }
      // Always ack known-good signatures so Razorpay stops retrying.
      return c.json({ status: "ok" });
    });
  }

  return app;
}
