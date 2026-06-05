import { createHmac, timingSafeEqual } from "node:crypto";

// Razorpay Standard Checkout, server side. Raw fetch instead of the SDK —
// we need exactly two calls (create order, verify signature) and the SDK
// would be our only runtime dep for them.

export interface RazorpayKeys {
  keyId: string;
  keySecret: string;
}

export class RazorpayApiError extends Error {
  constructor(public status: number, body: string) {
    super(`razorpay orders api ${status}: ${body.slice(0, 200)}`);
  }
}

// Creates an order. `amountInr` is whole rupees — Razorpay wants paise.
export async function createOrder(
  keys: RazorpayKeys,
  amountInr: number,
  receipt: string,
): Promise<{ id: string }> {
  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Basic ${Buffer.from(`${keys.keyId}:${keys.keySecret}`).toString("base64")}`,
    },
    body: JSON.stringify({ amount: amountInr * 100, currency: "INR", receipt }),
  });
  if (!res.ok) throw new RazorpayApiError(res.status, await res.text());
  return (await res.json()) as { id: string };
}

// HMAC-SHA256(order_id + "|" + payment_id, key_secret) must equal the
// signature Razorpay handed the browser. Constant-time compare.
export function verifySignature(
  keySecret: string,
  orderId: string,
  paymentId: string,
  signature: string,
): boolean {
  return hmacEquals(createHmac("sha256", keySecret).update(`${orderId}|${paymentId}`).digest(), signature);
}

// Webhooks sign the raw request body with the webhook secret (a separate
// secret set when creating the webhook in the dashboard).
export function verifyWebhookSignature(
  webhookSecret: string,
  rawBody: string,
  signature: string,
): boolean {
  return hmacEquals(createHmac("sha256", webhookSecret).update(rawBody).digest(), signature);
}

function hmacEquals(expected: Buffer, signature: string): boolean {
  let actual: Buffer;
  try {
    actual = Buffer.from(signature, "hex");
  } catch {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
