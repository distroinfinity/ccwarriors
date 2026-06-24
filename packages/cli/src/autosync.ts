// Opt-in scheduled sync: launchd on macOS, cron on Linux.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

export const LABEL = "xyz.ccwarriors.sync";

/** `launchctl bootstrap gui/<uid> <plist>` — modern load (replaces `load`). */
export function bootstrapArgs(uid: number, plistPath: string): string[] {
  return ["bootstrap", `gui/${uid}`, plistPath];
}
/** `launchctl kickstart -k gui/<uid>/<label>` — force (re)start the tracked job. */
export function kickstartArgs(uid: number, label: string): string[] {
  return ["kickstart", "-k", `gui/${uid}/${label}`];
}
/** `launchctl bootout gui/<uid>/<label>` — modern unload. */
export function bootoutArgs(uid: number, label: string): string[] {
  return ["bootout", `gui/${uid}/${label}`];
}

/** Ordered launchctl steps to (re)load the daemon on macOS: clear any stale
 *  instance, modern-load the plist, force-start. bootout/bootstrap may no-op
 *  (not loaded / already loaded) — only kickstart must succeed. */
export function darwinAutosyncSteps(uid: number, plist: string, label: string): string[][] {
  return [bootoutArgs(uid, label), bootstrapArgs(uid, plist), kickstartArgs(uid, label)];
}

/** Pure status string. Liveness only meaningful on darwin (launchd). */
export function statusLine(opts: {
  enabled: boolean;
  minutes: number;
  jobAlive: boolean;
  platform: NodeJS.Platform;
}): string {
  if (!opts.enabled) return "off";
  if (opts.platform === "darwin") {
    return opts.jobAlive
      ? `on — background daemon streaming (heartbeat every ${opts.minutes}m)`
      : "on but daemon NOT running — run `ccwarriors autosync on` to restart it";
  }
  return `on — cron sync every ${opts.minutes} min`;
}

