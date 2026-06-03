import pc from "picocolors";
import { loadConfig, clearConfig } from "./config.js";
import { runLoginFlow } from "./auth.js";
import { readCosts } from "./ccusage.js";

const API_BASE = process.env["CCWARRIORS_API"] ?? "https://api.ccwarriors.xyz";
const WEB_BASE = process.env["CCWARRIORS_WEB"] ?? "https://ccwarriors.xyz";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function printHelp(): void {
  console.log(`
${pc.bold("claude-warriors")} — sync your Claude Code costs and climb the leaderboard

${pc.bold("USAGE")}
  npx claude-warriors            Sync costs (default)
  npx claude-warriors login      Authenticate with GitHub
  npx claude-warriors logout     Remove stored credentials
  npx claude-warriors whoami     Show the currently enlisted login
  npx claude-warriors --help     Show this help

${pc.bold("ENVIRONMENT")}
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
  console.log(pc.green("Logged out — credentials removed."));
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
    console.log(pc.yellow("No credentials found — starting login…"));
    config = await runLoginFlow(API_BASE);
  }

  console.log(pc.dim("Reading ccusage…"));
  const { cost30d, costAllTime, ccusageVersion } = await readCosts();

  console.log(pc.dim(`  30-day cost:  $${cost30d}`));
  console.log(pc.dim(`  all-time cost: $${costAllTime}`));
  console.log(pc.dim("Syncing with Claude Warriors…"));

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
    console.error(pc.red("Network error — could not reach the API."), err);
    process.exit(1);
  }

  if (res.status === 401) {
    await clearConfig();
    console.error(
      pc.red("Token invalid or expired. Run `npx claude-warriors login` to re-authenticate.")
    );
    process.exit(1);
  }

  if (res.status === 429) {
    console.error(pc.yellow("Syncing too fast — try again in a minute."));
    process.exit(1);
  }

  const text = await res.text();

  if (!res.ok) {
    console.error(pc.red(`API error (${res.status}):`), text);
    process.exit(1);
  }

  let data: IngestResponse;
  try {
    data = JSON.parse(text) as IngestResponse;
  } catch {
    console.error(pc.red("Unexpected API response:"), text);
    process.exit(1);
  }

  const tier = data.tier ?? "—";
  const rank30dDisplay = data.rank30d != null ? `#${data.rank30d}` : "—";
  const rankAllDisplay = data.rankAllTime != null ? `#${data.rankAllTime}` : "—";

  console.log();
  console.log(pc.green(`⚔️  ${pc.bold("Enlisted / updated!")}`));
  console.log(`   Tier:        ${pc.cyan(tier)}`);
  console.log(`   30-day rank: ${pc.cyan(rank30dDisplay)}`);
  console.log(`   All-time:    ${pc.cyan(rankAllDisplay)}`);
  console.log(`   Profile:     ${pc.underline(`${WEB_BASE}/u/${config.login}`)}`);
  console.log();
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

  if (cmd === "sync" || cmd === undefined) {
    await cmdSync();
    return;
  }

  console.error(pc.red(`Unknown command: ${cmd}`));
  printHelp();
  process.exit(1);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(pc.red("Error:"), message);
  process.exit(1);
});
