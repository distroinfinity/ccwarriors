---
title: Stores, Caches, and Derived State
description: The in-memory read models, every cache layer, and what's derived versus persisted.
---

# Stores, Caches, and Derived State

## LeaderboardStore (`lib/leaderboard-store.ts`)

The boards never query Postgres. A single in-memory `Map<userId, Entry>` is hydrated from `users` rows at boot and upserted on every ingest; `/leaderboard`, the WS broadcast, badges, and profile rank lookups all read it.

- `getTop(board, limit, offset, tool?, org?)` filters out `flagged` entries, optionally scopes to an org slug or a per-tool metric (`breakdown[tool]`), sorts descending, slices.
- `getByLogin()` is case-insensitive — profile URLs arrive in user-typed case.
- `totals(org?)` sums 30d burn over visible entries, rounded to cents server-side — the web never sums headline numbers client-side.
- Legacy rows without a breakdown are loaded as `{claude: cost30d}` so consumers can rely on `breakdown` being set.
- Flagged entries **stay in the store** (their card and profile still render); they're excluded from every board, count, and total.

## InsightsStore (`lib/insights-store.ts`)

Same pattern for `user_insights`: `userId → machineId → payload`, warmed at boot, updated on every insights POST, merged across machines on read — percentile scoring never hits the DB on a profile view.

## Pricing snapshot (`lib/pricing.ts`)

A trimmed LiteLLM price table is **committed** at `lib/litellm-prices.json`, so boot never depends on the network; `startPricingRefresh()` refetches upstream every 24h in memory. Path resolution walks up to `pnpm-workspace.yaml` (works in dev, tests, and the Railway container).

## Cache layers

| Layer | Where | Policy |
|---|---|---|
| `/leaderboard`, `/sponsors` | ETag middleware (`app.ts:91-92`) + `Cache-Control: max-age=5` / 30s | org polls collapse to 304s; CORS headers explicitly retained on 304 |
| `/badge/:login.svg` | HTTP | `max-age=3600, stale-while-revalidate=86400` — GitHub camo re-fetches hourly |
| `/og/u/:login` | HTTP | 5m + SWR 1h |
| `/profile/:login` | HTTP | owner `private, no-store`; public `max-age=30` (story: 300) |
| GitHub stats | DB row | 6h fresh TTL, 30m error retry, serve-stale-forever |
| WS broadcast | in-memory | 1s debounce, top-100 per board |
| CLI insights cache | `~/.claude-warriors/insights-cache.json` | per-file size+mtime keys, format version 4 |

## Derived vs persisted

| Value | Computed in | Persisted? |
|---|---|---|
| Tier | `lib/tier.ts` on ingest | yes (`users.tier`) |
| cost30d / costAllTime / toolBreakdown | ingest aggregation | yes |
| Efficiency, rhythm, streaks | `lib/efficiency.ts` per profile read | no |
| Craft Score, trust tier | `craft-score-service.ts` on deep upload | yes (`users.craftScore`) |
| Insight cards, axes, archetype | `lib/insight-cards.ts` / `lib/insights.ts` per profile read | no (archetype cached on `users`) |
| Story doc | story service (LLM, ≤1/24h) | yes (`user_stories`) |
| Ranks | store sort per request | no |

Rule of thumb: anything cheap is recomputed on read; anything expensive (LLM story) or rank-relevant (craft score, tier) is persisted at write time.
