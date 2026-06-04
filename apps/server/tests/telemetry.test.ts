import { describe, it, expect, beforeEach } from "vitest";
import { createApp } from "../src/app.js";
import { resetFailuresForTest } from "../src/routes/telemetry.js";

interface FailureStats {
  installFailuresLastHour: number;
  failuresLastHour: number;
  failuresLast24h: number;
  byStepLastHour: Record<string, number>;
  recent: Array<{ event: string; step: string; os: string; at: string }>;
}

describe("telemetry endpoint", () => {
  const app = createApp();

  beforeEach(() => {
    resetFailuresForTest();
  });

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

  it("counts install failures in the rolling window", async () => {
    await app.request("/telemetry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "install_failed", distinctId: "t-2", props: { os: "Darwin", step: "enlist" } }),
    });
    const res = await app.request("/telemetry/failures");
    expect(res.status).toBe(200);
    const body = (await res.json()) as FailureStats;
    expect(body.installFailuresLastHour).toBe(1);
    expect(body.failuresLast24h).toBe(1);
    expect(body.byStepLastHour).toEqual({ enlist: 1 });
    expect(body.recent).toEqual([
      { event: "install_failed", step: "enlist", os: "Darwin", at: expect.any(String) },
    ]);
  });

  it("reports sync failures but excludes them from the install-failure count", async () => {
    await app.request("/telemetry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "sync_failed", distinctId: "t-3", props: { os: "Linux", step: "daemon" } }),
    });
    const res = await app.request("/telemetry/failures");
    const body = (await res.json()) as FailureStats;
    expect(body.installFailuresLastHour).toBe(0);
    expect(body.failuresLastHour).toBe(1);
  });

  it("does not count successful installs or health checks as failures", async () => {
    for (const event of ["install_started", "install_completed", "health_check"]) {
      await app.request("/telemetry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event, distinctId: "t-4", props: { os: "ci" } }),
      });
    }
    const res = await app.request("/telemetry/failures");
    const body = (await res.json()) as FailureStats;
    expect(body.failuresLast24h).toBe(0);
  });
});
