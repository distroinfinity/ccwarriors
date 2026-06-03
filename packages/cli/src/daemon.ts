// Background daemon: event-driven sync. Watches ~/.claude/projects for usage
// writes (debounced), plus a heartbeat. Run under launchd via `autosync on`.
import { existsSync, watch } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "./config.js";
import { readCosts } from "./ccusage.js";
import { postIngest } from "./core.js";

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
        log(`synced (${reason}) — $${cost30d} 30d · rank #${res.data.rank30d ?? "—"}`);
      } else {
        log(`sync skipped (${reason}) — status ${res.status}`);
      }
    } catch (err) {
      log(`sync failed (${reason}) — ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      syncing = false;
      if (pending) {
        pending = false;
        schedule("queued change");
      }
    }
  }

  function schedule(reason: string): void {
    if (timer) clearTimeout(timer);
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
