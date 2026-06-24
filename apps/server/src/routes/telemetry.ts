import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { LeaderboardStore } from "../lib/leaderboard-store.js";
import { countSilentActive } from "../lib/fleet-health.js";

// Anonymous product telemetry (install funnel + CLI failures). Events are
// logged to stdout (Railway logs) and forwarded to PostHog when
// POSTHOG_API_KEY is set — no key, no forward, endpoint still works.

const bodySchema = z.object({
  event: z.enum([
    // Channel attribution: fired by the site when a visitor arrives with ?ref=.
    "web_visit",
    "install_started",
    "install_completed",
    "install_failed",
    "enlist_failed",
    "sync_failed",
    "health_check",
    // Multi-tool collection + self-update lifecycle (CLI-reported).
    "tool_collection_failed",
    "self_update_failed",
    "self_update_applied",
    "self_update_rollback",
    "self_update_relaunch_failed",
    // A newer build is advertised but the client couldn't move to it (server
    // kill switch, /cli/version unreachable, non-200). Observability of fleet
    // update stalls — deliberately NOT in `failureEvents`, so it never pages.
    "self_update_skipped",
    // CLI degraded to the known-good ccusage after the latest native binary
    // crashed at load. Observability, not a failure — deliberately NOT added to
    // `failureEvents`, so it never enters the rolling window or pages.
    "ccusage_fallback",
    // Daemon hit a 401 with no fresher token on disk and paused autosync until
    // the user re-logs-in. User-specific, not prod breakage — also non-paging.
    "auth_expired",
    // `autosync off` couldn't kill the daemon (macOS launchctl edge).
    "autosync_off_failed",
  ]),
  distinctId: z.string().min(1).max(64).optional(),
  props: z.record(z.string().max(40), z.union([z.string().max(200), z.number(), z.boolean()])).optional(),
});

// Rolling in-memory window of install-funnel failures, surfaced at
// GET /telemetry/failures so the scheduled health workflow can alert when
// installs break in the wild (we only learned about the Node 20/21 ESM crash
// from a user DM). Restarts clear it — fine: the alert cares about "failing
// NOW", and PostHog/Railway logs keep the history.
const FAILURE_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_FAILURES_KEPT = 1000;
interface FailureEntry {
  event: string;
  step: string;
  os: string;
  at: number;
}
const failures: FailureEntry[] = [];

function pruneFailures(now: number) {
  const cutoff = now - FAILURE_WINDOW_MS;
  let drop = 0;
  while (drop < failures.length && (failures[drop] as FailureEntry).at < cutoff) drop++;
  if (drop > 0) failures.splice(0, drop);
  if (failures.length > MAX_FAILURES_KEPT) failures.splice(0, failures.length - MAX_FAILURES_KEPT);
}

function recordFailure(event: string, props: Record<string, unknown>) {
  const now = Date.now();
  failures.push({ event, step: String(props["step"] ?? "unknown"), os: String(props["os"] ?? "unknown"), at: now });
  pruneFailures(now);
}

/** Test-only: clear the rolling failure window. */
export function resetFailuresForTest() {
  failures.length = 0;
}

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

export function telemetryRoute(store?: LeaderboardStore) {
  const app = new Hono();
  app.post("/", zValidator("json", bodySchema), (c) => {
    const { event, distinctId, props } = c.req.valid("json");
    const failureEvents = [
      "install_failed",
      "enlist_failed",
      "sync_failed",
      "tool_collection_failed",
      "self_update_failed",
      "self_update_rollback",
      "self_update_relaunch_failed",
      "autosync_off_failed",
    ];
    if (failureEvents.includes(event)) {
      recordFailure(event, props ?? {});
    }
    captureEvent(event, distinctId ?? "anonymous", props ?? {});
    return c.json({ ok: true });
  });

  // Aggregate failure counts for the health workflow. Anonymous by design:
  // event/step/os/timestamp only, never distinct ids.
  app.get("/failures", (c) => {
    const now = Date.now();
    pruneFailures(now);
    const hourAgo = now - 60 * 60 * 1000;
    const lastHour = failures.filter((f) => f.at >= hourAgo);
    // Background-daemon blips (sync, per-tool collection, self-update) are
    // reported but must not page — only install/enlist failures should.
    const nonPaging = new Set([
      "sync_failed",
      "tool_collection_failed",
      "self_update_failed",
      "self_update_rollback",
      "self_update_relaunch_failed",
      "autosync_off_failed",
    ]);
    const installLastHour = lastHour.filter((f) => !nonPaging.has(f.event));
    const byStep: Record<string, number> = {};
    for (const f of installLastHour) byStep[f.step] = (byStep[f.step] ?? 0) + 1;
    return c.json({
      installFailuresLastHour: installLastHour.length,
      failuresLastHour: lastHour.length,
      failuresLast24h: failures.length,
      byStepLastHour: byStep,
      recent: failures.slice(-10).map((f) => ({ event: f.event, step: f.step, os: f.os, at: new Date(f.at).toISOString() })),
    });
  });
  if (store) {
    app.get("/fleet", (c) => {
      const now = Date.now();
      const entries = store.getTop("30d", 100_000);
      const H = 3.6e6;
      return c.json({
        total: entries.length,
        active: entries.filter((e) => (e.spark ?? []).reduce((a, b) => a + b, 0) > 0).length,
        silent2h: countSilentActive(entries, now, 2 * H),
        silent12h: countSilentActive(entries, now, 12 * H),
        silent24h: countSilentActive(entries, now, 24 * H),
      });
    });
  }
  return app;
}
