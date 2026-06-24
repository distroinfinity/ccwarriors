import { afterEach, describe, expect, it } from "vitest";
import { indexPrices, loadPricingSnapshot, lookupModelPrice, priceModels } from "../src/lib/pricing.js";

describe("pricing engine (committed LiteLLM snapshot)", () => {
  it("knows the models our agents actually emit", () => {
    for (const name of ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5-20251001", "gpt-5.5"]) {
      expect(lookupModelPrice(name), name).not.toBeNull();
    }
  });

  it("matches provider-prefixed names via the basename index", () => {
    const direct = lookupModelPrice("claude-sonnet-4-6");
    const prefixed = lookupModelPrice("anthropic/claude-sonnet-4-6");
    expect(prefixed).toEqual(direct);
  });

  it("prices token counts with cache rates", () => {
    const { cost, unknownModels } = priceModels([
      {
        modelName: "claude-opus-4-8",
        inputTokens: 1_000_000, // $5
        outputTokens: 1_000_000, // $25
        cacheCreationTokens: 1_000_000, // $6.25
        cacheReadTokens: 10_000_000, // $5
      },
    ]);
    expect(unknownModels).toEqual([]);
    expect(cost).toBeCloseTo(5 + 25 + 6.25 + 5, 2);
  });

  it("prices unknown models at the modest default and reports them", () => {
    const { cost, unknownModels } = priceModels([
      {
        modelName: "totally-made-up-9000",
        inputTokens: 1_000_000, // $3 default
        outputTokens: 1_000_000, // $15 default
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      },
    ]);
    expect(unknownModels).toEqual(["totally-made-up-9000"]);
    expect(cost).toBeCloseTo(18, 2);
  });
});

describe("gpt-5.3-codex-spark price override", () => {
  const CODEX_SPARK_PRICE = { input: 1.75e-6, output: 14e-6, cacheCreate: 1.75e-6, cacheRead: 1.75e-7 };

  // Several tests rebuild the table via indexPrices(); restore the committed
  // snapshot afterward so other tests in the suite see the real table.
  afterEach(() => {
    loadPricingSnapshot();
  });

  it("prices the model via the override (bare + provider-prefixed name)", () => {
    const bare = lookupModelPrice("gpt-5.3-codex-spark");
    expect(bare).toEqual(CODEX_SPARK_PRICE);
    expect(lookupModelPrice("chatgpt/gpt-5.3-codex-spark")).toEqual(CODEX_SPARK_PRICE);
  });

  it("does not report the model as unknown and prices it at $1.75/$14 per 1M", () => {
    const { cost, unknownModels } = priceModels([
      {
        modelName: "gpt-5.3-codex-spark",
        inputTokens: 1_000_000, // $1.75
        outputTokens: 1_000_000, // $14.00
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      },
    ]);
    expect(unknownModels).toEqual([]);
    expect(cost).toBeCloseTo(15.75, 2);
  });

  it("keeps the override after a refresh payload that lacks the model", () => {
    indexPrices({ "gpt-4o": { input_cost_per_token: 1e-6, output_cost_per_token: 2e-6 } });
    expect(lookupModelPrice("gpt-5.3-codex-spark")).toEqual(CODEX_SPARK_PRICE);
  });

  it("yields to a real upstream price under the bare key", () => {
    indexPrices({
      "gpt-5.3-codex-spark": { input_cost_per_token: 9e-9, output_cost_per_token: 8e-9 },
    });
    expect(lookupModelPrice("gpt-5.3-codex-spark")).toEqual({
      input: 9e-9,
      output: 8e-9,
      cacheCreate: 9e-9, // cache_*_cost absent → indexPrices falls back to input
      cacheRead: 9e-9,
    });
  });

  // Regression: LiteLLM currently carries the model only as the provider-prefixed
  // `chatgpt/gpt-5.3-codex-spark`. When it lands a real price under that form, the
  // override must yield for the BARE name the CLI actually emits — not just the
  // prefixed one. (A prior `!ex.has(bareKey)` guard missed this and clobbered it.)
  it("yields to a real upstream price under the provider-prefixed key", () => {
    indexPrices({
      "chatgpt/gpt-5.3-codex-spark": { input_cost_per_token: 9e-9, output_cost_per_token: 8e-9 },
    });
    const upstream = { input: 9e-9, output: 8e-9, cacheCreate: 9e-9, cacheRead: 9e-9 };
    expect(lookupModelPrice("gpt-5.3-codex-spark")).toEqual(upstream);
    expect(lookupModelPrice("chatgpt/gpt-5.3-codex-spark")).toEqual(upstream);
  });
});
