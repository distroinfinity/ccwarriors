import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app.js";
import { makeDb } from "./helpers/db.js";
import { LeaderboardStore } from "../src/lib/leaderboard-store.js";
import { donations } from "../src/db/schema.js";

const KEY_ID = "rzp_test_key";
const KEY_SECRET = "rzp_test_secret";
const WEBHOOK_SECRET = "whsec_test";
const TEST_RATE = 88; // injected USD→INR so tests don't depend on live FX

function makeApp(db: Awaited<ReturnType<typeof makeDb>>, withKeys = true) {
  return createApp({
    db,
    store: new LeaderboardStore(),
    onIngest: () => {},
    donate: withKeys
      ? { keyId: KEY_ID, keySecret: KEY_SECRET, webhookSecret: WEBHOOK_SECRET, usdInr: () => TEST_RATE }
      : undefined,
  });
}

function sign(orderId: string, paymentId: string, secret = KEY_SECRET): string {
  return createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
}

// Razorpay orders API stub: echoes back a fake order for whatever amount it
// got. Real Razorpay issues a unique id per order; `unique` mimics that for
// tests that create several orders.
function stubRazorpayFetch(unique = false) {
  let n = 0;
  const mock = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const id = unique ? `order_test${++n}` : "order_test123";
    return new Response(JSON.stringify({ id, amount: body.amount, currency: body.currency }), {
      status: 200,
    });
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

describe("donate routes", () => {
  let db: Awaited<ReturnType<typeof makeDb>>;

  beforeEach(async () => {
    db = await makeDb();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POST /donate/order takes USD, converts at the server rate, charges paise", async () => {
    const fetchMock = stubRazorpayFetch();
    const app = makeApp(db);

    const res = await app.request("/donate/order", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ usd: 16 }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      orderId: "order_test123",
      amount: 16 * TEST_RATE, // 1408 rupees
      usd: 16,
      currency: "INR",
      keyId: KEY_ID,
    });

    // Razorpay got paise + Basic auth.
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://api.razorpay.com/v1/orders");
    expect(JSON.parse(String(init!.body))).toMatchObject({
      amount: 16 * TEST_RATE * 100,
      currency: "INR",
    });
    expect((init!.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64")}`,
    );

    // DB row keeps rupees, status created.
    const rows = await db.select().from(donations);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      razorpayOrderId: "order_test123",
      amount: String(16 * TEST_RATE),
      currency: "INR",
      status: "created",
    });
  });

  it("POST /donate/order accepts custom (non-tier) dollar amounts", async () => {
    stubRazorpayFetch();
    const app = makeApp(db);

    const res = await app.request("/donate/order", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ usd: 9 }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ usd: 9, amount: 9 * TEST_RATE });
  });

  it("POST /donate/order rejects amounts outside $1–$1,000 with 422", async () => {
    const fetchMock = stubRazorpayFetch();
    const app = makeApp(db);

    for (const usd of [0, -4, 1001]) {
      const res = await app.request("/donate/order", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ usd }),
      });
      expect(res.status).toBe(422);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await db.select().from(donations)).toHaveLength(0);
  });

  it("GET /donate/rate exposes the current USD→INR rate for client previews", async () => {
    const app = makeApp(db);
    const res = await app.request("/donate/rate");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ usdInr: TEST_RATE });
  });

  it("POST /donate/order surfaces Razorpay API failure as 502 without inserting", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "auth" }), { status: 401 })),
    );
    const app = makeApp(db);

    const res = await app.request("/donate/order", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ usd: 4 }),
    });

    expect(res.status).toBe(502);
    expect(await db.select().from(donations)).toHaveLength(0);
  });

  it("POST /donate/verify with a valid signature marks the row paid and stores the name", async () => {
    stubRazorpayFetch();
    const app = makeApp(db);
    await app.request("/donate/order", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ usd: 32 }),
    });

    const res = await app.request("/donate/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        razorpay_order_id: "order_test123",
        razorpay_payment_id: "pay_abc",
        razorpay_signature: sign("order_test123", "pay_abc"),
        name: "Steve",
      }),
    });

    expect(res.status).toBe(200);
    const [row] = await db.select().from(donations).where(eq(donations.razorpayOrderId, "order_test123"));
    expect(row).toMatchObject({ status: "paid", razorpayPaymentId: "pay_abc", name: "Steve" });
  });

  it("POST /donate/verify with a bad signature returns 400 and never marks paid", async () => {
    stubRazorpayFetch();
    const app = makeApp(db);
    await app.request("/donate/order", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ usd: 4 }),
    });

    const res = await app.request("/donate/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        razorpay_order_id: "order_test123",
        razorpay_payment_id: "pay_abc",
        razorpay_signature: sign("order_test123", "pay_abc", "wrong_secret"),
      }),
    });

    expect(res.status).toBe(400);
    const [row] = await db.select().from(donations).where(eq(donations.razorpayOrderId, "order_test123"));
    expect(row!.status).toBe("created");
  });

  it("POST /donate/verify with missing fields returns 400", async () => {
    const app = makeApp(db);
    const res = await app.request("/donate/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ razorpay_order_id: "order_test123" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /donate/* is absent (404) when razorpay keys are not configured", async () => {
    const app = makeApp(db, false);
    const res = await app.request("/donate/order", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ usd: 16 }),
    });
    expect(res.status).toBe(404);
  });
});

