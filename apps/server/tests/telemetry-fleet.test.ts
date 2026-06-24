import { describe, it, expect } from "vitest";
import { LeaderboardStore } from "../src/lib/leaderboard-store.js";
import { telemetryRoute } from "../src/routes/telemetry.js";

function makeEntry(id: string, spark: number[], lastSyncedAt?: number) {
  return {
    id,
    githubLogin: id,
    avatarUrl: "",
    xHandle: null,
    tier: "bronze",
    cardScene: "default",
    cost30d: spark.reduce((a, b) => a + b, 0),
    costAllTime: spark.reduce((a, b) => a + b, 0),
    spark,
    lastSyncedAt,
  };
}

describe("GET /fleet", () => {
  const H = 3.6e6;
  const now = Date.now();

  // active, synced 30h ago → counted in silent24h
  const staleActive = makeEntry("alice", [5, 0, 2], now - 30 * H);
  // active, synced 1h ago → fresh, NOT counted in silent24h
  const freshActive = makeEntry("bob", [0, 3, 0], now - 1 * H);
  // inactive (all-zero spark), stale → never counted as silent-active
  const inactiveStale = makeEntry("carol", [0, 0, 0], now - 30 * H);

  const store = new LeaderboardStore();
  store.upsert(staleActive);
  store.upsert(freshActive);
  store.upsert(inactiveStale);

  const app = telemetryRoute(store);

  it("returns the expected shape with correct total count", async () => {
    const res = await app.request("/fleet");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { total: number; active: number; silent2h: number; silent12h: number; silent24h: number };
    expect(body.total).toBe(3);
  });

  it("counts the stale active entry in silent24h", async () => {
    const res = await app.request("/fleet");
    const body = (await res.json()) as { total: number; active: number; silent2h: number; silent12h: number; silent24h: number };
    expect(body.silent24h).toBeGreaterThanOrEqual(1);
    expect(body.active).toBe(2); // alice + bob are active; carol is not
  });

  it("does NOT count the fresh active entry in silent24h", async () => {
    const res = await app.request("/fleet");
    const body = (await res.json()) as { total: number; active: number; silent2h: number; silent12h: number; silent24h: number };
    // only alice (30h stale) is in silent24h; bob (1h fresh) is not
    expect(body.silent24h).toBe(1);
  });
});
