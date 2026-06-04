import { bold, cyan, dim, green, red, underline, yellow } from "./ui.js";
import { loadConfig, clearConfig, ensureMachineId } from "./config.js";
import { runLoginFlow } from "./auth.js";
import { readUsage, formatEstimates } from "./ccusage.js";
import { autosyncEnabled, autosyncOff, autosyncOn, autosyncStatus } from "./autosync.js";
import { runDaemon } from "./daemon.js";
import { API_BASE, WEB_BASE, postIngest } from "./core.js";
import { maybeSelfUpdate, markUpdateSuccess, selfUpdateBootCheck } from "./selfupdate.js";

declare const __BUILD_ID__: string;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function printHelp(): void {
  console.log(`
${bold("ccwarriors")} — sync your AI coding costs and climb the leaderboard
${dim("Counts every agent ccusage can read: Claude Code, Codex, Gemini, Copilot, OpenCode, Amp, and friends.")}

${bold("INSTALL")}
  macOS/Linux:  curl -fsSL https://api.ccwarriors.xyz/install.sh | bash
  Windows:      irm https://api.ccwarriors.xyz/install.ps1 | iex

${bold("USAGE")}
  ccwarriors            Sync costs (default)
  ccwarriors login      Authenticate with GitHub
  ccwarriors logout     Remove stored credentials
  ccwarriors whoami     Show the currently enlisted login
  ccwarriors watch [seconds]         Live mode — re-sync every N seconds (default 30, min 10)
  ccwarriors autosync on             Stream usage from a background daemon (real time, survives reboots)
  ccwarriors autosync off            Stop the background daemon
  ccwarriors autosync status         Show whether autosync is enabled
  ccwarriors daemon [heartbeatMin]   Run the sync daemon in the foreground (autosync runs this for you)
  ccwarriors --version  Show the installed build
  ccwarriors --help     Show this help

${bold("ENVIRONMENT")}
  CCWARRIORS_API        Override API base  (default: https://api.ccwarriors.xyz)
  CCWARRIORS_WEB        Override web base  (default: https://ccwarriors.xyz)
  CCWARRIORS_NO_UPDATE  Set to 1 to disable self-update
`);
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

async function cmdLogin(): Promise<void> {
  await runLoginFlow(API_BASE);
}

async function cmdLogout(): Promise<void> {
  await clearConfig();
  console.log(green("Logged out — credentials removed."));
}

async function cmdWhoami(): Promise<void> {
  const config = await loadConfig();
  if (!config) {
    console.log("not enlisted");
  } else {
    console.log(config.login);
  }
}

async function cmdSync(): Promise<void> {
  let config = await loadConfig();

  if (!config) {
    console.log(yellow("Hey there — first time? Let's get you enlisted."));
    config = await runLoginFlow(API_BASE);
  }
  const machineId = await ensureMachineId(config);

  console.log(dim("Reading ccusage (all your coding agents)…"));
  const { tools, estimates, ccusageVersion } = await readUsage();

  console.log(dim(`  found: ${formatEstimates(estimates)} ${dim("(local estimates — the server prices the truth)")}`));
  console.log(dim("Syncing with Claude Warriors…"));

  let result: Awaited<ReturnType<typeof postIngest>>;
  try {
    result = await postIngest(config.token, {
      tools,
      machineId,
      clientBuildId: __BUILD_ID__,
      ...(ccusageVersion ? { ccusageVersion } : {}),
    });
  } catch (err) {
    console.error(red("Network error — could not reach the API."), err);
    process.exit(1);
  }

  if (result.status === 401) {
    await clearConfig();
    console.error(red("Token invalid or expired. Run `ccwarriors login` to re-authenticate."));
    process.exit(1);
  }

  if (result.status === 429) {
    // A sync landed <10s ago (usually the background daemon) — the board is
    // already fresh. Not a failure: exiting 1 here made re-installs end red
    // and aborted the installer before it could enable autosync.
    console.log(yellow("Already synced seconds ago — your numbers are fresh."));
    return;
  }

  if (result.status < 200 || result.status >= 300 || !result.data) {
    console.error(red(`API error (${result.status}):`), result.text);
    process.exit(1);
  }

  markUpdateSuccess();
  const data = result.data;

  const tier = data.tier ?? "—";
  const rank30dDisplay = data.rank30d != null ? `#${data.rank30d}` : "—";
  const rankAllDisplay = data.rankAllTime != null ? `#${data.rankAllTime}` : "—";

  console.log();
  console.log(green(`⚔️  ${bold("You're all set!")}`));
  console.log(`   Tier:        ${cyan(tier)}`);
  console.log(`   30-day rank: ${cyan(rank30dDisplay)}`);
  console.log(`   All-time:    ${cyan(rankAllDisplay)}`);
  console.log(`   See your rank live → ${underline(`${WEB_BASE}/?u=${encodeURIComponent(config.login)}`)}`);
  if (!autosyncEnabled() && (process.platform === "darwin" || process.platform === "linux")) {
    console.log(dim("   tip: `ccwarriors autosync on` keeps your rank fresh every hour"));
  } else if (process.platform === "win32") {
    console.log(dim("   tip: `ccwarriors watch` keeps your rank fresh while it runs"));
  }
  console.log();

  // After a good sync (and after the user has their output): pick up a newer
  // build if one shipped. Cron/manual runs use it on their next invocation.
  if ((await maybeSelfUpdate()) === "updated") {
    console.log(dim("   (ccwarriors updated itself — new version active on the next run)"));
  }
}

async function cmdWatch(args: string[]): Promise<void> {
  const seconds = Math.max(10, Math.round(Number(args[0] ?? 30) || 30));
  let config = await loadConfig();
  if (!config) {
    console.log(yellow("Hey there — first time? Let's get you enlisted."));
    config = await runLoginFlow(API_BASE);
  }
  const machineId = await ensureMachineId(config);
  console.log(cyan(`⚔️  Watch mode — syncing every ${seconds}s. Ctrl+C to stop.`));
  console.log(dim(`   watch live → ${WEB_BASE}/?u=${encodeURIComponent(config.login)}`));
  for (;;) {
    const t = new Date().toTimeString().slice(0, 8);
    try {
      const { tools, estimates, ccusageVersion } = await readUsage();
      const res = await postIngest(config.token, {
        tools,
        machineId,
        clientBuildId: __BUILD_ID__,
        ...(ccusageVersion ? { ccusageVersion } : {}),
      });
      if (res.data?.ok) {
        markUpdateSuccess();
        const rank = res.data.rank30d != null ? `#${res.data.rank30d}` : "—";
        console.log(`${dim(`[${t}]`)} synced ${green(formatEstimates(estimates))} · rank ${cyan(rank)}`);
      } else if (res.status === 429) {
        console.log(dim(`[${t}] server cooldown (10s minimum) — next cycle`));
      } else if (res.status === 401) {
        await clearConfig();
        console.error(red("Token invalid. Run `ccwarriors login` and restart watch."));
        process.exit(1);
      } else {
        console.log(dim(`[${t}] sync failed (${res.status}) — retrying next cycle`));
      }
    } catch (err) {
      console.log(dim(`[${t}] ${err instanceof Error ? err.message : String(err)} — retrying next cycle`));
    }
    await new Promise((r) => setTimeout(r, seconds * 1000));
  }
}

function cmdAutosync(args: string[]): void {
  const sub = args[0];
  if (sub === "on") {
    const minutes = Number(args[1] ?? 5) || 5;
    autosyncOn(minutes);
    if (process.platform === "darwin") {
      console.log(green("Autosync on — background daemon streaming your usage in real time."));
      console.log(`  Syncs the moment your coding agents write usage (heartbeat every ${Math.max(1, Math.round(minutes))}m).`);
    } else {
      console.log(green(`Autosync on — cron sync every ${Math.max(1, Math.round(minutes))} min.`));
    }
    return;
  }
  if (sub === "off") {
    autosyncOff();
    console.log(green("Autosync off."));
    return;
  }
  console.log(`autosync: ${autosyncStatus()}`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (cmd === "--help" || cmd === "-h") {
    printHelp();
    return;
  }

  if (cmd === "--version" || cmd === "-v" || cmd === "version") {
    console.log(`ccwarriors ${__BUILD_ID__}`);
    return;
  }

  if (cmd === "login") {
    await cmdLogin();
    return;
  }

  if (cmd === "logout") {
    await cmdLogout();
    return;
  }

  if (cmd === "whoami") {
    await cmdWhoami();
    return;
  }

  if (cmd === "watch") {
    selfUpdateBootCheck();
    await cmdWatch(args.slice(1));
    return;
  }

  if (cmd === "autosync") {
    cmdAutosync(args.slice(1));
    return;
  }

  if (cmd === "daemon") {
    selfUpdateBootCheck();
    await runDaemon(Number(args[1] ?? 5) || 5);
    return;
  }

  if (cmd === "sync" || cmd === undefined) {
    selfUpdateBootCheck();
    await cmdSync();
    return;
  }

  console.error(red(`Unknown command: ${cmd}`));
  printHelp();
  process.exit(1);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(red("Error:"), message);
  process.exit(1);
});
