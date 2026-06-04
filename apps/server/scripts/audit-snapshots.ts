// One-off, READ-ONLY audit: replay snapshot history and surface users whose
// cost jumped faster than a human can plausibly burn — the riggers who gamed
// the board before server-side validation existed.
//
//   DATABASE_URL="postgres://…" pnpm --filter server exec tsx scripts/audit-snapshots.ts
//
// Output is a suspect list; flagging stays manual (POST /admin/flag).

import { asc, eq } from "drizzle-orm";
import { createDb } from "../src/db/index.js";
import { users, snapshots } from "../src/db/schema.js";

const MAX_HOURLY_BURN = Number(process.env["GATE_MAX_HOURLY_BURN"] ?? 500);
const BURN_SLACK = Number(process.env["GATE_BURN_SLACK"] ?? 200);

async function main() {
  const url = process.env["DATABASE_URL"];
  if (!url) {
    console.error("DATABASE_URL required (read-only audit against prod or a copy)");
    process.exit(1);
  }
  const db = createDb(url);

  const allUsers = await db.select().from(users);
  console.log(`auditing ${allUsers.length} users…\n`);

  const suspects: Array<{ login: string; worst: string; jumps: number }> = [];

  for (const u of allUsers) {
    const rows = await db
      .select()
      .from(snapshots)
      .where(eq(snapshots.userId, u.id))
      .orderBy(asc(snapshots.capturedAt));
    let jumps = 0;
    let worst = "";
    let worstDelta = 0;
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1]!;
      const cur = rows[i]!;
      const delta = Number(cur.cost30d) - Number(prev.cost30d);
      const hours = (cur.capturedAt.getTime() - prev.capturedAt.getTime()) / 3_600_000;
      const allowed = Math.max(0, hours) * MAX_HOURLY_BURN + BURN_SLACK;
      if (delta > allowed) {
        jumps++;
        if (delta > worstDelta) {
          worstDelta = delta;
          worst = `+$${delta.toFixed(0)} in ${hours.toFixed(2)}h on ${cur.capturedAt.toISOString()}`;
        }
      }
    }
    if (jumps > 0) {
      suspects.push({ login: u.githubLogin, worst, jumps });
      console.log(
        `SUSPECT ${u.githubLogin}  flagged=${!!u.flaggedAt}  cost30d=$${Number(u.cost30d).toFixed(0)}  jumps=${jumps}  worst: ${worst}`,
      );
    }
  }

  console.log(`\n${suspects.length} suspect(s).`);
  if (suspects.length > 0) {
    console.log(`\nflag with:\n  curl -X POST "$API/admin/flag" -H "x-admin-token: $ADMIN_TOKEN" \\`);
    console.log(`    -H 'content-type: application/json' -d '{"githubLogin":"<login>","reason":"audit: burn-rate"}'`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
