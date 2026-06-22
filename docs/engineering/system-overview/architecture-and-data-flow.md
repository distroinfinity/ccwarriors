---
title: Architecture and Data Flow
description: Deploy topology, the server's DI seam, and a sync traced end to end.
---

# Architecture and Data Flow

## Topology

```
ccwarriors.xyz        Vercel    apps/web — React SPA; also serves /install.sh + /cli.js
api.ccwarriors.xyz    Railway   apps/server — Hono + ws + Drizzle; Railway Postgres
get.ccwarriors.xyz    Railway   same server — installer fallback for clients blocked at Vercel's edge
CLI                   user      single-file bundle in ~/.ccwarriors, no npm
```

Both builds are config-as-code: `railway.json` (build + start + predeploy migration + healthcheck) and `vercel.json` (build + output + rewrites). Postgres is optional locally — no `DATABASE_URL` means in-memory PGlite.

## Boot (`apps/server/src/index.ts`)

`parseConfig(env)` → pick Postgres or PGlite → hydrate `LeaderboardStore` and `InsightsStore` from DB rows → load the committed pricing snapshot and start the 24h refresh + FX refresh → start HTTP + WS on one port (default 8787) → optional `SEED_DEMO`/`SIMULATE` for local demos.

## The DI seam (`apps/server/src/app.ts`)

`createApp(deps)` takes everything injectable: `db`, `store`, `insightsStore`, `onIngest`, and the optional feature groups — `auth` (GitHub creds), `donate` (Razorpay + an injectable `usdInr` rate for tests), `discord`, `githubToken`, `storyGenerate`. Most feature routes mount only when their deps exist: no Razorpay keys → no `/donate/*`, no Discord creds + GitHub session secret → no org verification, no `ANTHROPIC_API_KEY` → transcripts stored dormant. Admin is the exception: `/admin/*` mounts with DB deps and self-auths against raw `process.env.ADMIN_TOKEN`, returning 401 when the token is missing or wrong. Tests build a fully-wired app with fakes; production wiring is just `index.ts` reading env.

## A sync, end to end

1. A Claude Code session writes to `~/.claude/projects`; the daemon's watcher fires; 12s debounce batches the burst (the server floor is 10s).
2. CLI runs `ccusage <tool> daily` per registry key, last 40 days, and POSTs `/ingest` `{tools, machineId, clientBuildId}` with its bearer token.
3. Server: auth (sha256 → `cli_token_hash`) → 10s rate check → zod validation → tool-key normalization (unknown → `"other"`) → **server prices every day** from the LiteLLM table → plausibility gates append flag signals (never reject) → one transaction updates `users`, appends `snapshots`, upserts `usage_days` on `(userId, machineId, tool, day)`.
4. `LeaderboardStore.upsert()` → `onIngest()` → `ws/broadcast.ts` sends the new snapshot (1s debounce, top-100 per board, legacy-compatible keys).
5. Every connected browser replaces board state from the message; the CLI prints the tier and ranks the ingest response carried back.

Total latency, session write → row moves on the global board: ~13s (12s debounce + ~1s broadcast).

## A profile view

Human: SPA route `/:login` → `GET /profile/:login` → store lookup (case-insensitive) + `usage_days` rhythm/efficiency + `github_stats` + insights/craft/economics/stack/depth (if consented) in one JSON. Consented public warriors also carry a `craft` chip on the board itself, set through the leak-checked `craftEntryFor()` gate.

Crawler: pastes share link `/u/:login` → Vercel UA rewrite → `GET /og/u/:login` → meta tags + human meta-refresh. This is the only server-rendered HTML in the system.

## Trust boundaries

- Clients are never trusted with dollars — only raw token counts cross the wire, the server prices them (`lib/pricing.ts`).
- Implausible data is never rejected, only quarantined — see [Ingest Pipeline](../server/ingest-pipeline.md).
- Text (prompts/transcripts) crosses only under consent v2, redacted client-side first — see [Deep Insights Extraction](../cli/deep-insights-extraction.md).
