import { describe, it, expect } from "vitest";
import { minSyncGapMs, nextBackoffMs, shouldSync, syncDelayMs } from "../src/backoff.js";

describe("nextBackoffMs", () => {
  it("no wait until the first failure", () => {
    expect(nextBackoffMs(0)).toBe(0);
    expect(nextBackoffMs(-1)).toBe(0);
  });
  it("grows exponentially from 1 minute", () => {
    expect(nextBackoffMs(1)).toBe(60_000);
    expect(nextBackoffMs(2)).toBe(300_000);
    expect(nextBackoffMs(3)).toBe(1_500_000);
  });
  it("caps at 30 minutes", () => {
    expect(nextBackoffMs(4)).toBe(1_800_000);
    expect(nextBackoffMs(50)).toBe(1_800_000);
  });
});

describe("shouldSync", () => {
  it("allows when the cooldown has elapsed", () => {
    expect(shouldSync(1000, 1000)).toBe(true);
    expect(shouldSync(1001, 1000)).toBe(true);
  });
  it("blocks while still in cooldown", () => {
    expect(shouldSync(999, 1000)).toBe(false);
  });
});

describe("syncDelayMs (watch-driven sync floor)", () => {
  const GAP = 5 * 60_000;
  const DEBOUNCE = 12_000;

  it("first sync of the process takes the plain debounce", () => {
    expect(syncDelayMs(1_000_000, 0, DEBOUNCE, GAP)).toBe(DEBOUNCE);
  });

  it("stretches the delay to clear the floor after a recent sync", () => {
    // Synced 1 minute ago → wait the remaining 4 minutes, not 12 seconds.
    const now = 1_000_000;
    expect(syncDelayMs(now, now - 60_000, DEBOUNCE, GAP)).toBe(4 * 60_000);
  });

  it("falls back to the debounce once the floor has elapsed", () => {
    const now = 1_000_000;
    expect(syncDelayMs(now, now - GAP, DEBOUNCE, GAP)).toBe(DEBOUNCE);
    expect(syncDelayMs(now, now - GAP - 60_000, DEBOUNCE, GAP)).toBe(DEBOUNCE);
  });

  it("never returns a negative delay", () => {
    expect(syncDelayMs(2_000_000, 1_000, DEBOUNCE, GAP)).toBe(DEBOUNCE);
  });

  // Regression: an fs event that lands WHILE a sync is in flight must still be
  // spaced by the floor. Stamping lastSyncAt on completion instead of on start
  // made these events compare against the previous sync, so they got the bare
  // 12s debounce and fired a second sync ~30s behind the first.
  it("an event during an in-flight sync still respects the floor", () => {
    const startedAt = 1_000_000;
    // Sync started at `startedAt` and is still running 2s later when an fs
    // event arrives. lastSyncAt is the START of the running sync.
    const delay = syncDelayMs(startedAt + 2_000, startedAt, DEBOUNCE, GAP);
    expect(delay).toBe(GAP - 2_000);
    // …i.e. it fires a full gap after the running sync began, not 12s later.
    expect(startedAt + 2_000 + delay).toBe(startedAt + GAP);
  });

  it("a continuous burst collapses to one sync per gap", () => {
    // Mirrors daemon.ts schedule(): an fs event while a timer is already
    // pending is ignored; otherwise it arms a timer for syncDelayMs.
    let lastSyncAt = 0;
    let firesAt: number | null = null;
    const syncs: number[] = [];

    for (let t = 0; t <= 60 * 60_000; t += 1_000) {
      if (firesAt !== null && t >= firesAt) {
        syncs.push(t);
        lastSyncAt = t;
        firesAt = null;
      }
      // An fs event every second — a continuously-active coding session.
      if (firesAt === null) firesAt = t + syncDelayMs(t, lastSyncAt, DEBOUNCE, GAP);
    }

    // An hour of nonstop activity → ~12 syncs, not ~300 (12s debounce alone).
    expect(syncs.length).toBeGreaterThan(10);
    expect(syncs.length).toBeLessThanOrEqual(13);
    // And no two syncs closer together than the floor.
    for (let i = 1; i < syncs.length; i++) {
      expect(syncs[i]! - syncs[i - 1]!).toBeGreaterThanOrEqual(GAP);
    }
  });
});

describe("minSyncGapMs", () => {
  it("defaults to 5 minutes", () => {
    expect(minSyncGapMs({})).toBe(5 * 60_000);
  });
  it("honours the debug override", () => {
    expect(minSyncGapMs({ CCWARRIORS_MIN_SYNC_GAP_MIN: "1" })).toBe(60_000);
  });
  it("ignores junk and non-positive values", () => {
    expect(minSyncGapMs({ CCWARRIORS_MIN_SYNC_GAP_MIN: "nope" })).toBe(5 * 60_000);
    expect(minSyncGapMs({ CCWARRIORS_MIN_SYNC_GAP_MIN: "0" })).toBe(5 * 60_000);
  });
});