const plistPath = () => path.join(os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const markerPath = () => path.join(os.homedir(), ".claude-warriors", "autosync.json");
const logPath = () => path.join(os.homedir(), ".ccwarriors", "autosync.log");

export function autosyncEnabled(): boolean {
  return existsSync(markerPath());
}

function binPaths() {
  const node = process.execPath;
  const cli = path.resolve(process.argv[1] ?? "");
  const pathEnv = `${path.dirname(node)}:/usr/local/bin:/usr/bin:/bin`;
  return { node, cli, pathEnv };
}

export function autosyncOn(minutes: number): void {
  const every = Math.max(1, Math.round(minutes));
  const { node, cli, pathEnv } = binPaths();
  mkdirSync(path.dirname(logPath()), { recursive: true });

  if (process.platform === "darwin") {
    // A persistent daemon (event-driven file watcher + heartbeat), not a polling timer.
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array>
    <string>${node}</string>
    <string>${cli}</string>
    <string>daemon</string>
    <string>${every}</string>
  </array>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>${pathEnv}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${logPath()}</string>
  <key>StandardErrorPath</key><string>${logPath()}</string>
</dict></plist>
`;
    mkdirSync(path.dirname(plistPath()), { recursive: true });
    writeFileSync(plistPath(), plist);
    const uid = process.getuid?.() ?? 501;
    // Modern bootstrap + kickstart. Legacy `load` + RunAtLoad/KeepAlive is
    // unreliable on recent macOS (job never starts/relaunches — issue #91).
    const steps = darwinAutosyncSteps(uid, plistPath(), LABEL);
    for (const args of steps) {
      try {
        execFileSync("launchctl", args, { stdio: "ignore" });
      } catch {
        // bootout (not loaded) and bootstrap (already loaded) may fail benignly;
        // a kickstart failure is real — surface it.
        if (args[0] === "kickstart") throw new Error("autosync: launchctl kickstart failed");
      }
    }
  } else if (process.platform === "linux") {
    const schedule = every < 60 ? `*/${every} * * * *` : `0 */${Math.max(1, Math.round(every / 60))} * * *`;
    const line = `${schedule} PATH=${pathEnv} ${node} ${cli} sync >> ${logPath()} 2>&1 # ${LABEL}`;
    let current = "";
    try {
      current = execFileSync("crontab", ["-l"], { encoding: "utf8" });
    } catch {
      /* empty crontab */
    }
    const kept = current.split("\n").filter((l) => l.trim() && !l.includes(LABEL));
    kept.push(line);
    execFileSync("crontab", ["-"], { input: kept.join("\n") + "\n" });
  } else {
    throw new Error("autosync isn't supported on this platform yet — run `ccwarriors` manually.");
  }

  mkdirSync(path.dirname(markerPath()), { recursive: true });
  writeFileSync(markerPath(), JSON.stringify({ minutes: every, node, cli }, null, 2) + "\n");
}

/** Is the launchd job still loaded? (macOS only) */
export function launchdJobAlive(): boolean {
  try {
    execFileSync("launchctl", ["print", `gui/${process.getuid?.() ?? 501}/${LABEL}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function autosyncOff(): void {
  if (process.platform === "darwin") {
    const uid = process.getuid?.() ?? 501;
    // `bootout` is the modern call and reliably kills a KeepAlive daemon;
    // legacy `unload` can fail silently on newer macOS, leaving the daemon
    // running until reboot while we claim it's off (reported in the wild).
    try {
      execFileSync("launchctl", ["bootout", `gui/${uid}/${LABEL}`], { stdio: "ignore" });
    } catch {
      try {
        execFileSync("launchctl", ["unload", plistPath()], { stdio: "ignore" });
      } catch {
        /* not loaded */
      }
    }
    rmSync(plistPath(), { force: true });
    if (launchdJobAlive()) {
      rmSync(markerPath(), { force: true });
      throw new Error(
        `the background daemon is still loaded. Stop it manually:\n` +
          `  launchctl bootout gui/${uid}/${LABEL}`,
      );
    }
  } else if (process.platform === "linux") {
    let current = "";
    try {
      current = execFileSync("crontab", ["-l"], { encoding: "utf8" });
    } catch {
      /* empty crontab */
    }
    const kept = current.split("\n").filter((l) => l.trim() && !l.includes(LABEL));
    execFileSync("crontab", ["-"], { input: kept.length ? kept.join("\n") + "\n" : "" });
  }
  rmSync(markerPath(), { force: true });
}

/** Pure self-heal decision: re-arm only when autosync is on, on macOS, with a
 *  plist present, but launchd has no live job. */
export function shouldRearm(opts: { enabled: boolean; platform: NodeJS.Platform; jobAlive: boolean; plistExists: boolean }): boolean {
  return opts.enabled && opts.platform === "darwin" && !opts.jobAlive && opts.plistExists;
}

export function autosyncStatus(): string {
  if (!autosyncEnabled()) return "off";
  let minutes = 5;
  try { minutes = (JSON.parse(readFileSync(markerPath(), "utf8")) as { minutes: number }).minutes; } catch { /* default */ }
  const jobAlive = process.platform === "darwin" ? launchdJobAlive() : true;
  return statusLine({ enabled: true, minutes, jobAlive, platform: process.platform });
}

/** Re-arm a dead daemon. Safe to call on any interactive run; only acts when
 *  autosync is enabled (marker present) but launchd has no live job. */
export function ensureDaemonAlive(): "ok" | "rearmed" | "off" | "unsupported" {
  if (!autosyncEnabled()) return "off";
  if (process.platform !== "darwin") return "unsupported"; // cron self-recovers
  const jobAlive = launchdJobAlive();
  if (jobAlive) return "ok";
  if (!shouldRearm({ enabled: true, platform: "darwin", jobAlive, plistExists: existsSync(plistPath()) })) return "off";
  try {
    const uid = process.getuid?.() ?? 501;
    try { execFileSync("launchctl", bootstrapArgs(uid, plistPath()), { stdio: "ignore" }); } catch { /* maybe already bootstrapped */ }
    execFileSync("launchctl", kickstartArgs(uid, LABEL), { stdio: "ignore" });
    return "rearmed";
  } catch { /* best-effort; status already tells the truth */ }
  return "off";
}

/** Called by the daemon right after a self-update swap. Kickstart the tracked
 *  job so launchd relaunches onto the NEW bundle. Returns true if issued. */
export function relaunchAfterUpdate(): boolean {
  if (process.platform !== "darwin") return false; // cron picks up next run
  if (!autosyncEnabled() || !existsSync(plistPath())) return false; // foreground daemon
  try {
    const uid = process.getuid?.() ?? 501;
    execFileSync("launchctl", kickstartArgs(uid, LABEL), { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
