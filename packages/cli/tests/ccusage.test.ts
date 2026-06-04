import { describe, expect, it } from "vitest";
import { normalizeDay } from "../src/ccusage.js";

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
