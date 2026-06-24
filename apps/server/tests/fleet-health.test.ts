import { describe, it, expect } from "vitest";
import { countSilentActive } from "../src/lib/fleet-health.js";

const H = 3.6e6;
describe("countSilentActive", () => {
  const now = 1_000 * H;
  it("counts active users (nonzero spark) silent beyond the threshold", () => {
    const entries = [
      { spark: [1, 2], lastSyncedAt: now - 3 * H },   // active, 3h silent → counts at 2h
      { spark: [0, 0], lastSyncedAt: now - 9 * H },   // inactive → ignored
      { spark: [5], lastSyncedAt: now - 1 * H },      // active but fresh → no
      { lastSyncedAt: now - 50 * H },                 // no spark → ignored
    ];
    expect(countSilentActive(entries, now, 2 * H)).toBe(1);
    expect(countSilentActive(entries, now, 24 * H)).toBe(0);
  });
  it("ignores entries with no lastSyncedAt", () => {
    expect(countSilentActive([{ spark: [3] }], now, 2 * H)).toBe(0);
  });
});
