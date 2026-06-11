// Background daemon: event-driven sync. Watches agent log dirs for usage
// writes (debounced), plus a heartbeat. Run under launchd via `autosync on`.
import { existsSync, watch } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig, saveConfig, ensureMachineId, ensureInsightsSalt, CONSENT_VERSION } from "./config.js";
import { readUsage, formatEstimates } from "./ccusage.js";
import { postIngest, postTelemetry, postInsightsDeep, postTranscripts } from "./core.js";
import { collectTranscripts } from "./transcripts.js";
import { maybeSelfUpdate, markUpdateSuccess, markBuildAlive } from "./selfupdate.js";
import { nextBackoffMs, shouldSync } from "./backoff.js";
import { resolveAuthAction } from "./authstate.js";
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
  let token = cfg.token;
  const machineId = await ensureMachineId(cfg);

  let timer: NodeJS.Timeout | null = null;
  let syncing = false;
  let pending = false;
  // Beacon once after 3 consecutive hard failures (not 429s), reset on success —
  // surfaces fleet-wide sync breakage without spamming telemetry.
  let failStreak = 0;
  // While > now, syncs are suppressed (backoff after hard failures).
  let nextAllowedSyncAt = 0;
  // Set true after a 401 with no fresher token on disk; the heartbeat clears it
  // when a re-login appears. Suppresses syncs without thrashing launchd.
  let authPaused = false;

  async function reloadToken(): Promise<string | null> {
    try {
      const c = await loadConfig();
      return c?.token ?? null;
    } catch {
      return null;
    }
  }

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
              // Adopt a consent the user gave on the web (GO ALL-IN / "Unlock
              // my story") BEFORE the throttle — a fresh ack forces this push
              // so the story forges within minutes, not after the 6h window.
              const serverV = res.data?.consentVersion;
              let freshlyAdopted = false;
              if (typeof serverV === "number" && serverV >= CONSENT_VERSION && (cfg.ackConsentVersion ?? 1) < CONSENT_VERSION) {
                cfg.ackConsentVersion = serverV;
                await saveConfig(cfg);
                freshlyAdopted = true;
              }
              if (!freshlyAdopted && !(await shouldSend())) return;
              const salt = await ensureInsightsSalt(cfg);
              const acked = (cfg.ackConsentVersion ?? 1) >= CONSENT_VERSION;
              const result = await collectDeepInsights(salt, { textExtracts: acked });
              if (result.status === "error") {
                void postTelemetry("insights_extract_error", { message: result.message.slice(0, 200) });
                return;
              }
              if (result.status !== "ok") return;
              const sent = await postInsightsDeep(token, machineId, result.payload);
              if (sent.ok) {
                await markSent();
                log("insights synced");
                if (acked) {
                  try {
                    const transcripts = await collectTranscripts();
                    if (transcripts) {
                      const tr = await postTranscripts(token, machineId, transcripts);
                      if (!tr.ok) void postTelemetry("transcripts_send_failed", { status: tr.status });
                    }
                  } catch {
                    /* best-effort */
                  }
                }
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
      } else if (res.status === 401) {
        // Token rotated/expired. Adopt a fresher on-disk token (user re-logged-in
        // elsewhere) and retry without penalty; otherwise pause until re-login.
        const disk = await reloadToken();
        if (disk && resolveAuthAction(token, disk) === "resume") {
          token = disk;
          failStreak = 0;
          nextAllowedSyncAt = 0;
          log("token refreshed from disk — retrying");
          schedule(`auth-refresh ${reason}`);
        } else if (!authPaused) {
          authPaused = true;
          log("token expired — run `ccwarriors login` to re-enable autosync");
          void postTelemetry("auth_expired", { reason });
        }
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
    if (authPaused) return; // paused on auth — heartbeat handles recovery
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
    void (async () => {
      if (authPaused) {
        const disk = await reloadToken();
        if (disk && resolveAuthAction(token, disk) === "resume") {
          token = disk;
          authPaused = false;
          log("re-authenticated — resuming autosync");
        } else {
          return; // still paused; don't sync
        }
      }
      if (shouldSync(Date.now(), nextAllowedSyncAt)) void syncNow("heartbeat");
    })();
    void checkForUpdate();
  }, Math.max(1, heartbeatMin) * 60_000);
}
