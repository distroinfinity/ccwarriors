---
title: Testing and Local Development
description: The zero-setup dev loop, the real-CLI-locally recipe, and the test seams.
---

# Testing and Local Development

## Two terminals

```bash
pnpm install

# backend — in-memory PGlite + 15 seeded demo warriors + simulated live spend, :8787
pnpm --filter server dev

# frontend — Vite on :5173, talks to ws://localhost:8787
pnpm --filter web dev
```

No Postgres, no env file. `SEED_DEMO` gives 15 named warriors (`seed.ts`); `SEED_EXTRA=N` appends synthetic ones for pagination/infinite-scroll testing; `SIMULATE` animates spend so the board moves. All three are local-only — never set in production.

Org board locally: `http://localhost:5173/?org=ns` (subdomains are a prod thing).

## Real CLI against a local server

The dev server runs without OAuth (routes unmounted). To exercise login → sync end to end you need a second GitHub OAuth app with callback `http://localhost:8787/cli/callback`:

```bash
GITHUB_CLIENT_ID=xxx GITHUB_CLIENT_SECRET=yyy PUBLIC_BASE_URL=http://localhost:8787 \
  pnpm --filter server dev

# in another terminal:
pnpm --filter claude-warriors build
CCWARRIORS_API=http://localhost:8787 CCWARRIORS_WEB=http://localhost:5173 \
  node packages/cli/dist/cli.js
```

`SEED_CLI_TOKEN` creates a dev user with a known bearer token when you want to hit `/ingest` directly without the OAuth round-trip.

## Tests

- `pnpm --filter server test` — vitest; the suite builds apps through `createApp(deps)` with injected fakes (PGlite db, fixed `usdInr` rate, fake `storyGenerate`) — no network, no real keys.
- `pnpm --filter claude-warriors test` — vitest over the CLI's pure parts (redaction, backoff, payload shaping).
- `pnpm --filter web typecheck` — the web package has no test suite; `tsc --noEmit` plus the build is the gate.

When adding a server feature, wire it through `AppDeps` rather than importing config — that's what keeps it fake-able in tests and conditionally mountable in prod.

## PGlite vs Postgres

PGlite is close, not identical: run anything touching migrations, transactions, or index behavior against real Postgres before shipping (`DATABASE_URL=… pnpm --filter server dev`). Migrations themselves are exercised on every Railway deploy via the `preDeployCommand`.
