// Shared API plumbing for sync, watch, and the background daemon.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RawDay } from "./ccusage.js";
import type { InsightsPayload, InsightsDeepPayload } from "./insights.js";

export const API_BASE = process.env["CCWARRIORS_API"] ?? "https://api.ccwarriors.xyz";
export const WEB_BASE = process.env["CCWARRIORS_WEB"] ?? "https://ccwarriors.xyz";

// Channel attribution ref, planted by the installer (env during the install
// run, ~/.ccwarriors/ref afterwards). Read once — it never changes mid-process.
export const REF: string | null = (() => {
  const sanitize = (raw: string) => raw.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 64) || null;
  const env = process.env["CCWARRIORS_REF"];
  if (env) return sanitize(env);
  try {
    const home = process.env["CCWARRIORS_HOME"] ?? join(homedir(), ".ccwarriors");
    return sanitize(readFileSync(join(home, "ref"), "utf8").trim());
  } catch {
    return null;
  }
})();

export interface IngestResponse {
  ok: boolean;
  tier?: string;
  rank30d?: number | null;
  rankAllTime?: number | null;
  insightsRequested?: boolean;
  insightsMode?: "off" | "deep";
}

// v3 payload: raw per-tool/day/model token counts. The server prices and
// validates everything — no client-computed dollars are sent.
export interface IngestPayload {
  tools: Record<string, RawDay[]>;
  machineId: string;
  clientBuildId: string;
  ccusageVersion?: string;
}

export async function postIngest(
  token: string,
  payload: IngestPayload,
): Promise<{ status: number; data?: IngestResponse; text: string }> {
  const res = await fetch(`${API_BASE}/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let data: IngestResponse | undefined;
  try {
    data = JSON.parse(text) as IngestResponse;
  } catch {
    /* non-JSON error body */
  }
  return { status: res.status, data, text };
}

export async function postInsights(
  token: string,
  machineId: string,
  insights: InsightsPayload,
): Promise<{ status: number; ok: boolean }> {
  const res = await fetch(`${API_BASE}/insights`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ machineId, insights }),
    signal: AbortSignal.timeout(30_000),
  });
  return { status: res.status, ok: res.ok };
}

export async function postInsightsDeep(
  token: string,
  machineId: string,
  payload: InsightsDeepPayload,
): Promise<{ status: number; ok: boolean }> {
  const res = await fetch(`${API_BASE}/insights/deep`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ machineId, windowDays: payload.windowDays, sessions: payload.sessions }),
    // Deep payloads are bigger than the aggregate — give them more headroom.
    signal: AbortSignal.timeout(60_000),
  });
  return { status: res.status, ok: res.ok };
}

export async function setInsightsMode(token: string, mode: "off" | "deep"): Promise<{ status: number; ok: boolean }> {
  const res = await fetch(`${API_BASE}/insights/mode`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ mode }),
    signal: AbortSignal.timeout(15_000),
  });
  return { status: res.status, ok: res.ok };
}

export async function getInsightsMode(token: string): Promise<{ mode: "off" | "deep" } | null> {
  try {
    const res = await fetch(`${API_BASE}/insights/mode`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as { mode: "off" | "deep" };
  } catch {
    return null;
  }
}

export async function setInsightsConsent(token: string, consent: boolean): Promise<{ status: number; ok: boolean }> {
  const res = await fetch(`${API_BASE}/insights/consent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ consent }),
    signal: AbortSignal.timeout(15_000),
  });
  return { status: res.status, ok: res.ok };
}

export async function getInsightsConsent(token: string): Promise<{ consent: boolean } | null> {
  try {
    const res = await fetch(`${API_BASE}/insights/consent`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as { consent: boolean };
  } catch {
    return null;
  }
}

/** Anonymous failure beacon — fire-and-forget, never throws. Opt-out: CCWARRIORS_TELEMETRY=0. */
export async function postTelemetry(event: string, props: Record<string, string | number | boolean>): Promise<void> {
  if (process.env["CCWARRIORS_TELEMETRY"] === "0") return;
  try {
    await fetch(`${API_BASE}/telemetry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, props: { os: process.platform, ...(REF ? { ref: REF } : {}), ...props } }),
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    /* telemetry must never break the caller */
  }
}
