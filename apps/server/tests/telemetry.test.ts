import { describe, it, expect } from "vitest";
import { createApp } from "../src/app.js";

describe("telemetry endpoint", () => {
  const app = createApp();

  it("accepts a known event with props", async () => {
    const res = await app.request("/telemetry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "install_failed", distinctId: "t-1", props: { os: "Darwin", step: "download" } }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("accepts health_check events", async () => {
    const res = await app.request("/telemetry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "health_check", distinctId: "gh-health", props: { os: "ci" } }),
    });
    expect(res.status).toBe(200);
  });

  it("rejects unknown events", async () => {
    const res = await app.request("/telemetry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "definitely_not_a_thing" }),
    });
    expect(res.status).toBe(400);
  });
});
