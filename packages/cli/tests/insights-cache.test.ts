import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The insights module reads PROJECTS_DIR / HOME from env at module load, so
// every test resets the module registry, points env at fresh temp dirs, and
// dynamically imports. This file covers the cache-corruption class of bug that
// shipped in e53a41c: the cached SessionStats shape changed (eventGapsMs et al
// added) without a CACHE_VERSION bump, so stale entries crashed the deep path
// and the blanket catch reported "no sessions" on machines full of sessions.

let cleanup: string[] = [];

beforeEach(() => {
  cleanup = [];
  vi.resetModules();
});

afterEach(() => {
  for (const dir of cleanup) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
  cleanup = [];
  delete process.env["CCWARRIORS_CLAUDE_DIR"];
  delete process.env["CCWARRIORS_HOME"];
  delete process.env["CCWARRIORS_CODEX_DIR"];
});

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanup.push(dir);
  return dir;
}

/** A minimal real session: one prompt, one assistant turn, recent timestamps. */
function writeSession(projects: string, name = "session.jsonl"): string {
  const now = Date.now();
  const startIso = new Date(now - 10 * 60_000).toISOString();
  const endIso = new Date(now - 9 * 60_000).toISOString();
  const dir = join(projects, "proj-encoded");
  mkdirSync(dir, { recursive: true });
  const lines = [
    JSON.stringify({ type: "user", message: { content: "do the thing carefully" }, timestamp: startIso }),
    JSON.stringify({ type: "assistant", message: { model: "claude-opus-4-7", content: [{ type: "text", text: "ok" }] }, timestamp: endIso }),
  ];
  const full = join(dir, name);
  writeFileSync(full, lines.join("\n") + "\n");
  return full;
}

async function importInsights(projects: string, home: string) {
  process.env["CCWARRIORS_CLAUDE_DIR"] = projects;
  process.env["CCWARRIORS_HOME"] = home;
  process.env["CCWARRIORS_CODEX_DIR"] = join(home, "codex-absent");
  return import("../src/insights.js");
}

describe("collectDeepInsights cache resilience", () => {
  it("re-parses a cached entry whose shape is stale instead of crashing (prod regression)", async () => {
    const projects = tmp("ccw-cache-projects-");
    const home = tmp("ccw-cache-home-");
    const sessionPath = writeSession(projects);

    // First run populates the cache with current-shape stats.
    let mod = await importInsights(projects, home);
    const first = await mod.collectDeepInsights("salt");
    expect(first.status).toBe("ok");

    // Poison the cache the way the f502da5→e53a41c update did: same version,
    // same size/mtime (so it reads as a cache HIT), but stats missing the
    // fields a newer build expects.
    const cachePath = join(home, "insights-cache.json");
    const cache = JSON.parse(readFileSync(cachePath, "utf8"));
    const st = statSync(sessionPath);
    for (const key of Object.keys(cache.files)) {
      const entry = cache.files[key];
      expect(entry.size).toBe(st.size);
      if (entry.stats) {
        delete entry.stats.eventGapsMs;
        delete entry.stats.editedFiles;
        delete entry.stats.cwd;
        delete entry.stats.startMs;
        delete entry.stats.endMs;
      }
    }
    writeFileSync(cachePath, JSON.stringify(cache));

    vi.resetModules();
    mod = await importInsights(projects, home);
    const second = await mod.collectDeepInsights("salt");

    // The poisoned entry must be treated as a cache miss and re-parsed — never
    // a crash, and never a lying "empty".
    expect(second.status).toBe("ok");
    if (second.status === "ok") {
      expect(second.payload.sessions.length).toBe(1);
      expect(second.payload.sessions[0]!.timing.events).toBe(2);
    }
  });

  it("discards entries from an older cache version but preserves lastSentAt", async () => {
    const projects = tmp("ccw-cache-projects-");
    const home = tmp("ccw-cache-home-");
    writeSession(projects);

    const sentAt = "2026-06-01T00:00:00.000Z";
    writeFileSync(
      join(home, "insights-cache.json"),
      JSON.stringify({ version: 2, files: { "/bogus/old.jsonl": { size: 1, mtimeMs: 1, stats: { prompts: 1 } } }, lastSentAt: sentAt }),
    );

    const mod = await importInsights(projects, home);
    const result = await mod.collectDeepInsights("salt");
    expect(result.status).toBe("ok");

    const saved = JSON.parse(readFileSync(join(home, "insights-cache.json"), "utf8"));
    expect(saved.version).toBe(5);
    expect(saved.lastSentAt).toBe(sentAt);
    expect(saved.files["/bogus/old.jsonl"]).toBeUndefined();
  });

  it("returns empty (not error) when there are genuinely no sessions", async () => {
    const projects = tmp("ccw-cache-projects-");
    const home = tmp("ccw-cache-home-");
    const mod = await importInsights(projects, home);
    const result = await mod.collectDeepInsights("salt");
    expect(result.status).toBe("empty");
  });

  it("returns error (not empty) when extraction itself fails", async () => {
    const projects = tmp("ccw-cache-projects-");
    const home = tmp("ccw-cache-home-");
    writeSession(projects);
    // Make the cache path unwritable: a DIRECTORY at insights-cache.json makes
    // saveCache throw EISDIR after sessions were found — an extraction error.
    mkdirSync(join(home, "insights-cache.json"));

    const mod = await importInsights(projects, home);
    const result = await mod.collectDeepInsights("salt");
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.message.length).toBeGreaterThan(0);
    }
  });
});

describe("isValidSessionStats", () => {
  const valid = {
    prompts: 1, interrupts: 0, usedPlanMode: false, exploreBeforeFirstEdit: false, hadEdits: false,
    subagentSpawns: 0, maxParallel: 0, editCalls: 0, assistantTurns: 1, startHour: 12, durationMinutes: 1,
    wordBuckets: { "1-5": 1, "6-10": 0, "11-25": 0, "26+": 0 },
    thankYous: 0, wordTotal: 3, recoveryLoops: 0, extensions: {}, recoveryBreakoutMs: [], shortPrompts: [],
    startMs: 1, endMs: 2, cwd: null, gitBranch: null, model: null, editedFiles: [], eventGapsMs: [],
    // tool-aware + skill signals added in Task 1 (v5 cache shape)
    tool: "claude", skillSpawns: 0, skillsUsed: {},
  };

  it("accepts a complete SessionStats", async () => {
    const { isValidSessionStats } = await import("../src/insights.js");
    expect(isValidSessionStats(valid)).toBe(true);
  });

  it("rejects stats missing newer fields (the poisoned-cache shape)", async () => {
    const { isValidSessionStats } = await import("../src/insights.js");
    const { eventGapsMs: _g, ...withoutGaps } = valid;
    expect(isValidSessionStats(withoutGaps)).toBe(false);
    const { editedFiles: _e, ...withoutEdited } = valid;
    expect(isValidSessionStats(withoutEdited)).toBe(false);
    const { wordBuckets: _w, ...withoutBuckets } = valid;
    expect(isValidSessionStats(withoutBuckets)).toBe(false);
    expect(isValidSessionStats(null)).toBe(false);
    expect(isValidSessionStats("nope")).toBe(false);
  });

  it("accepts nullable fields as null but not as missing", async () => {
    const { isValidSessionStats } = await import("../src/insights.js");
    expect(isValidSessionStats({ ...valid, cwd: "/somewhere", model: "claude-opus-4-7" })).toBe(true);
    const { startMs: _s, ...withoutStartMs } = valid;
    expect(isValidSessionStats(withoutStartMs)).toBe(false);
  });
});
