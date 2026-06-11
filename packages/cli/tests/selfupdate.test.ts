import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { markBuildAlive } from "../src/selfupdate.js";

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
