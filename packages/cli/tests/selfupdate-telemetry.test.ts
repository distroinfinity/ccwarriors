import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Capture every beacon the updater emits so we can assert the fleet-stall
// signals fire (and that the healthy path stays silent).
const beacons: Array<{ event: string; props: Record<string, unknown> }> = [];
vi.mock("../src/core.js", () => ({
  API_BASE: "https://api.test",
  postTelemetry: (event: string, props: Record<string, unknown>) => {
    beacons.push({ event, props });
    return Promise.resolve();
  },
}));

import { maybeSelfUpdate } from "../src/selfupdate.js";

let dir: string;
let cliPath: string;
let savedArgv1: string | undefined;

beforeEach(() => {
  beacons.length = 0;
  dir = mkdtempSync(join(tmpdir(), "ccw-su-tel-"));
  cliPath = join(dir, "cli.js");
  // installedCliPath() requires argv[1] to realpath to a file named cli.js.
  writeFileSync(cliPath, "#!/usr/bin/env node\n// ccw-build:dev\n");
  savedArgv1 = process.argv[1];
  process.argv[1] = cliPath;
  delete process.env["CCWARRIORS_NO_UPDATE"];
});
afterEach(() => {
  if (savedArgv1 !== undefined) process.argv[1] = savedArgv1;
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

describe("maybeSelfUpdate observability", () => {
  it("beacons skipped(disabled) when a newer build is withheld by the kill switch", async () => {
    vi.stubGlobal(
      "fetch",
      (async () =>
        new Response(JSON.stringify({ buildId: "newbuild", updateEnabled: false }), {
          status: 200,
        })) as unknown as typeof fetch,
    );
    const outcome = await maybeSelfUpdate();
    expect(outcome).toBe("skipped");
    expect(beacons).toContainEqual(
      expect.objectContaining({
        event: "self_update_skipped",
        props: expect.objectContaining({ reason: "disabled", toBuild: "newbuild" }),
      }),
    );
  });

  it("beacons skipped(http_503) when /cli/version is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      (async () => new Response("nope", { status: 503 })) as unknown as typeof fetch,
    );
    const outcome = await maybeSelfUpdate();
    expect(outcome).toBe("skipped");
    expect(beacons).toContainEqual(
      expect.objectContaining({
        event: "self_update_skipped",
        props: expect.objectContaining({ reason: "http_503" }),
      }),
    );
  });

  it("beacons skipped(network) when the version check throws", async () => {
    vi.stubGlobal(
      "fetch",
      (async () => {
        throw new Error("ECONNRESET");
      }) as unknown as typeof fetch,
    );
    const outcome = await maybeSelfUpdate();
    expect(outcome).toBe("skipped");
    expect(beacons).toContainEqual(
      expect.objectContaining({
        event: "self_update_skipped",
        props: expect.objectContaining({ reason: "network" }),
      }),
    );
  });

  it("stays silent when already on the latest build", async () => {
    vi.stubGlobal(
      "fetch",
      (async () =>
        new Response(JSON.stringify({ buildId: "dev", updateEnabled: true }), {
          status: 200,
        })) as unknown as typeof fetch,
    );
    const outcome = await maybeSelfUpdate();
    expect(outcome).toBe("current");
    expect(beacons).toHaveLength(0);
  });
});
