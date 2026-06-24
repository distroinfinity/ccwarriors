import { describe, it, expect } from "vitest";
import { bootstrapArgs, kickstartArgs, bootoutArgs, statusLine, LABEL, darwinAutosyncSteps } from "../src/autosync.js";

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
