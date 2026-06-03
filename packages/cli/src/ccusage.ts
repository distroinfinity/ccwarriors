import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

interface CcusageJson {
  daily?: Array<{ totalCost?: number }>;
  totals?: { totalCost?: number };
}

function extractCost(parsed: CcusageJson): number {
  if (typeof parsed.totals?.totalCost === "number") {
    return parsed.totals.totalCost;
  }
  if (Array.isArray(parsed.daily)) {
    return parsed.daily.reduce((sum, d) => sum + (d.totalCost ?? 0), 0);
  }
  return 0;
}

function yyyymmdd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

async function runCcusage(args: string[]): Promise<CcusageJson> {
  const { stdout } = await execFileAsync(
    "npx",
    ["--yes", "ccusage@latest", ...args],
    { timeout: 120_000 }
  );
  return JSON.parse(stdout) as CcusageJson;
}

export interface CcusageCosts {
  cost30d: number;
  costAllTime: number;
  ccusageVersion: string;
}

export async function readCosts(): Promise<CcusageCosts> {
  let allTime: CcusageJson;
  let last30: CcusageJson;

  try {
    const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    [allTime, last30] = await Promise.all([
      runCcusage(["--json"]),
      runCcusage(["--json", "--since", yyyymmdd(since30)]),
    ]);
  } catch (err) {
    console.error(
      "Couldn't read ccusage — make sure you've used Claude Code. Try: npx ccusage@latest"
    );
    process.exit(1);
  }

  const costAllTime = Math.round(extractCost(allTime) * 100) / 100;
  const cost30d = Math.round(extractCost(last30) * 100) / 100;

  // Best-effort version read
  let ccusageVersion = "";
  try {
    const { stdout } = await execFileAsync(
      "npx",
      ["--yes", "ccusage@latest", "--version"],
      { timeout: 30_000 }
    );
    ccusageVersion = stdout.trim();
  } catch {
    // optional — ignore
  }

  return { cost30d, costAllTime, ccusageVersion };
}
