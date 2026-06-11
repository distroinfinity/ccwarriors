import { describe, it, expect } from "vitest";
import { nextBackoffMs, shouldSync } from "../src/backoff.js";

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
