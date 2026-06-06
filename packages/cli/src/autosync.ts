// Opt-in scheduled sync: launchd on macOS, cron on Linux.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const LABEL = "xyz.ccwarriors.sync";

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
    try {
      execFileSync("launchctl", ["unload", plistPath()], { stdio: "ignore" });
    } catch {
      /* not loaded yet */
    }
    execFileSync("launchctl", ["load", plistPath()], { stdio: "ignore" });
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
function launchdJobAlive(): boolean {
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

export function autosyncStatus(): string {
  if (!autosyncEnabled()) return "off";
  try {
    const { minutes } = JSON.parse(readFileSync(markerPath(), "utf8")) as { minutes: number };
    return process.platform === "darwin"
      ? `on — background daemon streaming (heartbeat every ${minutes}m)`
      : `on — cron sync every ${minutes} min`;
  } catch {
    return "on";
  }
}