describe("donate webhook", () => {
  let db: Awaited<ReturnType<typeof makeDb>>;

  beforeEach(async () => {
    db = await makeDb();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function webhookBody(orderId: string, paymentId: string) {
    return JSON.stringify({
      event: "payment.captured",
      payload: { payment: { entity: { id: paymentId, order_id: orderId } } },
    });
  }

  function webhookSig(body: string, secret = WEBHOOK_SECRET) {
    return createHmac("sha256", secret).update(body).digest("hex");
  }

  async function createOrder(app: ReturnType<typeof makeApp>) {
    stubRazorpayFetch();
    await app.request("/donate/order", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ usd: 16 }),
    });
  }

  it("payment.captured with a valid signature marks the created row paid", async () => {
    const app = makeApp(db);
    await createOrder(app);

    const body = webhookBody("order_test123", "pay_hook");
    const res = await app.request("/donate/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "x-razorpay-signature": webhookSig(body) },
      body,
    });

    expect(res.status).toBe(200);
    const [row] = await db.select().from(donations).where(eq(donations.razorpayOrderId, "order_test123"));
    expect(row).toMatchObject({ status: "paid", razorpayPaymentId: "pay_hook" });
  });

  it("rejects a bad signature with 400 and leaves the row untouched", async () => {
    const app = makeApp(db);
    await createOrder(app);

    const body = webhookBody("order_test123", "pay_hook");
    const res = await app.request("/donate/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-razorpay-signature": webhookSig(body, "wrong_secret"),
      },
      body,
    });

    expect(res.status).toBe(400);
    const [row] = await db.select().from(donations).where(eq(donations.razorpayOrderId, "order_test123"));
    expect(row!.status).toBe("created");
  });

  it("does not clobber a row already marked paid by browser verify", async () => {
    const app = makeApp(db);
    await createOrder(app);
    await app.request("/donate/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        razorpay_order_id: "order_test123",
        razorpay_payment_id: "pay_browser",
        razorpay_signature: sign("order_test123", "pay_browser"),
        name: "Steve",
      }),
    });

    const body = webhookBody("order_test123", "pay_hook_late");
    const res = await app.request("/donate/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "x-razorpay-signature": webhookSig(body) },
      body,
    });

    expect(res.status).toBe(200);
    const [row] = await db.select().from(donations).where(eq(donations.razorpayOrderId, "order_test123"));
    expect(row).toMatchObject({ status: "paid", razorpayPaymentId: "pay_browser", name: "Steve" });
  });

  it("acks unknown orders with 200 so Razorpay stops retrying", async () => {
    const app = makeApp(db);
    const body = webhookBody("order_never_seen", "pay_x");
    const res = await app.request("/donate/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "x-razorpay-signature": webhookSig(body) },
      body,
    });
    expect(res.status).toBe(200);
  });
});

describe("donate order rate limit", () => {
  let db: Awaited<ReturnType<typeof makeDb>>;

  beforeEach(async () => {
    db = await makeDb();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function postOrder(app: ReturnType<typeof makeApp>, ip: string) {
    return app.request("/donate/order", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ usd: 4 }),
    });
  }

  it("allows 5 orders per minute per IP, then 429s the 6th", async () => {
    stubRazorpayFetch(true);
    const app = makeApp(db);
    for (let i = 0; i < 5; i++) {
      expect((await postOrder(app, "1.2.3.4")).status).toBe(200);
    }
    expect((await postOrder(app, "1.2.3.4")).status).toBe(429);
  });

  it("does not throttle a different IP", async () => {
    stubRazorpayFetch(true);
    const app = makeApp(db);
    for (let i = 0; i < 5; i++) await postOrder(app, "1.2.3.4");
    expect((await postOrder(app, "5.6.7.8")).status).toBe(200);
  });
});

describe("sponsors route", () => {
  let db: Awaited<ReturnType<typeof makeDb>>;

  beforeEach(async () => {
    db = await makeDb();
  });

  it("GET /sponsors returns only paid donations, newest first, anonymous fallback", async () => {
    await db.insert(donations).values([
      {
        razorpayOrderId: "order_old",
        amount: "400",
        status: "paid",
        name: "Alice",
        createdAt: new Date("2026-06-01T00:00:00Z"),
      },
      {
        razorpayOrderId: "order_new",
        amount: "6400",
        status: "paid",
        name: null,
        createdAt: new Date("2026-06-03T00:00:00Z"),
      },
      {
        razorpayOrderId: "order_unpaid",
        amount: "25600",
        status: "created",
        name: "Mallory",
        createdAt: new Date("2026-06-04T00:00:00Z"),
      },
    ]);

    const app = makeApp(db, false); // sponsors must work even without razorpay keys
    const res = await app.request("/sponsors");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([
      { name: "Anonymous warrior", amount: 6400, currency: "INR" },
      { name: "Alice", amount: 400, currency: "INR" },
    ]);
  });

  it("GET /sponsors returns [] on an empty board", async () => {
    const app = makeApp(db, false);
    const res = await app.request("/sponsors");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});
