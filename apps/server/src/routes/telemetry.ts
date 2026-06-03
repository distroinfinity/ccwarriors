import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

// Anonymous product telemetry (install funnel + CLI failures). Events are
// logged to stdout (Railway logs) and forwarded to PostHog when
// POSTHOG_API_KEY is set — no key, no forward, endpoint still works.

const bodySchema = z.object({
  event: z.enum([
    "install_started",
    "install_completed",
    "install_failed",
    "enlist_failed",
    "sync_failed",
    "health_check",
  ]),
  distinctId: z.string().min(1).max(64).optional(),
  props: z.record(z.string().max(40), z.union([z.string().max(200), z.number(), z.boolean()])).optional(),
});

/** Log + forward an event to PostHog. Fire-and-forget — never blocks or throws. */
export function captureEvent(event: string, distinctId: string, props: Record<string, unknown>) {
  console.log(JSON.stringify({ telemetry: event, distinctId, ...props }));
  const key = process.env["POSTHOG_API_KEY"];
  if (!key) return;
  const host = process.env["POSTHOG_HOST"] ?? "https://us.i.posthog.com";
  void fetch(`${host}/i/v0/e/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ api_key: key, event, distinct_id: distinctId, properties: { ...props, source: "ccwarriors" } }),
  }).catch(() => {});
}

export function telemetryRoute() {
  const app = new Hono();
  app.post("/", zValidator("json", bodySchema), (c) => {
    const { event, distinctId, props } = c.req.valid("json");
    captureEvent(event, distinctId ?? "anonymous", props ?? {});
    return c.json({ ok: true });
  });
  return app;
}
