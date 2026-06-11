import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { homedir, hostname, userInfo, platform, arch } from "node:os";
import { join } from "node:path";

export interface Config {
  token: string;
  login: string;
  // Stable per-machine id so multi-machine users aggregate by sum server-side
  // instead of overwriting each other's days. Generated once, kept forever.
  machineId?: string;
  // Per-user secret used to salt the local-git outcome hashes (repo/branch).
  // LOCAL-ONLY: this value is never uploaded. Generated once, kept forever.
  insightsSalt?: string;
  // Deep-mode disclosure version the user acknowledged. Text extracts and
  // transcripts (consent v2) only run when this is ≥ 2 — pre-existing deep
  // users keep counts-only until they say yes once.
  ackConsentVersion?: number;
}

/** The disclosure version THIS build ships with (bumped with deep's scope). */
export const CONSENT_VERSION = 2;

const CONFIG_DIR = join(homedir(), ".claude-warriors");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

export async function loadConfig(): Promise<Config | null> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf8");
    return JSON.parse(raw) as Config;
  } catch {
    return null;
  }
}

export async function saveConfig(config: Config): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), { encoding: "utf8", mode: 0o600 });
}

/** sha256(seed) truncated to 16 hex chars. Deterministic by design. */
export function deriveMachineId(seed: string): string {
  return createHash("sha256").update(seed).digest("hex").slice(0, 16);
}

/**
 * Machine id from config, generating + persisting one on first use.
 *
 * A DETERMINISTIC id (hashed from hostname/user/platform/arch) so a reinstall,
 * `logout` (which deletes config), or `rm -rf ~/.claude-warriors` reuses the
 * SAME id — otherwise a fresh random id makes this one machine's usage get
 * counted again on top of the old id (the server sums distinct machines),
 * double-counting cost/tier/rank. Existing configs keep their stored id (the
 * guard below) so nobody's history shifts; only a newly-generated id is derived.
 */
export async function ensureMachineId(config: Config): Promise<string> {
  if (config.machineId && /^[a-f0-9]{8,64}$/.test(config.machineId)) return config.machineId;
  let seed: string;
  try {
    seed = `${hostname()}|${userInfo().username}|${platform()}|${arch()}`;
  } catch {
    seed = randomBytes(16).toString("hex"); // locked-down env (no os info) → random
  }
  const machineId = deriveMachineId(seed);
  await saveConfig({ ...config, machineId });
  return machineId;
}

/**
 * Per-user salt for hashing local-git outcomes, generated + persisted on first
 * use. LOCAL-ONLY: never uploaded. 16 random bytes → 32 hex chars.
 */
export async function ensureInsightsSalt(config: Config): Promise<string> {
  if (config.insightsSalt && /^[a-f0-9]{32}$/.test(config.insightsSalt)) return config.insightsSalt;
  const insightsSalt = randomBytes(16).toString("hex");
  await saveConfig({ ...config, insightsSalt });
  return insightsSalt;
}

export async function clearConfig(): Promise<void> {
  try {
    await unlink(CONFIG_PATH);
  } catch {
    // already gone
  }
}
