import { describe, it, expect } from "vitest";
import { bootstrapArgs, kickstartArgs, bootoutArgs, statusLine, LABEL, darwinAutosyncSteps, shouldRearm, relaunchAfterUpdate, ensureDaemonAlive } from "../src/autosync.js";

describe("launchctl argv builders", () => {
  it("bootstrap targets the gui domain with the plist path", () => {
    expect(bootstrapArgs(501, "/u/Library/LaunchAgents/x.plist")).toEqual([
      "bootstrap", "gui/501", "/u/Library/LaunchAgents/x.plist",
    ]);
  });
  it("kickstart -k targets the job in the gui domain", () => {
    expect(kickstartArgs(501, LABEL)).toEqual(["kickstart", "-k", `gui/501/${LABEL}`]);
  });
  it("bootout targets the job in the gui domain", () => {
    expect(bootoutArgs(501, LABEL)).toEqual(["bootout", `gui/501/${LABEL}`]);
  });
});

describe("statusLine", () => {
  it("off when not enabled", () => {
    expect(statusLine({ enabled: false, minutes: 5, jobAlive: false, platform: "darwin" }))
      .toBe("off");
  });
  it("off when not enabled regardless of platform", () => {
    expect(statusLine({ enabled: false, minutes: 5, jobAlive: false, platform: "linux" })).toBe("off");
  });
  it("darwin + alive → streaming", () => {
    expect(statusLine({ enabled: true, minutes: 5, jobAlive: true, platform: "darwin" }))
      .toContain("background daemon streaming");
  });
  it("darwin + enabled but dead → warns daemon not running", () => {
    const s = statusLine({ enabled: true, minutes: 5, jobAlive: false, platform: "darwin" });
    expect(s).toContain("NOT running");
    expect(s).toContain("ccwarriors autosync on");
    expect(s).toContain("on but");
  });
  it("linux always reports cron (no launchd liveness)", () => {
    expect(statusLine({ enabled: true, minutes: 5, jobAlive: false, platform: "linux" }))
      .toContain("cron sync");
  });
});

describe("darwinAutosyncSteps", () => {
  it("is bootout → bootstrap → kickstart, never legacy load", () => {
    const verbs = darwinAutosyncSteps(501, "/u/x.plist", LABEL).map((s) => s[0]);
    expect(verbs).toEqual(["bootout", "bootstrap", "kickstart"]);
  });
  it("passes the plist path to bootstrap and the job to kickstart", () => {
    const steps = darwinAutosyncSteps(501, "/u/x.plist", LABEL);
    expect(steps[1]).toEqual(["bootstrap", "gui/501", "/u/x.plist"]);
    expect(steps[2]).toEqual(["kickstart", "-k", `gui/501/${LABEL}`]);
  });
});

describe("shouldRearm", () => {
  const base = { enabled: true, platform: "darwin" as NodeJS.Platform, jobAlive: false, plistExists: true };
  it("rearms when enabled, darwin, job dead, plist present", () => {
    expect(shouldRearm(base)).toBe(true);
  });
  it("does not rearm when the job is alive", () => {
    expect(shouldRearm({ ...base, jobAlive: true })).toBe(false);
  });
  it("does not rearm when disabled", () => {
    expect(shouldRearm({ ...base, enabled: false })).toBe(false);
  });
  it("does not rearm off-darwin (cron self-recovers)", () => {
    expect(shouldRearm({ ...base, platform: "linux" })).toBe(false);
  });
  it("does not rearm when the plist is missing", () => {
    expect(shouldRearm({ ...base, plistExists: false })).toBe(false);
  });
});

describe("relaunchAfterUpdate", () => {
  it("non-darwin → foreground (re-exec)", () => {
    expect(relaunchAfterUpdate({ platform: "linux" })).toBe("foreground");
  });
  it("darwin but autosync disabled → foreground", () => {
    expect(relaunchAfterUpdate({ platform: "darwin", enabled: false, plistExists: true })).toBe("foreground");
  });
  it("darwin, enabled, no plist → foreground", () => {
    expect(relaunchAfterUpdate({ platform: "darwin", enabled: true, plistExists: false })).toBe("foreground");
  });
  it("under launchd + kickstart succeeds → relaunched", () => {
    expect(relaunchAfterUpdate({ platform: "darwin", enabled: true, plistExists: true, kickstart: () => {} })).toBe("relaunched");
  });
  it("under launchd + kickstart throws → kickstart_failed (caller must not re-exec)", () => {
    expect(
      relaunchAfterUpdate({ platform: "darwin", enabled: true, plistExists: true, kickstart: () => { throw new Error("boom"); } }),
    ).toBe("kickstart_failed");
  });
});

describe("ensureDaemonAlive", () => {
  it("off when autosync disabled", () => {
    expect(ensureDaemonAlive({ enabled: false })).toBe("off");
  });
  it("unsupported off-darwin (cron self-recovers)", () => {
    expect(ensureDaemonAlive({ enabled: true, platform: "linux" })).toBe("unsupported");
  });
  it("ok when the job is already alive", () => {
    expect(ensureDaemonAlive({ enabled: true, platform: "darwin", jobAlive: true })).toBe("ok");
  });
  it("off when dead but no plist to re-arm from", () => {
    expect(ensureDaemonAlive({ enabled: true, platform: "darwin", jobAlive: false, plistExists: false })).toBe("off");
  });
  it("rearmed when dead + plist + restart succeeds", () => {
    expect(ensureDaemonAlive({ enabled: true, platform: "darwin", jobAlive: false, plistExists: true, rearm: () => {} })).toBe("rearmed");
  });
  it("failed (not off) when the restart itself errors", () => {
    expect(
      ensureDaemonAlive({ enabled: true, platform: "darwin", jobAlive: false, plistExists: true, rearm: () => { throw new Error("x"); } }),
    ).toBe("failed");
  });
});
