// Background daemon: event-driven sync. Watches agent log dirs for usage
// writes (debounced), plus a heartbeat. Run under launchd via `autosync on`.
import { existsSync, watch } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig, ensureMachineId, ensureInsightsSalt } from "./config.js";
import { readUsage, formatEstimates } from "./ccusage.js";
import { postIngest, postTelemetry, postInsightsDeep } from "./core.js";
import { maybeSelfUpdate, markUpdateSuccess, markBuildAlive } from "./selfupdate.js";
import { nextBackoffMs, shouldSync } from "./backoff.js";
import { collectDeepInsights, shouldSend, markSent } from "./insights.js";

declare const __BUILD_ID__: string;

const DEBOUNCE_MS = 12_000; // respects the server's 10s minimum between syncs

// Where the agents write usage locally. Watching these makes syncs land the
// moment a session writes tokens; agents without a known dir ride the heartbeat.
const WATCH_DIRS = [
  path.join(os.homedir(), ".claude", "projects"), // Claude Code
  path.join(os.homedir(), ".codex"), // Codex
  path.join(os.homedir(), ".gemini"), // Gemini CLI
  path.join(os.homedir(), ".copilot"), // Copilot CLI
];

const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);

export async function runDaemon(heartbeatMin = 5): Promise<void> {
  const config = await loadConfig();
  if (!config) {
    console.error("not enlisted — run `ccwarriors login` first");
    process.exit(1);
  }
  const cfg = config; // non-null binding for use inside closures below
  const token = cfg.token;
  const machineId = await ensureMachineId(cfg);

  let timer: NodeJS.Timeout | null = null;
  let syncing = false;
  let pending = false;
  // Beacon once after 3 consecutive hard failures (not 429s), reset on success —
  // surfaces fleet-wide sync breakage without spamming telemetry.
  let failStreak = 0;
  // While > now, syncs are suppressed (backoff after hard failures).
  let nextAllowedSyncAt = 0;

  async function checkForUpdate(): Promise<void> {
    if ((await maybeSelfUpdate()) === "updated") {
      // launchd (KeepAlive) restarts us on the freshly-swapped bundle.
      log("self-update installed — restarting on the new build");
      process.exit(0);
    }
  }

  async function syncNow(reason: string): Promise<void> {
    if (syncing) {
      pending = true;
      return;
    }
    syncing = true;
    try {
      const { tools, estimates, ccusageVersion } = await readUsage();
      const res = await postIngest(token, {
        tools,
        machineId,
        clientBuildId: __BUILD_ID__,
        ...(ccusageVersion ? { ccusageVersion } : {}),
      });
      if (res.data?.ok) {
        failStreak = 0;
        nextAllowedSyncAt = 0;
        markUpdateSuccess();
        log(`synced (${reason}) — ${formatEstimates(estimates)} · rank #${res.data.rank30d ?? "—"}`);
        const deepWanted =
          res.data.insightsMode === "deep" ||
          (res.data.insightsMode === undefined && res.data.insightsRequested === true);
        if (deepWanted) {
          void (async () => {
            try {
              if (!(await shouldSend())) return;
              const salt = await ensureInsightsSalt(cfg);
              const payload = await collectDeepInsights(salt);
              if (!payload) return;
              const sent = await postInsightsDeep(token, machineId, payload);
              if (sent.ok) {
                await markSent();
                log("insights synced");
              }
            } catch {
              /* never break the daemon */
            }
          })();
        }
      } else if (res.status === 429) {
        // Server enforces 10s between syncs — retry instead of dropping the update.
        log(`sync deferred (${reason}) — rate limited, retrying`);
        schedule(`retry ${reason}`);
      } else {
        log(`sync skipped (${reason}) — status ${res.status}`);
        failStreak += 1;
        nextAllowedSyncAt = Date.now() + nextBackoffMs(failStreak);
        if (failStreak === 3) void postTelemetry("sync_failed", { status: res.status, reason });
      }
    } catch (err) {
      log(`sync failed (${reason}) — ${err instanceof Error ? err.message : String(err)}`);
      failStreak += 1;
      nextAllowedSyncAt = Date.now() + nextBackoffMs(failStreak);
      if (failStreak === 3) {
        void postTelemetry("sync_failed", {
          status: 0,
          reason: String(err instanceof Error ? err.message : err).slice(0, 120),
        });
      }
    } finally {
      syncing = false;
      // We ran a full sync cycle without crashing → this build is alive even if
      // the sync itself failed for external reasons. Clears any rollback marker.
      markBuildAlive();
      if (pending) {
        pending = false;
        schedule("queued change");
      }
    }
  }

  function schedule(reason: string): void {
    // Batch, don't reset: fire DEBOUNCE_MS after the FIRST event in a burst.
    // Resetting on every fs event starved syncs during continuous agent
    // activity (the timer never fired until a 12s quiet gap appeared).
    if (timer) return;
    if (!shouldSync(Date.now(), nextAllowedSyncAt)) return; // in backoff cooldown
    timer = setTimeout(() => {
      timer = null;
      void syncNow(reason);
    }, DEBOUNCE_MS);
  }

  log(`ccwarriors daemon up (${__BUILD_ID__}) — heartbeat every ${heartbeatMin}m`);
  void syncNow("startup");
  void checkForUpdate();

  let watching = 0;
  for (const dir of WATCH_DIRS) {
    if (!existsSync(dir)) continue;
    try {
      watch(dir, { recursive: true }, () => schedule("usage change"));
      log(`watching ${dir}`);
      watching++;
    } catch (err) {
      log(`fs watch unavailable for ${dir} (${err instanceof Error ? err.message : String(err)})`);
    }
  }
  if (watching === 0) log("no agent dirs found to watch — heartbeat only");

  setInterval(() => {
    if (shouldSync(Date.now(), nextAllowedSyncAt)) void syncNow("heartbeat");
    void checkForUpdate();
  }, Math.max(1, heartbeatMin) * 60_000);
}
