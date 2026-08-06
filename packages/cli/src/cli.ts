import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline";
import { bold, cyan, dim, green, red, underline, yellow } from "./ui.js";
import { loadConfig, saveConfig, clearConfig, ensureMachineId, ensureInsightsSalt, CONSENT_VERSION, type Config } from "./config.js";
import { runLoginFlow } from "./auth.js";
import { readUsage, formatEstimates } from "./ccusage.js";
import { autosyncEnabled, autosyncOff, autosyncOn, autosyncStatus, ensureDaemonAlive } from "./autosync.js";
import { runDaemon } from "./daemon.js";
import { API_BASE, WEB_BASE, postIngest, postTelemetry, postInsightsDeep, postTranscripts, setInsightsConsent, getInsightsMode } from "./core.js";
import { maybeSelfUpdate, markUpdateSuccess, selfUpdateBootCheck } from "./selfupdate.js";
import { collectDeepInsights, shouldSend, markSent } from "./insights.js";
import { collectTranscripts } from "./transcripts.js";

declare const __BUILD_ID__: string;

// Canonical install commands — shown in `--help` and in the self-update
// fallback nudge. Keep in sync with apps/web (the YourCard reinstall nudge)
// and apps/web/public/install.sh, which can't import this constant.
const INSTALL_SH = "curl -fsSL https://ccwarriors.xyz/install.sh | bash";
const INSTALL_PS1 = "irm https://ccwarriors.xyz/install.ps1 | iex";
const installCommand = (): string => (process.platform === "win32" ? INSTALL_PS1 : INSTALL_SH);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function printHelp(): void {
  console.log(`
${bold("ccwarriors")} — sync your AI coding costs and climb the leaderboard
${dim("Counts every agent ccusage can read: Claude Code, Codex, Gemini, Copilot, OpenCode, Amp, and friends.")}

${bold("INSTALL")}
  macOS/Linux:  ${INSTALL_SH}
  Windows:      ${INSTALL_PS1}

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
  ccwarriors insights on|off|status   Behavioral insights for your profile page (opt in)
  ccwarriors insights --dry-run       Print the exact per-session payload that would upload — nothing is sent
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

/** After a good sync: when the server asks for deep mode and the 6h throttle
    allows, extract the per-session + git-outcome payload locally and push it.
    Fire-and-forget — sync UX never blocks. Falls back to the legacy
    insightsRequested bool when an old server omits insightsMode. */
async function maybePushInsights(token: string, machineId: string, data: import("./core.js").IngestResponse, verbose: boolean): Promise<void> {
  const deepWanted = data.insightsMode === "deep" || (data.insightsMode === undefined && data.insightsRequested === true);
  if (!deepWanted) return;
  try {
    let config = await loadConfig();
    if (!config) return;
    // Adoption runs BEFORE the throttle: a user who just clicked "Unlock my
    // story" on the web must not wait out the 6h window — the fresh ack
    // forces this sync's push so the story forges within minutes.
    const hadAck = consentAcked(config);
    config = await adoptServerConsent(config, data.consentVersion);
    const freshlyAdopted = !hadAck && consentAcked(config);
    if (!freshlyAdopted && !(await shouldSend())) return;
    const salt = await ensureInsightsSalt(config);
    const acked = consentAcked(config);
    const result = await collectDeepInsights(salt, { textExtracts: acked });
    if (result.status === "error") {
      // Extraction broke — beacon it so a fleet-wide regression is visible,
      // but never break the sync UX.
      void postTelemetry("insights_extract_error", { message: result.message.slice(0, 200) });
      return;
    }
    if (result.status !== "ok") return;
    const res = await postInsightsDeep(token, machineId, result.payload);
    if (res.ok) {
      await markSent();
      if (verbose) console.log(dim("   insights synced — your archetype is forging at ccwarriors.xyz"));
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
    // insights must never break a sync
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

  if (Object.keys(tools).length === 0) {
    // A stale npx-cached ccusage binary fails silently and reads as "no usage"
    // (seen in the wild: a native binary linking a GC'd nix library).
    console.log(yellow("  ccusage returned no usage — if this persists, try `npx --yes ccusage@latest` manually; a stale npx cache can break the binary."));
  }
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
    // Stale token (rotated by a login on another machine, or a reinstall over
    // an old config) — re-enlist right here instead of bouncing the user to a
    // second command, then retry the sync once. machineId survives the
    // re-login (auth.ts merges it) so history stays under the same key.
    console.log(yellow("Your token expired — re-enlisting…"));
    config = await runLoginFlow(API_BASE);
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
      console.error(red("Still unauthorized after a fresh login — run `ccwarriors login` or report this."));
      process.exit(1);
    }
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

  // Existing deep users who predate the v2 disclosure: one-line nudge, never a
  // mid-sync prompt. `ccwarriors insights on` (or the web GO ALL-IN, which the
  // next sync adopts automatically) is where they review and decide.
  const deepOn = data.insightsMode === "deep" || (data.insightsMode === undefined && data.insightsRequested === true);
  if (deepOn && !consentAcked(config) && (data.consentVersion ?? 1) < CONSENT_VERSION) {
    console.log(yellow("   Deep mode grew richer (go-to prompts + your story). Run `ccwarriors insights on` to review and unlock it."));
  }

  // After the user has their output: extraction is fs-bound and can take seconds cold.
  await maybePushInsights(config.token, machineId, result.data, true);

  // After a good sync (and after the user has their output): pick up a newer
  // build if one shipped. Cron/manual runs use it on their next invocation.
  const updateOutcome = await maybeSelfUpdate();
  if (updateOutcome === "updated") {
    console.log(dim("   ccwarriors updated to the latest build — active on the next run"));
  } else if (updateOutcome === "failed") {
    console.log(yellow("   A new ccwarriors is available but auto-update couldn't apply it."));
    console.log(yellow(`   Reinstall to get the latest (profiles, insights, all your tools): ${installCommand()}`));
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

/** Has this user acknowledged the current deep-mode disclosure? */
function consentAcked(config: Config): boolean {
  return (config.ackConsentVersion ?? 1) >= CONSENT_VERSION;
}

/**
 * Adopt a consent acknowledged elsewhere (the web GO ALL-IN button shows the
 * same full disclosure). The server tells us via the ingest response; we
 * persist it so this machine's syncs include text extracts from now on.
 */
export async function adoptServerConsent(config: Config, serverVersion: number | undefined): Promise<Config> {
  if (typeof serverVersion !== "number" || serverVersion < CONSENT_VERSION || consentAcked(config)) return config;
  const next = { ...config, ackConsentVersion: serverVersion };
  await saveConfig(next);
  return next;
}

const DEEP_V2_DISCLOSURE = `
${bold("Deep mode now extracts more (everything is in the docs):")}
  • per-session counts, timing, model names      ${dim("(as before)")}
  • hashed git outcomes — commits, lines, tests  ${dim("(as before)")}
  • redacted prompts + tool-call names            ${dim("(new — story only, secrets stripped)")}
  • story source cleanup                          ${dim("(new — analyzed once, then deleted)")}
${dim("Never your code, file contents, file paths, or repo names.")}
`;

/**
 * One-time v2 disclosure. Interactive only — the daemon never prompts.
 * Declining keeps deep on with counts-only (no text ever leaves).
 */
async function ensureConsentAck(config: Config): Promise<boolean> {
  if (consentAcked(config)) return true;
  if (!process.stdin.isTTY) return false;
  console.log(DEEP_V2_DISCLOSURE);
  const answer = await new Promise<string>((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`Continue with the expanded deep mode? ${dim("[Y/n]")} `, (a) => {
      rl.close();
      resolve(a.trim().toLowerCase());
    });
  });
  const yes = answer === "" || answer === "y" || answer === "yes";
  if (yes) {
    await saveConfig({ ...config, ackConsentVersion: CONSENT_VERSION });
    void setInsightsConsent(config.token, true, CONSENT_VERSION).catch(() => {});
    console.log(green("Got it — full deep mode on."));
  } else {
    console.log(yellow("Staying on counts-only deep mode. Your prompts and transcripts will not leave this machine."));
  }
  return yes;
}

async function cmdInsights(args: string[]): Promise<void> {
  const sub = args[0];
  if (sub === "--dry-run" || sub === "dry-run") {
    console.log(dim("Extracting locally — nothing is sent. This is the exact payload a sync would upload:"));
    // Use the persisted salt when logged in; otherwise an ephemeral one so the
    // dry-run works without auth (the salt only affects opaque hashes anyway).
    const config = await loadConfig();
    const salt = config ? await ensureInsightsSalt(config) : randomBytes(16).toString("hex");
    // Dry-run mirrors exactly what a sync would upload: text extracts appear
    // only if this user already acknowledged the v2 disclosure.
    const result = await collectDeepInsights(salt, { textExtracts: !!config && consentAcked(config) });
    if (result.status === "error") {
      console.error(red(`Insights extraction failed: ${result.message}`));
      console.error(red("Your sessions exist but could not be read — try deleting ~/.claude-warriors/insights-cache.json and re-running."));
      process.exit(1);
    }
    console.log(JSON.stringify(result.status === "ok" ? result.payload : null, null, 2));
    return;
  }
  const config = await loadConfig();
  if (!config) {
    console.error(red("Not enlisted — run `ccwarriors login` first."));
    process.exit(1);
  }
  if (sub === "on") {
    // setInsightsConsent(true) → server sets mode=deep (back-compat path).
    const res = await setInsightsConsent(config.token, true);
    if (!res.ok) {
      console.error(red(`Could not enable insights (status ${res.status}).`));
      process.exit(1);
    }
    console.log(green("Insights on."));
    const fresh = (await loadConfig()) ?? config;
    const textExtracts = await ensureConsentAck(fresh);
    console.log(
      dim(
        textExtracts
          ? "Extracting from your local sessions now — secrets are stripped on this machine before anything leaves it."
          : "Extracting from your local sessions now — counts and hashed git outcomes only.",
      ),
    );
    const machineId = await ensureMachineId(config);
    const salt = await ensureInsightsSalt(config);
    const result = await collectDeepInsights(salt, { textExtracts });
    if (result.status === "ok") {
      const sent = await postInsightsDeep(config.token, machineId, result.payload);
      if (sent.ok) {
        await markSent();
        console.log(green(`Done — see your archetype at ${WEB_BASE}/u/${encodeURIComponent(config.login)}`));
        if (textExtracts) {
          // Story material rides along under the same v2 consent. Best-effort:
          // a failure here never degrades the insights flow.
          try {
            const transcripts = await collectTranscripts();
            if (transcripts) {
              const tr = await postTranscripts(config.token, machineId, transcripts);
              if (tr.ok) console.log(dim(`   story material sent — your story is forging at ${WEB_BASE}/${encodeURIComponent(config.login)}/story`));
              else void postTelemetry("transcripts_send_failed", { status: tr.status });
            }
          } catch {
            /* best-effort */
          }
        }
      } else {
        console.error(red(`Upload failed (status ${sent.status}) — it will retry on the next sync.`));
      }
    } else if (result.status === "error") {
      // Error ≠ empty. Saying "no sessions" to someone with hundreds of them
      // is how this bug hid in the wild — be honest and point at the fix.
      void postTelemetry("insights_extract_error", { message: result.message.slice(0, 200) });
      console.error(red(`Insights extraction failed: ${result.message}`));
      console.error(red("Your sessions exist but could not be read — try deleting ~/.claude-warriors/insights-cache.json and re-running `ccwarriors insights on`."));
      process.exit(1);
    } else {
      console.log(yellow("No local Claude Code sessions found in the last 40 days — your profile unlocks after you code."));
    }
    return;
  }
  if (sub === "off") {
    const res = await setInsightsConsent(config.token, false);
    if (!res.ok) {
      console.error(red(`Could not disable insights (status ${res.status}).`));
      process.exit(1);
    }
    console.log(green("Insights off — server-side behavioral data deleted."));
    return;
  }
  if (sub !== undefined && sub !== "status") {
    console.error(red(`Unknown insights subcommand: ${sub}`));
    console.log("usage: ccwarriors insights on|off|status|--dry-run");
    process.exit(1);
  }
  const status = await getInsightsMode(config.token);
  console.log(`insights: ${status ? (status.mode === "deep" ? "on" : "off") : "unknown (network error)"}`);
}

async function cmdAutosync(args: string[]): Promise<void> {
  const sub = args[0];
  if (sub === "on") {
    const minutes = Number(args[1] ?? 15) || 15;
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
    try {
      autosyncOff();
    } catch (err) {
      // "off" must mean off — if the daemon survived, say so loudly and let
      // telemetry tell us it's still happening in the wild.
      await postTelemetry("autosync_off_failed", {});
      throw err;
    }
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
    await selfUpdateBootCheck();
    await cmdWatch(args.slice(1));
    return;
  }

  if (cmd === "autosync") {
    await cmdAutosync(args.slice(1));
    return;
  }

  if (cmd === "daemon") {
    await selfUpdateBootCheck();
    await runDaemon(Number(args[1] ?? 15) || 15);
    return;
  }

  if (cmd === "sync" || cmd === undefined) {
    await selfUpdateBootCheck();
    await cmdSync();
    // A manual run is the moment to revive a daemon that died on a past
    // self-update (#91). Silent unless we acted: re-armed it, or tried and failed.
    const heal = ensureDaemonAlive();
    if (heal === "rearmed") {
      console.log(dim("   (autosync daemon was down — restarted it)"));
    } else if (heal === "failed") {
      console.log(yellow("   autosync daemon is down and couldn't be restarted — run `ccwarriors autosync on`"));
    }
    return;
  }

  if (cmd === "insights") {
    await cmdInsights(args.slice(1));
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
