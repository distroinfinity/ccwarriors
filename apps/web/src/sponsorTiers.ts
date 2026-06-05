// Single source of truth for donation tiers. The server's INR allow-list
// (apps/server/src/routes/donate.ts ALLOWED_INR) must equal TIERS.map(t => t.inr).
export interface Tier {
  usd: number;
  inr: number;
  name: string;
  glyph: string;
  copy: string;
}

export const TIERS: Tier[] = [
  { usd: 4, inr: 400, name: "Wood", glyph: "wood", copy: "buys the planks" },
  { usd: 8, inr: 800, name: "Stone", glyph: "stone", copy: "cobblestone crew" },
  { usd: 16, inr: 1600, name: "Iron", glyph: "iron", copy: "ironclad backer" },
  { usd: 32, inr: 3200, name: "Gold", glyph: "gold", copy: "gilded patron" },
  { usd: 64, inr: 6400, name: "Diamond", glyph: "diamond", copy: "diamond hands" },
  { usd: 256, inr: 25600, name: "Netherite", glyph: "netherite", copy: "netherite legend" },
];

export const DEFAULT_TIER = 2; // Iron / $16

// Everything displays in USD; Razorpay charges INR. Flat rate keeps the
// ladder numbers clean — the server enforces ₹100–₹100,000 bounds.
export const USD_TO_INR = 100;
export const MIN_CUSTOM_USD = 1;
export const MAX_CUSTOM_USD = 1000;
export const CUSTOM_TIER = -1; // tierIdx sentinel for the custom cell

// Index-safe accessor (noUncheckedIndexedAccess): out-of-range falls back to Wood.
export function tierAt(i: number): Tier {
  return TIERS[i] ?? (TIERS[0] as Tier);
}

export const GH_SPONSOR = "distroinfinity";

// Self-custody wallets for the crypto tab. A chain hides when its address is
// unset; the whole tab hides when both are.
export const EVM_ADDRESS = import.meta.env.VITE_EVM_ADDRESS ?? "";
export const SOL_ADDRESS = import.meta.env.VITE_SOL_ADDRESS ?? "";
