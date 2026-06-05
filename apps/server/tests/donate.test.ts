import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app.js";
import { makeDb } from "./helpers/db.js";
import { LeaderboardStore } from "../src/lib/leaderboard-store.js";
import { donations } from "../src/db/schema.js";

const KEY_ID = "rzp_test_key";
const KEY_SECRET = "rzp_test_secret";

function makeApp(db: Awaited<ReturnType<typeof makeDb>>, withKeys = true) {
  return createApp({
    db,
    store: new LeaderboardStore(),
    onIngest: () => {},
    donate: withKeys ? { keyId: KEY_ID, keySecret: KEY_SECRET } : undefined,
  });
}

function sign(orderId: string, paymentId: string, secret = KEY_SECRET): string {
  return createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
}

// Razorpay orders API stub: echoes back a fake order for whatever amount it got.
function stubRazorpayFetch() {
  const mock = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({ id: "order_test123", amount: body.amount, currency: body.currency }),
      { status: 200 },
    );
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

  it("POST /donate/order creates a Razorpay order in paise and a created row in rupees", async () => {
    const fetchMock = stubRazorpayFetch();
    const app = makeApp(db);

    const res = await app.request("/donate/order", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount: 1600 }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      orderId: "order_test123",
      amount: 1600,
      currency: "INR",
      keyId: KEY_ID,
    });

    // Razorpay got paise + Basic auth.
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://api.razorpay.com/v1/orders");
    expect(JSON.parse(String(init!.body))).toMatchObject({ amount: 160000, currency: "INR" });
    expect((init!.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64")}`,
    );

    // DB row keeps rupees, status created.
    const rows = await db.select().from(donations);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      razorpayOrderId: "order_test123",
      amount: "1600",
      currency: "INR",
      status: "created",
    });
  });

  it("POST /donate/order rejects amounts outside the tier allow-list with 422", async () => {
    const fetchMock = stubRazorpayFetch();
    const app = makeApp(db);

    const res = await app.request("/donate/order", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount: 999 }),
    });

    expect(res.status).toBe(422);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await db.select().from(donations)).toHaveLength(0);
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
      body: JSON.stringify({ amount: 400 }),
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
      body: JSON.stringify({ amount: 3200 }),
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
      body: JSON.stringify({ amount: 400 }),
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
      body: JSON.stringify({ amount: 1600 }),
    });
    expect(res.status).toBe(404);
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
