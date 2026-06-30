import { describe, it, expect } from "vitest";
import { formatUsd, pct, effectiveCostPerMtok, modelFamily } from "../../src/lib/coach/format.js";

describe("formatUsd", () => {
  it("drops cents for whole dollars and keeps two decimals otherwise", () => {
    expect(formatUsd(60)).toBe("$60");
    expect(formatUsd(60.5)).toBe("$60.50");
    expect(formatUsd(0.004)).toBe("$0.004");
  });
});

describe("pct", () => {
  it("renders a 0..1 ratio as a whole percent", () => {
    expect(pct(0.413)).toBe("41%");
    expect(pct(1)).toBe("100%");
  });
});

describe("effectiveCostPerMtok", () => {
  it("returns dollars per million tokens, or null when no tokens", () => {
    expect(effectiveCostPerMtok(10, 5_000_000)).toBe(2);
    expect(effectiveCostPerMtok(10, 0)).toBeNull();
  });
});

describe("modelFamily", () => {
  it("classifies common model ids into a family", () => {
    expect(modelFamily("claude-opus-4-7")).toBe("opus");
    expect(modelFamily("claude-sonnet-4-6")).toBe("sonnet");
    expect(modelFamily("gpt-5-codex")).toBe("openai");
    expect(modelFamily("gemini-2.5-pro")).toBe("gemini");
    expect(modelFamily("something-else")).toBe("other");
  });
});
