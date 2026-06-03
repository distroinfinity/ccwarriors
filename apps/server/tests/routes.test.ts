import { describe, it, expect } from "vitest";
import { createApp } from "../src/app.js";

describe("health", () => {
  it("GET /health returns ok", async () => {
    const app = createApp();
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});
