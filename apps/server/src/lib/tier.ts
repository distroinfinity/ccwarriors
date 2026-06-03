export const TIERS = ["Stone", "Iron", "Gold", "Diamond", "Netherite"] as const;
export type Tier = (typeof TIERS)[number];

// Thresholds are placeholders per the spec; tune with real data.
const THRESHOLDS: ReadonlyArray<[number, Tier]> = [
  [6000, "Netherite"],
  [2000, "Diamond"],
  [500, "Gold"],
  [100, "Iron"],
  [0, "Stone"],
];

export function computeTier(cost: number): Tier {
  for (const [min, tier] of THRESHOLDS) {
    if (cost >= min) return tier;
  }
  return "Stone";
}
