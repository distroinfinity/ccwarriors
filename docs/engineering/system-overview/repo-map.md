---
title: Repo Map
description: One line per file, plus the mirrored pairs that drift if you edit only one.
---

# Repo Map

pnpm workspace globs `apps/*`, `packages/*`, `tools/*`. Package names: `claude-warriors` (= `packages/cli`, binary `ccwarriors`), `server`, `web`, plus `tools/video` (a Remotion launch-video toolkit, not deployed). Root: `railway.json` + `vercel.json` (deploy config-as-code), `pnpm-workspace.yaml`, `scripts/` (zero-dep PNG generators: logo, OG banner, shoutout cards).

## apps/server/src

| File | Does |
|---|---|
| `index.ts` | boot: config → DB → store hydration → pricing/FX refresh → HTTP + WS |
| `app.ts` | `createApp(deps)` — DI seam, CORS (org-subdomain matcher), ETag, route mounting |
| `config.ts` | zod env parsing — note it covers only the core vars; `GATE_*`, `ADMIN_TOKEN`, `POSTHOG_*`, `NS_GUILD_ID`, `CLI_UPDATE_ENABLED` are raw `process.env` reads at their call sites |
| `seed.ts` | `SEED_DEMO` (15 named warriors), `SEED_EXTRA=N` synthetic fill, `SIMULATE` live-spend demo |
| `db/index.ts` | Postgres vs in-memory PGlite selection |
| `db/schema.ts` | the ten tables + shared payload types |
| `services/ingest.ts` | ingest business logic: normalization, pricing, delta math, gates, transaction |
| `ws/broadcast.ts` | debounced snapshot broadcast, legacy-compatible message keys |
| `lib/leaderboard-store.ts`, `lib/insights-store.ts` | in-memory read models |
| `lib/pricing.ts` + `lib/litellm-prices.json` | server-authoritative pricing, committed snapshot, 24h refresh |
| `lib/plausibility.ts` | the gates (all `GATE_*`-tunable) |
| `lib/tier.ts`, `lib/efficiency.ts`, `lib/insights.ts`, `lib/insight-cards.ts` | derived profile metrics |
| `lib/craft-score.ts` + `craft-score-service.ts` | pillar math, outcome economics, eager recompute on deep upload |
| `lib/stack.ts` | "builds with" languages from agent-edited file extensions |
| `lib/story.ts` + `lib/story-service.ts` | LLM story generation, 24h throttle, source purge |
| `lib/github-stats.ts` + `github-stats-service.ts` | public footprint fetch, 6h TTL, serve-stale |
| `lib/orgs.ts` | org registry (slug → name, guild env var) |
| `lib/token.ts`, `lib/session.ts` | CLI token issue/hash, signed session cookie |
| `lib/fx.ts`, `lib/razorpay.ts`, `lib/ratelimit.ts`, `lib/scenes.ts`, `lib/tools.ts` | USD→INR, checkout, IP limits, card scenes, tool registry |
| `routes/*.ts` | one file per route group — see [HTTP Endpoints](../api/http-endpoints.md) |

## packages/cli/src

| File | Does |
|---|---|
| `cli.ts` | command dispatch, sync flow, consent prompts |
| `core.ts` | API base, ref attribution, ingest/insights/transcripts POSTs, telemetry |
| `auth.ts` / `authstate.ts` | loopback OAuth; 401 recovery decisions |
| `config.ts` | `~/.claude-warriors/config.json`, machineId derivation, insightsSalt, `CONSENT_VERSION` |
| `ccusage.ts` | pinned ccusage runner + broken-binary fallback |
| `tools.ts` | tool registry — **mirror of server `lib/tools.ts`** |
| `autosync.ts` | launchd/cron install + teardown |
| `daemon.ts` | watcher + debounce + heartbeat + backoff + auth pause |
| `backoff.ts` | 1m → ×5 → 30m cap |
| `selfupdate.ts` | version check, validated swap, `.prev` rollback |
| `insights.ts`, `git.ts`, `transcripts.ts`, `redact.ts` | deep extraction, hashed git outcomes, redacted transcripts |
| `ui.ts` | terminal output helpers |

## apps/web/src

| File | Does |
|---|---|
| `App.tsx` | regex routing, org co-brand, page composition |
| `api.ts` | `API_HTTP` derived from `VITE_WS_URL` |
| `useLeaderboard.ts` / `useOrgBoard.ts` / `useMe.ts` / `useProfile.ts` | WS board, org polling, session, profile fetch |
| `orgs.ts` | org registry — **mirror of server `lib/orgs.ts`** |
| `sponsorTiers.ts` | donation tiers (single source of truth for amounts) |
| `components/` | board UI (`Leaderboard`, `FilterChips`, `YourCard`, `CardScene`, `Marquee`, …), `Profile/` (`ArchetypeCard`, `ByTheNumbers`, `InsightCards`, `RhythmPanel`, `StoryCloser`, `StoryPage`, `OwnerControls`), `Sponsor/` (Razorpay/crypto/wall), `HowItWorks` |

## Mirrored by design — edit both or drift

| Pair | Contract |
|---|---|
| `apps/server/src/lib/tools.ts` ↔ `packages/cli/src/tools.ts` | tool keys = ccusage subcommand names = `usage_days.tool` values |
| `apps/server/src/lib/orgs.ts` ↔ `apps/web/src/orgs.ts` | org slugs, names, accents |
| `apps/server/src/db/schema.ts` `StoryDoc` ↔ `apps/web/src/components/Profile/StoryPage.tsx` | story doc shape (hand-kept — no shared types module) |
| `HowItWorks.tsx` ↔ `docs/public/` | prose claims about the pipeline — nothing enforces these; they just go stale |
