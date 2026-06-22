---
title: Ingest Pipeline
description: Payload validation, server-side pricing, delta math, and the plausibility gates.
---

# Ingest Pipeline

`POST /ingest` is the one write path that moves the board. Route validation in `routes/ingest.ts`, business logic in `services/ingest.ts`, gates in `lib/plausibility.ts`, pricing in `lib/pricing.ts`.

## Flow

1. **Auth + rate limit.** Bearer token → sha256 → `users.cli_token_hash`. Syncs less than `MIN_SYNC_INTERVAL_MS = 10_000` apart return 429 `rate_limited` (`services/ingest.ts:20`).
2. **Shape.** v1 legacy (`{cost30d, costAllTime}`) or v3 raw (`{tools, machineId}`) — full schemas in [Payload Schemas](../api/payload-schemas-and-compatibility.md).
3. **Normalize.** Tool keys not in the registry (`lib/tools.ts`) merge into `"other"` — total integrity over key purity. Days outside the rolling 40-day window (or >2 days in the future) drop silently: timezone drift and slow clocks aren't worth flagging.
4. **Price.** `priceModels()` prices each day's per-model token quads against the LiteLLM table. Server-computed dollars are the only stored/ranked values.
5. **Gate.** Each violation appends a `FlagSignal`; none of them rejects the sync.
6. **Persist.** One transaction: update `users` aggregates, append a `snapshots` audit row, upsert `usage_days` rows on `(userId, machineId, tool, day)`.
7. **Publish.** Upsert into the in-memory `LeaderboardStore`, fire `onIngest` → debounced WS broadcast.

## Pricing (`lib/pricing.ts`)

A trimmed LiteLLM snapshot (`lib/litellm-prices.json`) is committed so boot never needs the network; a background refresh refetches `model_prices_and_context_window.json` every 24h. Unknown model names get `DEFAULT_PRICE` (input 3e-6, output 15e-6, cacheCreate 3.75e-6, cacheRead 0.3e-6 — ≈Sonnet): zero would let fabricated names hide spend, a high default would inflate it. Unknown names surface as `unknown_model_priced` telemetry — usually just LiteLLM lagging a new release.

ccusage's own `costEstimate` rides along purely as a cross-check: if the aggregate diverges from server math by more than `GATE_ESTIMATE_BAND` (0.25), emit `estimate_mismatch` telemetry. Tampered client or stale pricing table — both worth eyes, neither auto-flags.

## Aggregation math (`ingestRaw`)

- **30d:** sum of merged (existing + incoming) rows whose day label ≥ the 30-day cutoff. Day labels compare as strings, not timestamps — ccusage groups by local date, and the board must include the same labels the CLI shows users.
- **All-time:** accumulates **positive per-day deltas** (`max(0, cost − prevCost)` per row). Exception: a tool's first raw sync after legacy tracking takes `max(prevAllTime, windowTotal)` so the overlapping legacy ~30d window isn't double counted.
- **Legacy v1:** since ccusage v20 lumps every agent into one number, the server subtracts the known non-claude slices from the lump before writing the claude share — otherwise a v1 sync after a v3 sync double-counts and trips the burn gate.
- **Tier:** `computeTier(costAllTime)` — Stone 0 / Iron 100 / Gold 500 / Diamond 2000 / Netherite 6000 (`lib/tier.ts`, placeholder thresholds).

## Plausibility gates

Design contract (`lib/plausibility.ts:3-6`): violations **never 4xx**. A cheater probing for errors learns where the gates are; instead the sync succeeds, data is stored, and the user is flagged into shadow quarantine (`users.flaggedAt`/`flagReason`) — off every board until `/admin/unflag`. All thresholds are env-tunable so legit whales can be accommodated without a deploy.

| Gate | Default | Env var | Flag reason |
|---|---|---|---|
| Burn rate (Δcost30d vs elapsed hours) | $500/h + $200 slack | `GATE_MAX_HOURLY_BURN`, `GATE_BURN_SLACK` | `burn_rate` |
| Daily ceiling per tool-day | $3,000 | `GATE_MAX_DAILY_COST` | `daily_ceiling` |
| New tool's first window | $15,000 | `GATE_NEW_TOOL_WINDOW_CAP` | `new_tool_backfill` |
| Settled-day growth (day older than 2d) | +10% | `GATE_SETTLED_AFTER_DAYS`, `GATE_SETTLED_TOLERANCE` | `history_rewrite` |
| Token shape (read/out ratio >1M, or output >50M/day) | fixed | — | `token_shape` |
| Machine count per user | 5 | — (`MAX_MACHINES_PER_USER`, `services/ingest.ts:23`) | `machine_count` |
| Total sanity cap | $1,000,000 | — (`SANITY_CAP`) | `sanity_cap` (v3) / 422 (v1) |
| Estimate divergence | ±25% | `GATE_ESTIMATE_BAND` | telemetry only, never flags |
| Outcome vs spend (deep): surviving LOC/token, commits/$ | 1.0, 50 | `GATE_MAX_LOC_PER_TOKEN`, `GATE_MAX_COMMITS_PER_DOLLAR` | `outcome_implausible` |
| Timing regularity (deep): ≥3 sessions of ≥20 events with mean sub-second fraction >0.9 and mean median-gap <300ms | — | `GATE_TIMING_MIN_EVENTS`, `GATE_MAX_SUBSECOND_FRACTION`, `GATE_MIN_MEDIAN_GAP_MS` | `timing_regular` |

Two deliberate burn-gate exemptions (`services/ingest.ts`): a **new machine's first sync** is whole-window backfill, not real-time burn (a second laptop enlisting is legitimate, and it's still bounded by the ceiling/shape/machine-count/sanity gates); and the gate only sums **previously-tracked tools**, so a first multi-tool sync doesn't trip on codex/gemini appearing.

`flagUser()` is idempotent (no-op if already flagged), records the first 3 signals as `flagReason`, flips the store's `flagged` bit, and emits `plausibility_flagged` telemetry.
