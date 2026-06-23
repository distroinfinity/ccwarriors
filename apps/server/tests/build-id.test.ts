import { describe, it, expect } from "vitest";
import { isBuildOutdated } from "../src/lib/build-id.js";

// The shared policy behind the web reinstall nudge (/me) and fleet telemetry
// (ingest). Commit SHAs aren't orderable, so "outdated" means "not provably on
// the latest build". Callers gate on "has synced" themselves.
const LATEST = "abc1234";

describe("isBuildOutdated", () => {
  it("flags a pre-self-update (legacy) client — even when latest is unknown", () => {
    expect(isBuildOutdated({ hasBreakdown: false, clientBuildId: null, latestBuildId: LATEST })).toBe(true);
    expect(isBuildOutdated({ hasBreakdown: false, clientBuildId: null, latestBuildId: "unknown" })).toBe(true);
  });

  it("does NOT flag a client on the latest build", () => {
    expect(isBuildOutdated({ hasBreakdown: true, clientBuildId: LATEST, latestBuildId: LATEST })).toBe(false);
  });

  it("flags a self-update-capable client stuck on an old build", () => {
    expect(isBuildOutdated({ hasBreakdown: true, clientBuildId: "0000old", latestBuildId: LATEST })).toBe(true);
  });

  it("flags a breakdown client that reports no build id (predates clientBuildId / dev)", () => {
    expect(isBuildOutdated({ hasBreakdown: true, clientBuildId: null, latestBuildId: LATEST })).toBe(true);
  });

  it("does NOT flag the fleet on a mismatch when latest is unknown (no false-positive storm)", () => {
    // Server can't read its own bundle → we don't know "latest", so a build-id
    // mismatch must not nuke the whole fleet. Only the legacy signal survives.
    expect(isBuildOutdated({ hasBreakdown: true, clientBuildId: "0000old", latestBuildId: "unknown" })).toBe(false);
    expect(isBuildOutdated({ hasBreakdown: true, clientBuildId: null, latestBuildId: "unknown" })).toBe(false);
  });
});
