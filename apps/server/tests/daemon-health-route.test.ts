import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDaemonHealth, daemonHealthRoute } from "../src/routes/daemon-health.js";
import { makeDb, seedUser } from "./helpers/db.js";
import { users, snapshots } from "../src/db/schema.js";

const NOW = Date.parse("2026-06-24T12:00:00Z");
const at = (h: number) => new Date(NOW - h * 3_600_000);

type TestDb = Awaited<ReturnType<typeof makeDb>>;

async function seedDaemon(
  db: TestDb,
  login: string,
  o: { count: number; lastSyncH: number; build: string },
) {
  const u = await seedUser(db, { login, token: login });
  if (!u) throw new Error(`failed to seed ${login}`);
  // Mirror ingest: every sync stamps users.last_synced_at AND client_build_id
  // (the route reads lastBuild straight off the users row).
  await db
    .update(users)
    .set({ lastSyncedAt: at(o.lastSyncH), clientBuildId: o.build })
    .where(eq(users.id, u.id));
  // Newest snapshot (i=0) carries `build` and sits at lastSyncH; the rest are
  // older history, all inside the 7-day window the query scans.
  const rows = Array.from({ length: o.count }, (_, i) => ({
    userId: u.id,
    cost30d: "1",
    costAllTime: "1",
    capturedAt: at(o.lastSyncH + i),
    clientBuildId: i === 0 ? o.build : "older-build",
  }));
  await db.insert(snapshots).values(rows);
  return u;
}

describe("GET /telemetry/stale-daemons", () => {
  const prev = process.env["DAEMON_MIN_SYNCS_7D"];
  beforeAll(() => {
    process.env["DAEMON_MIN_SYNCS_7D"] = "5"; // small threshold so the test stays lean
  });
  afterAll(() => {
    if (prev === undefined) delete process.env["DAEMON_MIN_SYNCS_7D"];
    else process.env["DAEMON_MIN_SYNCS_7D"] = prev;
  });

  it("flags silent daemons, excluding live / manual / flagged users", async () => {
    const db = await makeDb();
    await seedDaemon(db, "deadDaemon", { count: 6, lastSyncH: 13, build: "ae19ade" });
    await seedDaemon(db, "liveDaemon", { count: 6, lastSyncH: 0.1, build: "a107383" });
    await seedDaemon(db, "manualSyncer", { count: 2, lastSyncH: 30, build: "x" }); // below threshold
    const flagged = await seedDaemon(db, "flaggedUser", { count: 6, lastSyncH: 30, build: "y" });
    await db.update(users).set({ flaggedAt: at(1) }).where(eq(users.id, flagged.id));

    const app = daemonHealthRoute(db, () => NOW);
    const res = await app.request("/stale-daemons");
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      daemonUsers: number;
      silent2h: number;
      silent12h: number;
      stale: { githubLogin: string; silentHours: number; lastBuild: string | null }[];
    };
    expect(body.daemonUsers).toBe(2); // dead + live (manual below threshold, flagged excluded)
    expect(body.silent12h).toBe(1); // only deadDaemon
    expect(body.stale.map((s) => s.githubLogin)).toEqual(["deadDaemon"]);
    expect(body.stale[0]).toMatchObject({ silentHours: 13, lastBuild: "ae19ade" });
  });

  // The 7-day aggregate must never run on the request path. It used to, on
  // every hourly health poll, and intermittently blew the workflow's timeout —
  // 8 false "prod health check failing" alerts in Aug 2026 (#110–#117).
  it("serves a precomputed report without re-querying per request", async () => {
    const db = await makeDb();
    await seedDaemon(db, "d1", { count: 6, lastSyncH: 13, build: "ae19ade" });

    const health = createDaemonHealth(db, () => NOW);
    // First request computes (the timer hasn't run in this test).
    const first = (await (await health.route.request("/stale-daemons")).json()) as {
      daemonUsers: number;
      computedAt: string;
    };
    expect(first.daemonUsers).toBe(1);
    expect(first.computedAt).toBe(new Date(NOW).toISOString());

    // A user goes silent AFTER the report was computed. The endpoint keeps
    // serving the stored report — proof it did not re-run the aggregate.
    await seedDaemon(db, "d2", { count: 6, lastSyncH: 40, build: "ae19ade" });
    const second = (await (await health.route.request("/stale-daemons")).json()) as {
      daemonUsers: number;
    };
    expect(second.daemonUsers).toBe(1);
  });

  it("each app instance owns its report (no cross-instance leakage)", async () => {
    const dbA = await makeDb();
    await seedDaemon(dbA, "onlyInA", { count: 6, lastSyncH: 13, build: "b" });
    const dbB = await makeDb();

    const a = (await (await daemonHealthRoute(dbA, () => NOW).request("/stale-daemons")).json()) as {
      daemonUsers: number;
    };
    const b = (await (await daemonHealthRoute(dbB, () => NOW).request("/stale-daemons")).json()) as {
      daemonUsers: number;
    };
    expect(a.daemonUsers).toBe(1);
    expect(b.daemonUsers).toBe(0);
  });
});
