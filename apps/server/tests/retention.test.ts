import { describe, expect, it } from "vitest";
import { pruneSnapshots } from "../src/services/retention.js";
import { makeDb, seedUser } from "./helpers/db.js";
import { snapshots } from "../src/db/schema.js";

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);

describe("pruneSnapshots", () => {
  it("deletes rows past the 14d window and keeps the rest", async () => {
    const db = await makeDb();
    const u = await seedUser(db, { login: "pruned", token: "pruned" });
    if (!u) throw new Error("failed to seed user");
    await db.insert(snapshots).values(
      [1, 7, 13, 15, 30, 60].map((d) => ({
        userId: u.id,
        cost30d: "1",
        costAllTime: "1",
        capturedAt: daysAgo(d),
      })),
    );

    const deleted = await pruneSnapshots(db);

    expect(deleted).toBe(3); // 15d, 30d, 60d
    const left = await db.select({ capturedAt: snapshots.capturedAt }).from(snapshots);
    expect(left).toHaveLength(3);
    // The 7-day stale-daemons window must be fully intact after a prune.
    const sevenDayCutoff = daysAgo(7).getTime() - 60_000;
    expect(left.filter((r) => r.capturedAt.getTime() >= sevenDayCutoff)).toHaveLength(2);
  });

  it("is a no-op when nothing is past the window", async () => {
    const db = await makeDb();
    const u = await seedUser(db, { login: "fresh", token: "fresh" });
    if (!u) throw new Error("failed to seed user");
    await db.insert(snapshots).values({
      userId: u.id,
      cost30d: "1",
      costAllTime: "1",
      capturedAt: daysAgo(1),
    });
    expect(await pruneSnapshots(db)).toBe(0);
  });
});
