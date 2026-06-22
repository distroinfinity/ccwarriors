---
title: HTTP Endpoints
description: Every route, its auth, parameters, status codes, and cache behavior.
---

# HTTP Endpoints

All routes are mounted in `createApp()` (`apps/server/src/app.ts`). Base URL in production: `https://api.ccwarriors.xyz`. Two auth schemes: **bearer** (`Authorization: Bearer <cliToken>`, issued at CLI login, validated against `users.cli_token_hash`) and **session** (signed `ccw_session` cookie, set by web login).

## Always mounted

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/health` | — | `{"status":"ok"}`; Railway healthcheck target |
| GET | `/install.sh`, `/install.ps1` | — | Installer scripts, served with the `BASE` rewritten to whichever host served them (`routes/installer.ts`) |
| GET | `/cli.js` | — | The CLI bundle (`packages/cli/dist/cli.js`) |
| GET | `/cli/version` | — | `{buildId, updateEnabled}`; `CLI_UPDATE_ENABLED=0` is the fleet-wide self-update kill switch |
| POST | `/telemetry` | — | Anonymous event beacon; forwards to PostHog only if `POSTHOG_API_KEY` is set |
| GET | `/telemetry/failures` | — | Rolling in-memory failure window (triage aid) |

## Core (mounted with DB deps)

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/ingest` | bearer | Usage sync. 200 (incl. when flagged — see ingest pipeline), 401 `unauthorized`, 429 `rate_limited` (<10s since last sync), 422 `implausible` (legacy sanity cap only) |
| GET | `/leaderboard` | — | Params: `board=30d\|allTime` (default 30d), `limit` 1–100 (default 30), `offset` 0–100000, `tool` (unknown → empty board), `org` (unknown → 400). Org responses add `tools` + `byTool`. `Cache-Control: public, max-age=5` + ETag middleware → org polls collapse to 304s |
| GET | `/sponsors` | — | Last paid donations; ETag'd |
| POST | `/admin/flag`, `/admin/unflag` | `x-admin-token` header | Manual quarantine; mounted only when `ADMIN_TOKEN` is set (`routes/admin.ts:10`) |
| GET | `/badge/:login.svg` | — | Rank/tier/30d-burn SVG; `max-age=3600, stale-while-revalidate=86400`. Unknown or flagged login renders the generic "enlist →" badge |
| GET | `/og/u/:login` | — | OG meta HTML for crawler UAs (Vercel rewrites bots here); 5m cache + SWR 1h |

## Insights and profile (mounted with insights store)

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/insights` | bearer | Aggregate behavioral payload (counts only) |
| POST | `/insights/deep` | bearer | Per-session records; 403 `mode_off` unless `insightsMode === "deep"`; recomputes Craft Score and derives the aggregate row |
| POST | `/insights/transcripts` | bearer | Redacted story sources (machineId, windowDays 1–60, ≤60 prompts ≤2000 chars each, tool-name counts) |
| GET/POST | `/insights/consent` | session | GET returns `{consent, visibility}`; POST takes `{consent?, visibility?}` — the web "GO ALL-IN" unlock and the public/private toggle |
| GET/POST | `/insights/mode` | session/bearer | `{mode: "off"\|"deep"}`; mode is the source of truth, the legacy consent boolean is kept consistent |
| POST | `/insights/pins` | session | `{pins: string[]}` ≤4 known card keys → `users.pinnedCards`; unknown key → 400 |
| GET | `/profile/:login` | session optional | Full profile JSON. Owner responses `private, no-store`; public `public, max-age=30`. Locked insights return `no_consent` regardless of whether consent was never given or revoked |
| GET | `/profile/:login/story` | session optional | Story doc; owner `private, no-store`, public `public, max-age=300` |

## Conditionally mounted

| Route group | Mounted when | Routes |
|---|---|---|
| Auth | `GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET` | GET `/cli/auth?port=&ref=` (CLI loopback flow), `/auth/web?org=&ref=`, `/cli/callback` (shared OAuth callback), `/me`, `/logout` |
| Donations | `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET` | GET `/donate/rate`; POST `/donate/order` (5/min/IP), `/donate/verify`, `/donate/webhook` (only with `RAZORPAY_WEBHOOK_SECRET`) |
| Orgs | `DISCORD_CLIENT_ID` + `DISCORD_CLIENT_SECRET` | GET `/orgs/:slug/verify/start`, `/discord/callback` |
| Admin | `ADMIN_TOKEN` | POST `/admin/flag`, `/admin/unflag` |
| Insights/profile | insights store wired (always in `index.ts`) | the table above |

## CORS and ETag details

`CORS_ORIGIN` is exact-match per origin, plus a function-matcher that admits every `https://*.ccwarriors.xyz` subdomain — Hono's array origin can't express the org-subdomain family (`app.ts`). The ETag middleware is scoped to `/leaderboard` and `/sponsors` only and explicitly retains the `Access-Control-Allow-*` headers on 304s; without that, Hono's 304 rebuild strips them and cross-origin org polls break.

## WebSocket

The same server upgrades WS connections (port shared with HTTP). Snapshot on connect, update on ingest (1s debounce). Message shape is on [Payload Schemas and Compatibility](payload-schemas-and-compatibility.md).
