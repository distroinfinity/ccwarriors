import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ModelTokens } from "../db/schema.js";

// Server-authoritative pricing: clients send raw token counts, we price them
// against LiteLLM's per-model pricing DB (the same source ccusage uses).
// Client-computed dollars are never trusted. A trimmed snapshot is committed
// to the repo so boot never depends on the network; a background refresh
// keeps prices current.

const LITELLM_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const REFRESH_MS = 24 * 60 * 60 * 1000;

interface ModelPrice {
  input: number; // USD per input token
  output: number;
  cacheCreate: number;
  cacheRead: number;
}

// Unknown models get a modest mid-tier price (≈ Sonnet) rather than zero —
// zero would let fabricated model names hide spend, a high default would let
// them inflate it. Ingest surfaces unknown names as unknown_model_priced
// telemetry (non-quarantining — usually just LiteLLM lagging a new release;
// fabricated names gain nothing since they can't exceed the default rate).
const DEFAULT_PRICE: ModelPrice = {
  input: 3e-6,
  output: 15e-6,
  cacheCreate: 3.75e-6,
  cacheRead: 0.3e-6,
};

// Models we've hand-priced ahead of LiteLLM. Canonical case: a ChatGPT-Pro
// preview model (gpt-5.3-codex-spark) that ships to the LiteLLM table with a
// NULL per-token cost, so indexPrices() skips it and it falls to DEFAULT_PRICE
// — firing unknown_model_priced on every ingest. Published rate is $1.75/$14
// per 1M (identical to the gpt-5.3-codex sibling); OpenAI bills no separate
// cache-creation, so cacheCreate = input. Applied as a FALLBACK in
// indexPrices() (see there): fills a gap only, so a real upstream price wins.
const PRICE_OVERRIDES: Record<string, ModelPrice> = {
  "gpt-5.3-codex-spark": {
    input: 1.75e-6,
    output: 14e-6,
    cacheCreate: 1.75e-6,
    cacheRead: 1.75e-7,
  },
};

type RawPrices = Record<
  string,
  {
    input_cost_per_token?: number;
    output_cost_per_token?: number;
    cache_creation_input_token_cost?: number;
    cache_read_input_token_cost?: number;
  }
>;

// Walk up from cwd to the workspace root (same approach as routes/installer.ts —
// works in dev, tests, and the Railway container, which all run in the monorepo).
function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

const SNAPSHOT_PATH = path.join(
  repoRoot(),
  "apps",
  "server",
  "src",
  "lib",
  "litellm-prices.json",
);

// exact-key map + basename map ("anthropic/claude-x" → "claude-x") for matching.
let exact = new Map<string, ModelPrice>();
let basename = new Map<string, ModelPrice>();

export function indexPrices(raw: RawPrices) {
  const ex = new Map<string, ModelPrice>();
  const base = new Map<string, ModelPrice>();
  for (const [key, v] of Object.entries(raw)) {
    const input = v.input_cost_per_token ?? 0;
    const output = v.output_cost_per_token ?? 0;
    if (!input && !output) continue;
    const price: ModelPrice = {
      input,
      output,
      cacheCreate: v.cache_creation_input_token_cost ?? input,
      cacheRead: v.cache_read_input_token_cost ?? input,
    };
    const lower = key.toLowerCase();
    ex.set(lower, price);
    const short = lower.split("/").pop();
    if (short && !base.has(short)) base.set(short, price);
  }
  // Hand-priced overrides fill ONLY a genuine gap: a model upstream prices under
  // NO key (absent, or sent with the null/zero cost the loop above dropped). The
  // basename index is populated for every priced model regardless of provider
  // prefix, so `base.has(short)` is the canonical "upstream already prices this"
  // test — gating the whole override on it self-heals the moment LiteLLM gives
  // any `…/gpt-5.3-codex-spark` a real price, even under the prefixed key form it
  // currently uses. Re-run on every refresh, so the override survives without
  // ever shadowing a real upstream price.
  for (const [key, price] of Object.entries(PRICE_OVERRIDES)) {
    const lower = key.toLowerCase();
    const short = lower.split("/").pop() ?? lower;
    if (base.has(short)) continue;
    ex.set(lower, price);
    base.set(short, price);
  }
  exact = ex;
  basename = base;
}

export function loadPricingSnapshot(filePath: string = SNAPSHOT_PATH): number {
  const raw = JSON.parse(readFileSync(filePath, "utf8")) as RawPrices;
  indexPrices(raw);
  return exact.size;
}

/** Refresh prices from LiteLLM. Failure keeps the current table — never throws. */
export async function refreshPricing(): Promise<boolean> {
  try {
    const res = await fetch(LITELLM_URL, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return false;
    const raw = (await res.json()) as RawPrices;
    if (typeof raw !== "object" || raw === null || Object.keys(raw).length < 100) return false;
    delete (raw as Record<string, unknown>)["sample_spec"];
    indexPrices(raw);
    return true;
  } catch {
    return false;
  }
}

export function startPricingRefresh(): NodeJS.Timeout {
  void refreshPricing();
  const t = setInterval(() => void refreshPricing(), REFRESH_MS);
  t.unref();
  return t;
}

export function lookupModelPrice(modelName: string): ModelPrice | null {
  const name = modelName.toLowerCase().trim();
  return exact.get(name) ?? basename.get(name) ?? basename.get(name.split("/").pop() ?? "") ?? null;
}

export interface PricedDay {
  cost: number;
  unknownModels: string[];
}

/** Price one day's per-model token counts. Pure given the loaded table. */
export function priceModels(models: ModelTokens[]): PricedDay {
  let cost = 0;
  const unknownModels: string[] = [];
  for (const m of models) {
    const price = lookupModelPrice(m.modelName);
    if (!price) unknownModels.push(m.modelName);
    const p = price ?? DEFAULT_PRICE;
    cost +=
      m.inputTokens * p.input +
      m.outputTokens * p.output +
      m.cacheCreationTokens * p.cacheCreate +
      m.cacheReadTokens * p.cacheRead;
  }
  return { cost: Math.round(cost * 100) / 100, unknownModels };
}

// Load the committed snapshot at module init so pricing always works.
loadPricingSnapshot();
