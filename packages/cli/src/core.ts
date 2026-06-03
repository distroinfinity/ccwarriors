// Shared API plumbing for sync, watch, and the background daemon.

export const API_BASE = process.env["CCWARRIORS_API"] ?? "https://api.ccwarriors.xyz";
export const WEB_BASE = process.env["CCWARRIORS_WEB"] ?? "https://ccwarriors.xyz";

export interface IngestResponse {
  ok: boolean;
  tier?: string;
  rank30d?: number | null;
  rankAllTime?: number | null;
}

export async function postIngest(
  token: string,
  payload: { cost30d: number; costAllTime: number; ccusageVersion?: string },
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

/** Anonymous failure beacon — fire-and-forget, never throws. Opt-out: CCWARRIORS_TELEMETRY=0. */
export async function postTelemetry(event: string, props: Record<string, string | number | boolean>): Promise<void> {
  if (process.env["CCWARRIORS_TELEMETRY"] === "0") return;
  try {
    await fetch(`${API_BASE}/telemetry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, props: { os: process.platform, ...props } }),
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    /* telemetry must never break the caller */
  }
}
