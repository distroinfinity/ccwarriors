// Background daemon: event-driven sync. Watches ~/.claude/projects for usage
// writes (debounced), plus a heartbeat. Run under launchd via `autosync on`.
import { existsSync, watch } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "./config.js";
import { readCosts } from "./ccusage.js";
import { postIngest, postTelemetry } from "./core.js";

const DEBOUNCE_MS = 12_000; // respects the server's 10s minimum between syncs

const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);

export async function runDaemon(heartbeatMin = 5): Promise<void> {
  const config = await loadConfig();
  if (!config) {
    console.error("not enlisted — run `ccwarriors login` first");
    process.exit(1);
  }
  const token = config.token;
  const projectsDir = path.join(os.homedir(), ".claude", "projects");

  let timer: NodeJS.Timeout | null = null;
  let syncing = false;
  let pending = false;
  // Beacon once after 3 consecutive hard failures (not 429s), reset on success —
  // surfaces fleet-wide sync breakage without spamming telemetry.
  let failStreak = 0;

  async function syncNow(reason: string): Promise<void> {
    if (syncing) {
      pending = true;
      return;
    }
    syncing = true;
    try {
      const { cost30d, costAllTime, ccusageVersion } = await readCosts();
      const res = await postIngest(token, {
        cost30d,
        costAllTime,
        ...(ccusageVersion ? { ccusageVersion } : {}),
      });
      if (res.data?.ok) {
        failStreak = 0;
        log(`synced (${reason}) — $${cost30d} 30d · rank #${res.data.rank30d ?? "—"}`);
      } else if (res.status === 429) {
        // Server enforces 10s between syncs — retry instead of dropping the update.
        log(`sync deferred (${reason}) — rate limited, retrying`);
        schedule(`retry ${reason}`);
      } else {
        log(`sync skipped (${reason}) — status ${res.status}`);
        failStreak += 1;
        if (failStreak === 3) void postTelemetry("sync_failed", { status: res.status, reason });
      }
    } catch (err) {
      log(`sync failed (${reason}) — ${err instanceof Error ? err.message : String(err)}`);
      failStreak += 1;
      if (failStreak === 3) {
        void postTelemetry("sync_failed", {
          status: 0,
          reason: String(err instanceof Error ? err.message : err).slice(0, 120),
        });
      }
    } finally {
      syncing = false;
      if (pending) {
        pending = false;
        schedule("queued change");
      }
    }
  }

  function schedule(reason: string): void {
    // Batch, don't reset: fire DEBOUNCE_MS after the FIRST event in a burst.
    // Resetting on every fs event starved syncs during continuous Claude Code
    // activity (the timer never fired until a 12s quiet gap appeared).
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      void syncNow(reason);
    }, DEBOUNCE_MS);
  }

  log(`ccwarriors daemon up — heartbeat every ${heartbeatMin}m`);
  void syncNow("startup");

  if (existsSync(projectsDir)) {
    try {
      watch(projectsDir, { recursive: true }, () => schedule("usage change"));
      log(`watching ${projectsDir} for Claude Code usage`);
    } catch (err) {
      log(`fs watch unavailable (${err instanceof Error ? err.message : String(err)}) — heartbeat only`);
    }
  } else {
    log(`${projectsDir} not found — heartbeat only`);
  }

  setInterval(() => void syncNow("heartbeat"), Math.max(1, heartbeatMin) * 60_000);
}
