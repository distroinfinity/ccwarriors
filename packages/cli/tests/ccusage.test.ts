import { describe, it, expect, beforeEach, vi } from "vitest";
import { normalizeDay, invokeCcusage, resetCcusageStateForTest, type CcusageRunner } from "../src/ccusage.js";
import { postTelemetry } from "../src/core.js";

// invokeCcusage fires postTelemetry on the first fallback — stub it so no
// network call happens during the unit test.
vi.mock("../src/core.js", () => ({ postTelemetry: vi.fn(async () => {}) }));

// Fixtures mirror real ccusage v20 output (captured 2026-06-04 on this machine).

const CLAUDE_STYLE = {
  cacheCreationTokens: 7_985_752,
  cacheReadTokens: 362_551_580,
  date: "2026-06-02",
  inputTokens: 260_413,
  modelBreakdowns: [
    {
      cacheCreationTokens: 5_724_443,
      cacheReadTokens: 310_494_512,
      cost: 225.48,
      inputTokens: 246_818,
      modelName: "claude-opus-4-8",
      outputTokens: 1_328_877,
    },
  ],
  outputTokens: 1_543_995,
  totalCost: 239.69,
};

const CODEX_STYLE = {
  cachedInputTokens: 30_859_776,
  costUSD: 25.32,
  date: "2026-05-28",
  inputTokens: 1_590_058,
  models: {
    "gpt-5.5": {
      cachedInputTokens: 30_859_776,
      inputTokens: 1_590_058,
      isFallback: false,
      outputTokens: 64_806,
      reasoningOutputTokens: 27_727,
      totalTokens: 32_514_640,
    },
  },
  outputTokens: 64_806,
};

describe("normalizeDay", () => {
  it("normalizes claude-style entries (modelBreakdowns array)", () => {
    const day = normalizeDay(CLAUDE_STYLE)!;
    expect(day.date).toBe("2026-06-02");
    expect(day.models).toEqual([
      {
        modelName: "claude-opus-4-8",
        inputTokens: 246_818,
        outputTokens: 1_328_877,
        cacheCreationTokens: 5_724_443,
        cacheReadTokens: 310_494_512,
      },
    ]);
  });

  it("normalizes codex-style entries (models object, cachedInputTokens → cacheRead)", () => {
    const day = normalizeDay(CODEX_STYLE)!;
    expect(day.models).toEqual([
      {
        modelName: "gpt-5.5",
        inputTokens: 1_590_058,
        outputTokens: 64_806,
        cacheCreationTokens: 0,
        cacheReadTokens: 30_859_776,
      },
    ]);
  });

  it("rejects malformed entries instead of shipping garbage", () => {
    expect(normalizeDay({ date: "not-a-date", models: {} })).toBeNull();
    expect(normalizeDay({ date: "2026-06-02" })).toBeNull();
    expect(normalizeDay({})).toBeNull();
  });

  it("clamps negative/NaN token counts to zero", () => {
    const day = normalizeDay({
      date: "2026-06-02",
      modelBreakdowns: [{ modelName: "x", inputTokens: -5, outputTokens: "lol" }],
    })!;
    expect(day.models[0]).toEqual({
      modelName: "x",
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    });
  });
});

const nativeCrash = () =>
  Object.assign(new Error("dyld[1]: Library not loaded: /nix/store/x-libiconv.2.dylib"), {
    stderr: "dyld[1]: Library not loaded: /nix/store/x-libiconv.2.dylib (no such file)",
  });

const etargetCrash = () =>
  Object.assign(new Error("Command failed: npx --yes ccusage@20 daily"), {
    stderr: "npm error code ETARGET\nnpm error notarget No matching version found for ccusage@20",
  });

describe("invokeCcusage broken-ccusage fallback", () => {
  // NOTE: CCUSAGE_PKG is a module-load const (read once at import time), so
  // deleting process.env.CCWARRIORS_CCUSAGE_PKG here would have no effect on
  // its value. The literal "ccusage@20" assertions below are safe as long as
  // CI does not set that env var (it does not).
  beforeEach(() => {
    vi.clearAllMocks();
    resetCcusageStateForTest();
  });

  it("uses the primary when healthy and never calls the fallback", async () => {
    const run = vi.fn(async (_pkg: string, _args: string[]) => '{"daily":[]}');
    const out = await invokeCcusage(["daily", "--json"], run as unknown as CcusageRunner);
    expect(out).toBe('{"daily":[]}');
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith("ccusage@20", ["daily", "--json"]);
  });

  it("falls back to the known-good version when the primary native binary crashes", async () => {
    const run = vi.fn(async (pkg: string, _args: string[]) => {
      if (pkg === "ccusage@20") throw nativeCrash();
      return '{"daily":[{"date":"2026-06-01"}]}';
    });
    const out = await invokeCcusage(["daily", "--json"], run as unknown as CcusageRunner);
    expect(out).toContain("2026-06-01");
    expect(run).toHaveBeenNthCalledWith(1, "ccusage@20", ["daily", "--json"]);
    expect(run).toHaveBeenNthCalledWith(2, "ccusage@20.0.6", ["daily", "--json"]);
  });

  it("falls back when npm cannot resolve the primary (ETARGET)", async () => {
    const run = vi.fn(async (pkg: string, _args: string[]) => {
      if (pkg === "ccusage@20") throw etargetCrash();
      return "{}";
    });
    const out = await invokeCcusage(["daily"], run as unknown as CcusageRunner);
    expect(out).toBe("{}");
    expect(run).toHaveBeenNthCalledWith(2, "ccusage@20.0.6", ["daily"]);
  });

  it("memoizes the fallback for the rest of the process", async () => {
    const run = vi.fn(async (pkg: string, _args: string[]) => {
      if (pkg === "ccusage@20") throw nativeCrash();
      return "{}";
    });
    await invokeCcusage(["daily"], run as unknown as CcusageRunner); // flips (2 calls)
    await invokeCcusage(["--version"], run as unknown as CcusageRunner); // fallback directly (1 call)
    expect(run).toHaveBeenCalledTimes(3);
    expect(run).toHaveBeenLastCalledWith("ccusage@20.0.6", ["--version"]);
  });

  it("throws when both primary and fallback are broken", async () => {
    const run = vi.fn(async (_pkg: string, _args: string[]) => {
      throw nativeCrash();
    });
    await expect(invokeCcusage(["daily"], run as unknown as CcusageRunner)).rejects.toThrow(/Library not loaded/);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("does NOT fall back on a non-ccusage error", async () => {
    const run = vi.fn(async (_pkg: string, _args: string[]) => {
      throw new Error("some transient network thing");
    });
    await expect(invokeCcusage(["daily"], run as unknown as CcusageRunner)).rejects.toThrow(/transient network/);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("fires the fallback telemetry exactly once when the primary native binary crashes", async () => {
    const run = vi.fn(async (pkg: string, _args: string[]) => {
      if (pkg === "ccusage@20") throw nativeCrash();
      return '{"daily":[]}';
    });
    await invokeCcusage(["daily", "--json"], run as unknown as CcusageRunner);
    expect(postTelemetry).toHaveBeenCalledTimes(1);
    expect(postTelemetry).toHaveBeenCalledWith("ccusage_fallback", {
      from: "ccusage@20",
      to: "ccusage@20.0.6",
    });
  });
});
