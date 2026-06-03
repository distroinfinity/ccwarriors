import { bold, cyan, dim, green, red, underline, yellow } from "./ui.js";
import { loadConfig, clearConfig } from "./config.js";
import { runLoginFlow } from "./auth.js";
import { readCosts } from "./ccusage.js";
import { autosyncEnabled, autosyncOff, autosyncOn, autosyncStatus } from "./autosync.js";

const API_BASE = process.env["CCWARRIORS_API"] ?? "https://api.ccwarriors.xyz";
const WEB_BASE = process.env["CCWARRIORS_WEB"] ?? "https://ccwarriors.xyz";

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
  ccwarriors autosync on [minutes]   Keep your rank fresh automatically (default: every 60 min)
  ccwarriors autosync off            Stop the scheduled sync
  ccwarriors autosync status         Show whether autosync is enabled
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

interface IngestResponse {
  ok: boolean;
  tier?: string;
  rank30d?: number | null;
  rankAllTime?: number | null;
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

  const body = JSON.stringify({
    cost30d,
    costAllTime,
    ...(ccusageVersion ? { ccusageVersion } : {}),
  });

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/ingest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.token}`,
      },
      body,
    });
  } catch (err) {
    console.error(red("Network error — could not reach the API."), err);
    process.exit(1);
  }

  if (res.status === 401) {
    await clearConfig();
    console.error(red("Token invalid or expired. Run `ccwarriors login` to re-authenticate."));
    process.exit(1);
  }

  if (res.status === 429) {
    console.error(yellow("Syncing too fast — try again in a minute."));
    process.exit(1);
  }

  const text = await res.text();

  if (!res.ok) {
    console.error(red(`API error (${res.status}):`), text);
    process.exit(1);
  }

  let data: IngestResponse;
  try {
    data = JSON.parse(text) as IngestResponse;
  } catch {
    console.error(red("Unexpected API response:"), text);
    process.exit(1);
  }

  const tier = data.tier ?? "—";
  const rank30dDisplay = data.rank30d != null ? `#${data.rank30d}` : "—";
  const rankAllDisplay = data.rankAllTime != null ? `#${data.rankAllTime}` : "—";

  console.log();
  console.log(green(`⚔️  ${bold("You're all set!")}`));
  console.log(`   Tier:        ${cyan(tier)}`);
  console.log(`   30-day rank: ${cyan(rank30dDisplay)}`);
  console.log(`   All-time:    ${cyan(rankAllDisplay)}`);
  console.log(`   See your rank live → ${underline(WEB_BASE)}`);
  if (!autosyncEnabled() && (process.platform === "darwin" || process.platform === "linux")) {
    console.log(dim("   tip: `ccwarriors autosync on` keeps your rank fresh every hour"));
  }
  console.log();
}

function cmdAutosync(args: string[]): void {
  const sub = args[0];
  if (sub === "on") {
    const minutes = Number(args[1] ?? 60) || 60;
    autosyncOn(minutes);
    console.log(green(`Autosync on — your costs will sync every ${Math.max(5, Math.round(minutes))} min.`));
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

  if (cmd === "autosync") {
    cmdAutosync(args.slice(1));
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
