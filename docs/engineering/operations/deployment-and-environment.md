---
title: Deployment and Environment
description: The canonical deploy guide — topology, config-as-code, accounts, and every env var.
---

# Deployment and Environment

```
ccwarriors.xyz        →  Vercel   (apps/web — also serves /install.sh + /cli.js)
api.ccwarriors.xyz    →  Railway  (apps/server) + Railway Postgres
get.ccwarriors.xyz    →  Railway  (same service — installer fallback host)
CLI                   →  curl -fsSL https://ccwarriors.xyz/install.sh | bash   (no npm)
```

Production has **no seed data** — the board fills as real people sync. `SEED_DEMO`/`SIMULATE` are local-only.

## Config-as-code first

Both platforms read their build config from the repo — **dashboard build settings are obsolete**, don't set them:

**`railway.json`:** NIXPACKS; build `pnpm install --frozen-lockfile && pnpm --filter claude-warriors build && pnpm --filter server build` (the CLI build is required — this service serves `/cli.js` as the installer fallback); start `pnpm --filter server start`; **`preDeployCommand: pnpm --filter server db:migrate` runs migrations automatically on every deploy** (no manual migration step); healthcheck `/health`; restart on failure.

**`vercel.json`:** install `pnpm install`, build `pnpm --filter web build` (its `prebuild` bundles the CLI into `public/cli.js` — every deploy is a CLI release), output `apps/web/dist`; rewrites: bot UAs on `/u/:login` → `https://api.ccwarriors.xyz/og/u/:login`, everything else → SPA fallback.

## Accounts and secrets

1. **GitHub OAuth App** — callback `https://api.ccwarriors.xyz/cli/callback` (one shared callback for CLI and web flows). Classic apps allow a single callback URL, so local OAuth testing needs a second app with `http://localhost:8787/cli/callback`. Logo: `assets/logo-dark-512.png`.
2. **Railway** — project from the GitHub repo + a PostgreSQL service; wire `DATABASE_URL` to `${{Postgres.DATABASE_URL}}`. Don't set `PORT` (Railway provides it). Custom domains: `api.ccwarriors.xyz` and `get.ccwarriors.xyz` (keep the fallback healthy — installs depend on it when Vercel's edge blocks curl).
3. **Vercel** — import the repo, add `ccwarriors.xyz` (+ `www`). DNS: apex A per Vercel's Domains page, `www` CNAME `cname.vercel-dns.com`, `api`/`get` CNAME to Railway's target.
4. **Razorpay** (optional) — live keys in Railway; webhook `https://api.ccwarriors.xyz/donate/webhook` on `payment.captured`, secret into `RAZORPAY_WEBHOOK_SECRET`. Donations stay disabled until keys exist.
5. **Discord app** (optional) — enables org verification; per-org guild id env vars (e.g. `NS_GUILD_ID`).
6. **Anthropic key** (optional) — enables story generation; absent, transcripts sit dormant.
7. **PostHog** (optional) — telemetry forwarding; the endpoint works keyless either way.

## Environment reference

**Server core:** `DATABASE_URL` (unset → in-memory PGlite), `PORT` (default 8787, Railway-provided in prod), `CORS_ORIGIN` (exact origins; `*.ccwarriors.xyz` subdomains are always admitted), `PUBLIC_BASE_URL`, `WEB_BASE_URL`.

**Auth:** `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` (unset → OAuth routes unmounted), `GITHUB_TOKEN` (server PAT fallback for public GitHub-stats reads).

**Features (each unset → feature off):** `ANTHROPIC_API_KEY` + `STORY_MODEL` (stories), `DISCORD_CLIENT_ID` + `DISCORD_CLIENT_SECRET` + `NS_GUILD_ID` (org verification), `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET` + `RAZORPAY_WEBHOOK_SECRET` (donations), `ADMIN_TOKEN` (admin quarantine routes), `POSTHOG_API_KEY` + `POSTHOG_HOST` (default `https://us.i.posthog.com`).

**Ops levers:** `CLI_UPDATE_ENABLED=0` — fleet-wide self-update kill switch served via `/cli/version`. `GATE_MAX_HOURLY_BURN` (500), `GATE_BURN_SLACK` (200), `GATE_MAX_DAILY_COST` (3000), `GATE_NEW_TOOL_WINDOW_CAP` (15000), `GATE_SETTLED_AFTER_DAYS` (2), `GATE_SETTLED_TOLERANCE` (0.10), `GATE_ESTIMATE_BAND` (0.25), `GATE_MAX_LOC_PER_TOKEN` (1.0), `GATE_MAX_COMMITS_PER_DOLLAR` (50), `GATE_TIMING_MIN_EVENTS` (20), `GATE_MAX_SUBSECOND_FRACTION` (0.9), `GATE_MIN_MEDIAN_GAP_MS` (300) — loosen gates for legit whales without a deploy.

**Dev-only:** `SEED_DEMO` (15 named warriors), `SEED_EXTRA=N` (synthetic fill for pagination testing), `SIMULATE` (live-spend animation), `SEED_CLI_TOKEN` (known token for CLI testing).

Note: `apps/server/src/config.ts` zod-parses only the core set; `GATE_*`, `ADMIN_TOKEN`, `POSTHOG_*`, `NS_GUILD_ID`, `CLI_UPDATE_ENABLED` are raw `process.env` reads at their call sites.

**Web (Vercel):** `VITE_WS_URL=wss://api.ccwarriors.xyz` (also derives the HTTP API base), `VITE_EVM_ADDRESS`/`VITE_SOL_ADDRESS` (crypto tab; a chain hides when unset, the tab hides when both are).

**Repo secrets:** `SPONSORKIT_GITHUB_TOKEN` — classic PAT (`read:user` + `read:org`) for `.github/workflows/sponsors.yml`, regenerates the sponsor wall weekly.

**CLI:** see the [env table](../cli/installer-auth-and-sync.md#environment-variables) — `CCWARRIORS_API`/`CCWARRIORS_WEB` are the ones you need for pointing a CLI at a local server.

## Rollout ordering

When a deploy changes the transcripts/insights payload, **ship the server first**. The server caps story sessions at 300; a newer CLI sending more to an old server returns 400, whereas an old CLI against a new server is always safe. The CLI fleet self-updates after the server is live, so server-first converges cleanly.

## Go-live checklist

- [ ] GitHub OAuth app created; Client ID/Secret in Railway.
- [ ] Railway: Postgres wired, env set, `SEED_DEMO`/`SIMULATE` **not** set; deploy runs migrations automatically.
- [ ] `https://api.ccwarriors.xyz/health` → `{"status":"ok"}`; `api` + `get` CNAMEs + TLS live.
- [ ] Vercel: `VITE_WS_URL` set; `ccwarriors.xyz` + TLS live.
- [ ] `curl -fsSL https://ccwarriors.xyz/install.sh | bash` end to end: install → login → sync → on the board.
- [ ] Badge renders: `https://api.ccwarriors.xyz/badge/<your-login>.svg`.
