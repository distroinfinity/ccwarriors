import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { markBuildAlive, shouldRollback, RELAUNCH_STALE_MS, MAX_STARTS_BEFORE_ROLLBACK } from "../src/selfupdate.js";

// buildId() returns "dev" under vitest (no __BUILD_ID__ define), so the markers
// we write must use "dev" to match the running build.
let dir: string;
let cliPath: string;
let marker: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ccw-selfupdate-"));
  cliPath = join(dir, "cli.js");
  marker = join(dir, "update-pending.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("shouldRollback", () => {
  const base = { buildId: "dev", fromBuild: "old", starts: 0, at: 1000 };
  it("never rolls back without a prev bundle", () => {
    expect(shouldRollback({ ...base, starts: 9 }, { now: 1000, prevExists: false })).toBe(false);
  });
  it("rolls back a build that keeps crashing (starts >= MAX)", () => {
    expect(shouldRollback({ ...base, starts: MAX_STARTS_BEFORE_ROLLBACK }, { now: 1000, prevExists: true })).toBe(true);
  });
  it("does NOT roll back a freshly-swapped build on its first start (starts 0, not stale)", () => {
    expect(shouldRollback({ ...base, starts: 0, at: 1000 }, { now: 1000 + 5_000, prevExists: true })).toBe(false);
  });
  it("rolls back a build that was swapped but never came up (starts 0, stale)", () => {
    expect(shouldRollback({ ...base, starts: 0, at: 1000 }, { now: 1000 + RELAUNCH_STALE_MS + 1, prevExists: true })).toBe(true);
  });
  it("ignores the stale branch when the marker has no timestamp (legacy marker)", () => {
    expect(shouldRollback({ buildId: "dev", fromBuild: "o", starts: 0 }, { now: 9e9, prevExists: true })).toBe(false);
  });
});

describe("markBuildAlive", () => {
  it("clears the pending marker for the current build", () => {
    writeFileSync(marker, JSON.stringify({ buildId: "dev", fromBuild: "old", starts: 2 }));
    markBuildAlive(cliPath);
    expect(existsSync(marker)).toBe(false);
  });

  it("leaves a different build's marker untouched (rollback still possible)", () => {
    writeFileSync(marker, JSON.stringify({ buildId: "some-other-build", fromBuild: "old", starts: 2 }));
    markBuildAlive(cliPath);
    expect(existsSync(marker)).toBe(true);
  });

  it("is a no-op when there is no marker", () => {
    expect(() => markBuildAlive(cliPath)).not.toThrow();
    expect(existsSync(marker)).toBe(false);
  });
});
