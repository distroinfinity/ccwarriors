/**
 * Regenerate the committed LiteLLM price snapshot (src/lib/litellm-prices.json).
 *
 *   pnpm --filter server exec tsx scripts/refresh-price-snapshot.ts
 *
 * Why this exists: the snapshot is what prices every model between process boot
 * and the first successful background refresh. When it lags upstream, models it
 * doesn't know fall to DEFAULT_PRICE and then jump to the real price minutes
 * later — the same day re-priced twice. That drift is what quarantined 31 of 77
 * users before the gates were moved onto tokens, and it still produces wrong
 * dollar figures on the board. Run this whenever `unknown_model_priced`
 * telemetry names a model that upstream actually prices.
 *
 * Keeps every upstream entry carrying a real input or output price, trimmed to
 * the four fields indexPrices() reads.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LITELLM_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

const FIELDS = [
  "input_cost_per_token",
  "output_cost_per_token",
  "cache_creation_input_token_cost",
  "cache_read_input_token_cost",
] as const;

interface RawEntry {
  input_cost_per_token?: number | null;
  output_cost_per_token?: number | null;
  cache_creation_input_token_cost?: number | null;
  cache_read_input_token_cost?: number | null;
}

const OUT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "lib",
  "litellm-prices.json",
);

const res = await fetch(LITELLM_URL, { signal: AbortSignal.timeout(60_000) });
if (!res.ok) throw new Error(`litellm fetch failed: ${res.status}`);
const raw = (await res.json()) as Record<string, RawEntry>;
delete (raw as Record<string, unknown>)["sample_spec"];

const out: Record<string, RawEntry> = {};
for (const [key, v] of Object.entries(raw)) {
  if (typeof v !== "object" || v === null) continue;
  // indexPrices() drops anything without a real input or output price, so
  // carrying those entries would only inflate the file.
  if (!v.input_cost_per_token && !v.output_cost_per_token) continue;
  const trimmed: RawEntry = {};
  for (const f of FIELDS) {
    const n = v[f];
    if (typeof n === "number") trimmed[f] = n;
  }
  out[key] = trimmed;
}

const sorted = Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
writeFileSync(OUT, `${JSON.stringify(sorted, null, 2)}\n`);
console.log(`wrote ${Object.keys(sorted).length} priced models → ${path.relative(process.cwd(), OUT)}`);
