import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
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
}

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

/** Machine id from config, generating + persisting one on first use. */
export async function ensureMachineId(config: Config): Promise<string> {
  if (config.machineId && /^[a-f0-9]{8,64}$/.test(config.machineId)) return config.machineId;
  const machineId = randomBytes(8).toString("hex");
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
