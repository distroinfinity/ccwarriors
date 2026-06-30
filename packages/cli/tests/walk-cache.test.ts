import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let cleanup: string[] = [];
beforeEach(() => { cleanup = []; vi.resetModules(); });
afterEach(() => {
  for (const d of cleanup) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ } }
  cleanup = [];
  delete process.env["CCWARRIORS_HOME"];
});
function tmp(p: string): string { const d = mkdtempSync(join(tmpdir(), p)); cleanup.push(d); return d; }

describe("walkJsonlSessions", () => {
  it("uses the given cache path and does not prune another path's entries", async () => {
    const home = tmp("ccw-walk-home-");
    process.env["CCWARRIORS_HOME"] = home;
    const dataA = tmp("ccw-walk-a-");
    const dataB = tmp("ccw-walk-b-");
    const fileA = join(dataA, "a.jsonl");
    const fileB = join(dataB, "b.jsonl");
    writeFileSync(fileA, "");
    writeFileSync(fileB, "");

    const { walkJsonlSessions } = await import("../src/insights.js");
    const cacheA = join(home, "cache-a.json");
    const cacheB = join(home, "cache-b.json");

    // A parser that returns a minimal valid-ish stats only for fileA.
    const parse = async (path: string) =>
      path === fileA ? ({ tag: "A" } as unknown as Awaited<ReturnType<typeof parse>>) : null;

    await walkJsonlSessions([fileA], cacheA, parse as never);
    await walkJsonlSessions([fileB], cacheB, parse as never);

    // Each cache file exists and references only its own file key.
    const ca = JSON.parse(readFileSync(cacheA, "utf8"));
    const cb = JSON.parse(readFileSync(cacheB, "utf8"));
    expect(Object.keys(ca.files)).toEqual([fileA]);
    expect(Object.keys(cb.files)).toEqual([fileB]);

    // Re-walking A must NOT delete B's cache (separate files).
    await walkJsonlSessions([fileA], cacheA, parse as never);
    const cb2 = JSON.parse(readFileSync(cacheB, "utf8"));
    expect(Object.keys(cb2.files)).toEqual([fileB]);
  });
});
