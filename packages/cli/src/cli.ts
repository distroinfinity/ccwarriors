import { bold, cyan, dim, green, red, underline, yellow } from "./ui.js";
import { loadConfig, clearConfig } from "./config.js";
import { runLoginFlow } from "./auth.js";
import { readCosts } from "./ccusage.js";
import { autosyncEnabled, autosyncOff, autosyncOn, autosyncStatus } from "./autosync.js";
import { runDaemon } from "./daemon.js";
import { API_BASE, WEB_BASE, postIngest, type IngestResponse } from "./core.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function printHelp(): void {
  console.log(`
${bold("ccwarriors")} — sync your Claude Code costs and climb the leaderboard

${bold("INSTALL")}
  curl -fsSL https://ccwarriors.xyz/install.sh | bash

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
  ccwarriors --help     Show this help

${bold("ENVIRONMENT")}
  CCWARRIORS_API   Override API base  (default: https://api.ccwarriors.xyz)
  CCWARRIORS_WEB   Override web base  (default: https://ccwarriors.xyz)
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

  console.log(dim("Reading ccusage…"));
  const { cost30d, costAllTime, ccusageVersion } = await readCosts();

  console.log(dim(`  30-day cost:   $${cost30d}`));
  console.log(dim(`  all-time cost: $${costAllTime}`));
  console.log(dim("Syncing with Claude Warriors…"));

  let result: Awaited<ReturnType<typeof postIngest>>;
  try {
    result = await postIngest(config.token, {
      cost30d,
      costAllTime,
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
    console.error(yellow("Syncing too fast — try again in ~10 seconds."));
    process.exit(1);
  }

  if (result.status < 200 || result.status >= 300 || !result.data) {
    console.error(red(`API error (${result.status}):`), result.text);
    process.exit(1);
  }

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
  }
  console.log();
}

async function cmdWatch(args: string[]): Promise<void> {
  const seconds = Math.max(10, Math.round(Number(args[0] ?? 30) || 30));
  let config = await loadConfig();
  if (!config) {
    console.log(yellow("Hey there — first time? Let's get you enlisted."));
    config = await runLoginFlow(API_BASE);
  }
  console.log(cyan(`⚔️  Watch mode — syncing every ${seconds}s. Ctrl+C to stop.`));
  console.log(dim(`   watch live → ${WEB_BASE}/?u=${encodeURIComponent(config.login)}`));
  for (;;) {
    const t = new Date().toTimeString().slice(0, 8);
    try {
      const { cost30d, costAllTime, ccusageVersion } = await readCosts();
      const res = await postIngest(config.token, {
        cost30d,
        costAllTime,
        ...(ccusageVersion ? { ccusageVersion } : {}),
      });
      if (res.data?.ok) {
        const rank = res.data.rank30d != null ? `#${res.data.rank30d}` : "—";
        console.log(`${dim(`[${t}]`)} synced ${green(`$${cost30d}`)} (30d) · rank ${cyan(rank)}`);
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
      console.log(`  Syncs the moment Claude Code writes usage (heartbeat every ${Math.max(1, Math.round(minutes))}m).`);
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
    await cmdWatch(args.slice(1));
    return;
  }

  if (cmd === "autosync") {
    cmdAutosync(args.slice(1));
    return;
  }

  if (cmd === "daemon") {
    await runDaemon(Number(args[1] ?? 5) || 5);
    return;
  }

  if (cmd === "sync" || cmd === undefined) {
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
