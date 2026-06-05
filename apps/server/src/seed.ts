// Demo seeding + live-spend simulation. Enabled via SEED_DEMO / SIMULATE env flags.
import { LeaderboardStore, type Entry } from "./lib/leaderboard-store.js";
import { computeTier } from "./lib/tier.js";
import type { DB } from "./db/index.js";
import { donations } from "./db/schema.js";

const SCENES = [
  "crane", "wave", "fujiDawn", "sakura", "temple",
  "bonsai", "fujiNight", "monk", "torii",
];

const PEOPLE: Array<[string, string]> = [
  ["torvaldsjr", "torvaldsjr"], ["shipfast", "shipfast_dev"], ["nightowl", "nightowl"],
  ["vibecoder", "vibecoder"], ["promptsmith", "promptsmith"], ["laurakdev", "laurakdev"],
  ["merge_conflict", "merge_conflict"], ["async_andy", "async_andy"], ["kernelpanic", "kernelpanic"],
  ["ctrl_z", "ctrl_z"], ["segfault", "segfault"], ["yak_shaver", "yak_shaver"],
  ["regexwizard", "regexwizard"], ["rubberduck", "rubberduck"], ["manu", "getdodge"],
];

const SEED_30D = [9847, 8120, 6755, 4980, 4210, 3650, 3110, 2740, 2390, 2050, 1760, 1540, 1180, 1020, 812];

// Deterministic per-tool split so the demo shows realistic multi-tool boards:
// everyone burns claude; codex/gemini/copilot/opencode show up for subsets.
const DEMO_TOOLS = ["claude", "codex", "gemini", "copilot", "opencode"] as const;

function demoBreakdown(total: number, i: number): Record<string, number> {
  const weights: number[] = [
    0.45 + ((i * 7) % 10) / 40, // claude always dominant
    i % 2 === 0 ? 0.25 + ((i * 3) % 10) / 50 : 0, // codex for half
    i % 3 === 0 ? 0.15 : 0, // gemini for a third
    i % 4 === 1 ? 0.1 : 0, // copilot
    i % 5 === 2 ? 0.08 : 0, // opencode
  ];
  const sum = weights.reduce((s, w) => s + w, 0);
  const breakdown: Record<string, number> = {};
  let allocated = 0;
  DEMO_TOOLS.forEach((tool, t) => {
    const w = weights[t] ?? 0;
    if (w <= 0) return;
    const v = Math.round((total * w) / sum);
    breakdown[tool] = v;
    allocated += v;
  });
  breakdown["claude"] = (breakdown["claude"] ?? 0) + (total - allocated); // exact total
  return breakdown;
}

export function seedDemo(store: LeaderboardStore): void {
  PEOPLE.forEach(([login, x], i) => {
    const c30 = SEED_30D[i] ?? 500;
    const all = Math.round(c30 * (2.4 + (i % 4) * 0.5));
    store.upsert({
      id: login,
      githubLogin: login,
      avatarUrl: `https://i.pravatar.cc/120?img=${(i * 5 + 3) % 70}`,
      xHandle: x,
      tier: computeTier(all),
      cardScene: SCENES[i % SCENES.length] ?? "fujiNight",
      cost30d: c30,
      costAllTime: all,
      breakdown: demoBreakdown(c30, i),
    });
  });

  // SEED_EXTRA=N adds synthetic warriors past the named ones — lets the web
  // app's infinite scroll be exercised beyond the live top-100 in dev.
  const extra = Math.max(0, Math.floor(Number(process.env.SEED_EXTRA ?? 0)));
  for (let i = 0; i < extra; i++) {
    const c30 = Math.max(2, Math.round(760 * Math.exp(-i / 45) + ((i * 13) % 9)));
    const all = Math.round(c30 * 2.6);
    const login = `warrior_${String(i + 1).padStart(3, "0")}`;
    store.upsert({
      id: login,
      githubLogin: login,
      avatarUrl: `https://i.pravatar.cc/120?img=${(i * 7 + 11) % 70}`,
      xHandle: login,
      tier: computeTier(all),
      cardScene: SCENES[i % SCENES.length] ?? "fujiNight",
      cost30d: c30,
      costAllTime: all,
      breakdown: demoBreakdown(c30, i + 4),
    });
  }
}

// Demo donors so the sponsor wall isn't empty in dev. Mixed tiers, one
// anonymous, one unpaid (must stay invisible — proves /sponsors filters).
export async function seedDemoDonations(db: DB): Promise<void> {
  const day = 86_400_000;
  const base = Date.now();
  const rows: Array<[string, number, string | null, "paid" | "created", number]> = [
    ["order_demo_1", 6400, "shipfast", "paid", 1],
    ["order_demo_2", 1600, "laurakdev", "paid", 3],
    ["order_demo_3", 400, null, "paid", 5], // → "Anonymous warrior"
    ["order_demo_4", 25600, "torvaldsjr", "paid", 8],
    ["order_demo_5", 800, "rubberduck", "paid", 12],
    ["order_demo_6", 3200, "ghost_donor", "created", 0], // never on the wall
  ];
  await db
    .insert(donations)
    .values(
      rows.map(([razorpayOrderId, amount, name, status, daysAgo]) => ({
        razorpayOrderId,
        amount: String(amount),
        name,
        status,
        razorpayPaymentId: status === "paid" ? `pay_${razorpayOrderId}` : null,
        createdAt: new Date(base - daysAgo * day),
      })),
    )
    .onConflictDoNothing();
}

// Every few seconds, a random warrior burns a bit more — drives live reordering.
// Bumps land on one of the warrior's tools so filtered boards reorder too.
export function startSimulation(store: LeaderboardStore, broadcast: () => void): NodeJS.Timeout {
  let tick = 0;
  return setInterval(() => {
    const top = store.getTop("30d", 100);
    if (top.length === 0) return;
    const victim = top[Math.floor(Math.random() * top.length)]!;
    const bump = tick % 7 === 0 ? 300 + Math.random() * 900 : 15 + Math.random() * 120;
    const cost30d = Math.round(victim.cost30d + bump);
    const costAllTime = Math.round(victim.costAllTime + bump);
    const tools = Object.keys(victim.breakdown ?? { claude: 1 });
    const tool = tools[Math.floor(Math.random() * tools.length)] ?? "claude";
    const breakdown: Entry["breakdown"] = {
      ...victim.breakdown,
      [tool]: Math.round((victim.breakdown?.[tool] ?? 0) + bump),
    };
    store.upsert({ ...victim, cost30d, costAllTime, breakdown, tier: computeTier(costAllTime) });
    broadcast();
    tick++;
  }, 2500);
}
