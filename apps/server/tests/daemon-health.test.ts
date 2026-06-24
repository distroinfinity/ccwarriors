import { describe, expect, it } from "vitest";
import { findStaleDaemons, type DaemonSyncRow } from "../src/lib/daemon-health.js";

const NOW = Date.parse("2026-06-24T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000);

function row(overrides: Partial<DaemonSyncRow>): DaemonSyncRow {
  return {
    githubLogin: "u",
    lastSyncedAt: hoursAgo(0),
    syncs7d: 100,
    lastBuild: "a107383",
    ...overrides,
  };
}

describe("findStaleDaemons", () => {
  it("returns all-zero on no rows", () => {
    const r = findStaleDaemons([], NOW);
    expect(r).toMatchObject({ daemonUsers: 0, silent2h: 0, silent12h: 0, silent24h: 0, stale: [] });
  });

  it("ignores users below the daemon sync threshold (manual syncers)", () => {
    const rows = [
      row({ githubLogin: "manual", syncs7d: 3, lastSyncedAt: hoursAgo(48) }),
      row({ githubLogin: "daemon", syncs7d: 500, lastSyncedAt: hoursAgo(0.1) }),
    ];
    const r = findStaleDaemons(rows, NOW);
    expect(r.daemonUsers).toBe(1); // only "daemon" counts
    expect(r.silent24h).toBe(0); // the stale one was a manual syncer, excluded
  });

  it("buckets silent daemons by 2h / 12h / 24h", () => {
    const rows = [
      row({ githubLogin: "live", lastSyncedAt: hoursAgo(0.2) }),
      row({ githubLogin: "silent3h", lastSyncedAt: hoursAgo(3) }),
      row({ githubLogin: "silent13h", lastSyncedAt: hoursAgo(13) }),
      row({ githubLogin: "silent30h", lastSyncedAt: hoursAgo(30) }),
    ];
    const r = findStaleDaemons(rows, NOW);
    expect(r.daemonUsers).toBe(4);
    expect(r.silent2h).toBe(3); // 3h, 13h, 30h
    expect(r.silent12h).toBe(2); // 13h, 30h
    expect(r.silent24h).toBe(1); // 30h
  });

  it("returns the silent cohort worst-first with build + silence", () => {
    const rows = [
      row({ githubLogin: "a", lastSyncedAt: hoursAgo(5), lastBuild: "ae19ade" }),
      row({ githubLogin: "b", lastSyncedAt: hoursAgo(40), lastBuild: "0ed14df" }),
      row({ githubLogin: "live", lastSyncedAt: hoursAgo(0.5) }),
    ];
    const r = findStaleDaemons(rows, NOW);
    expect(r.stale.map((s) => s.githubLogin)).toEqual(["b", "a"]); // worst-first, live excluded
    expect(r.stale[0]).toMatchObject({ githubLogin: "b", silentHours: 40, lastBuild: "0ed14df" });
  });

  it("caps the sample but keeps the counts exact", () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      row({ githubLogin: `u${i}`, lastSyncedAt: hoursAgo(13 + i) }),
    );
    const r = findStaleDaemons(rows, NOW, { sampleSize: 5 });
    expect(r.silent12h).toBe(30); // exact count, not capped
    expect(r.stale).toHaveLength(5); // sample capped
  });

  it("honors a custom staleHours threshold for the sample", () => {
    const rows = [
      row({ githubLogin: "silent3h", lastSyncedAt: hoursAgo(3) }),
      row({ githubLogin: "silent20h", lastSyncedAt: hoursAgo(20) }),
    ];
    const tight = findStaleDaemons(rows, NOW, { staleHours: 12 });
    expect(tight.stale.map((s) => s.githubLogin)).toEqual(["silent20h"]);
    expect(tight.thresholds.staleHours).toBe(12);
  });

  it("does not flag a daemon that synced moments ago", () => {
    const r = findStaleDaemons([row({ lastSyncedAt: hoursAgo(0.01) })], NOW);
    expect(r.stale).toEqual([]);
    expect(r.silent2h).toBe(0);
  });
});
