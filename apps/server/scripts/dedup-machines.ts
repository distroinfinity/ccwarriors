// One-time migration: collapse duplicate machine rows caused by machineId churn.
//
// Before the deterministic-machineId fix (#57), a single physical machine that
// reinstalled / lost config / logged out got a fresh RANDOM machineId, and its
// identical ccusage history was ingested again under the new id. The server
// sums distinct machines, so cost/tier/rank doubled (and the burn-rate gate
// then false-flagged the jump).
//
// This script removes only the DUPLICATE rows: a (day, tool) where two machines
// carry NEAR-IDENTICAL cost (the same ccusage data synced twice). Genuine
// multi-machine users (laptop + desktop, with DIFFERENT cost per machine on a
// day) are preserved untouched. After de-duping it recomputes each affected
// user's cost_30d / cost_all_time / tool_breakdown / tier and clears any
// burn-rate false-positive flag.
//
// Safe by default: prints a dry-run report. Pass --apply to write.
//   DATABASE_URL=postgres://... pnpm exec tsx scripts/dedup-machines.ts [--apply]
import postgres from "postgres";
import { computeTier } from "../src/lib/tier.js";

const ABS_TOL = 0.5; // within $0.50 → same
const REL_TOL = 0.02; // or within 2% → same
const WINDOW_DAYS = 30;

const apply = process.argv.includes("--apply");
const url = process.env["DATABASE_URL"] ?? process.env["DEDUP_DATABASE_URL"];
if (!url) {
  console.error("Set DATABASE_URL (or DEDUP_DATABASE_URL) to the target Postgres.");
  process.exit(1);
}
const sql = postgres(url);

const near = (a: number, b: number) => {
  const d = Math.abs(a - b);
  return d <= ABS_TOL || d / Math.max(a, b, 1) <= REL_TOL;
};
const tok = (r: Row) =>
  Number(r.input_tokens) + Number(r.output_tokens) + Number(r.cache_creation_tokens) + Number(r.cache_read_tokens);
// A TRUE duplicate is the same physical machine's same ccusage day synced twice
// under a churned machineId — so the rows are EXACTLY identical: same priced
// cost and same per-field token counts. Exact match (not "near") is essential:
// a near tolerance produces false positives on legit second machines that
// merely had a coincidentally similar day (verified on prod 2026-06-10 — the
// only real duplicate was a test-induced one, fixed manually; every other
// multi-machine user does genuinely different work per machine). `near` is kept
// only for the optional reporting threshold below.
const isDuplicate = (a: Row, b: Row) =>
  Number(a.cost) === Number(b.cost) &&
  a.input_tokens === b.input_tokens &&
  a.output_tokens === b.output_tokens &&
  a.cache_creation_tokens === b.cache_creation_tokens &&
  a.cache_read_tokens === b.cache_read_tokens;
void near; // retained for future heuristics; exact match is the safe default
const r2 = (n: number) => Math.round(n * 100) / 100;

interface Row {
  id: string;
  machine_id: string;
  tool: string;
  day: string;
  cost: string;
  input_tokens: string;
  output_tokens: string;
  cache_creation_tokens: string;
  cache_read_tokens: string;
}

async function main() {
  // Users with more than one machine are the only candidates.
  const users = await sql<{ id: string; github_login: string; cost_30d: string; flag_reason: string | null }[]>`
    select u.id, u.github_login, u.cost_30d, u.flag_reason
    from users u
    where (select count(distinct machine_id) from usage_days d where d.user_id = u.id) > 1
    order by u.github_login`;

  const cutoff30 = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  let totalDeleted = 0;
  const changed: string[] = [];

  for (const u of users) {
    const rows = await sql<Row[]>`
      select id, machine_id, tool, day::text, cost::text,
             input_tokens::text, output_tokens::text,
             cache_creation_tokens::text, cache_read_tokens::text
      from usage_days where user_id = ${u.id}`;

    // Group by (day, tool). Within a group, cluster machines whose cost is
    // near-identical = duplicates of one physical machine; keep the row with the
    // most tokens, mark the rest for deletion.
    const byKey = new Map<string, Row[]>();
    for (const row of rows) {
      const k = `${row.day}|${row.tool}`;
      (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(row);
    }
    const toDelete: Row[] = [];
    for (const group of byKey.values()) {
      if (group.length < 2) continue;
      const used = new Set<string>();
      for (let i = 0; i < group.length; i++) {
        const a = group[i]!;
        if (used.has(a.id)) continue;
        const dupes = [a];
        for (let j = i + 1; j < group.length; j++) {
          const b = group[j]!;
          if (!used.has(b.id) && isDuplicate(a, b)) dupes.push(b);
        }
        if (dupes.length > 1) {
          // keep the row with the most total tokens; delete the rest
          dupes.sort(
            (x, y) =>
              Number(y.input_tokens) + Number(y.output_tokens) + Number(y.cache_read_tokens) -
              (Number(x.input_tokens) + Number(x.output_tokens) + Number(x.cache_read_tokens)),
          );
          for (const d of dupes.slice(1)) {
            toDelete.push(d);
            used.add(d.id);
          }
          used.add(dupes[0]!.id);
        }
      }
    }

    if (toDelete.length === 0) continue;

    // Recompute aggregates from the SURVIVING rows.
    const survivingIds = new Set(rows.map((x) => x.id));
    for (const d of toDelete) survivingIds.delete(d.id);
    const surviving = rows.filter((x) => survivingIds.has(x.id));
    const breakdown: Record<string, { cost30d: number; costAllTime: number }> = {};
    for (const x of surviving) {
      const b = (breakdown[x.tool] ??= { cost30d: 0, costAllTime: 0 });
      const c = Number(x.cost);
      b.costAllTime += c;
      if (x.day >= cutoff30) b.cost30d += c;
    }
    let cost30 = 0;
    let costAll = 0;
    for (const t of Object.keys(breakdown)) {
      breakdown[t]!.cost30d = r2(breakdown[t]!.cost30d);
      breakdown[t]!.costAllTime = r2(breakdown[t]!.costAllTime);
      cost30 += breakdown[t]!.cost30d;
      costAll += breakdown[t]!.costAllTime;
    }
    cost30 = r2(cost30);
    costAll = r2(costAll);
    const clearFlag = (u.flag_reason ?? "").startsWith("burn_rate");

    changed.push(
      `${u.github_login}: -${toDelete.length} dup rows · cost_30d ${u.cost_30d} → ${cost30}` +
        (clearFlag ? " · clears burn_rate flag" : ""),
    );
    totalDeleted += toDelete.length;

    if (apply) {
      await sql.begin(async (tx) => {
        await tx`delete from usage_days where id in ${sql(toDelete.map((d) => d.id))}`;
        await tx`update users set
          cost_30d = ${String(cost30)},
          cost_all_time = ${String(costAll)},
          tool_breakdown = ${sql.json(breakdown)},
          tier = ${computeTier(costAll)}
          ${clearFlag ? sql`, flagged_at = null, flag_reason = null` : sql``}
          where id = ${u.id}`;
      });
    }
  }

  console.log(`\n${apply ? "APPLIED" : "DRY RUN"} — ${changed.length} user(s), ${totalDeleted} duplicate rows`);
  for (const c of changed) console.log("  " + c);
  if (!apply && changed.length) console.log("\nRe-run with --apply to write. Then restart the API to re-warm the board.");
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
