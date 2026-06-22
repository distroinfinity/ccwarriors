---
title: App Shell and Live Data
description: Routing without a router, the board data hooks, and the Vercel rewrites they depend on.
---

# App Shell and Live Data

## Routing (`src/App.tsx`)

There is no router — module-level regexes over `window.location.pathname` resolve the page once at load:

- `/how` → HowItWorks; `/legal` → Legal, currently hidden behind `HIDE_LEGAL = true` until Razorpay international activation needs it (issue #8).
- `/u/:login` (legacy, kept for shared links and the OG rewrite) and bare `/:login` → profile. The login regex is `[A-Za-z0-9-]{1,39}`; `RESERVED_TOP_LEVEL = {"how", "legal"}` keeps real routes from being swallowed — extend it when adding top-level pages.
- `/:login/story` → story page. The **static `/story` suffix** is deliberate: a parameterized second segment collided with the `vercel.json` rewrites (issue #62).
- Org co-branding (`src/orgs.ts` registry, mirroring the server's `lib/orgs.ts`): `ns.ccwarriors.xyz` subdomain or `?org=ns` locally sets `data-org` on `<html>` before first paint so the accent doesn't flash.

`vercel.json` provides the SPA fallback (`/(.*) → /index.html`) and the OG bot rewrite: `/u/:login` requests from crawler UAs go to `https://api.ccwarriors.xyz/og/u/:login`. Only the `/u/` form is rewritten. Current profile/deck share buttons emit short `/:login?ref=x_share` links, which work for humans but do not hit the crawler rewrite; rich-preview shares must use `/u/:login` or the rewrite/share target needs to change.

## API base (`src/api.ts`)

One env var drives both transports: `API_HTTP` is `VITE_WS_URL` with `ws` → `http` (default `ws://localhost:8787`).

## Global board (`src/useLeaderboard.ts`)

WebSocket with a REST seed for fast first paint:

- On mount, fetch `/leaderboard?board=30d&limit=20` in parallel with the WS connect; the seed renders the board in the degraded old-server shape (no `tools`/`byTool` → filter chips hidden). The first WS snapshot replaces it; if the seed loses the race it's a no-op (`hasCompleteData` guard).
- Every WS message **replaces** state wholesale — no client-side merging. Missing `byTool`/`tools`/`totals` are treated as "old server" and default to empty.
- Reconnect: `setTimeout(connect, 1500)` on close; `connected` drives the live-dot UI.

## Org boards (`src/useOrgBoard.ts`)

REST polling, deliberately not WS: the broadcast is global-only (orgs ride along as entry fields). Polls `/leaderboard?board=30d&limit=100&org=<slug>` every `POLL_MS = 10_000`, returning the same `BoardState` shape as the WS hook — the org response carries `tools` + `byTool` so chips work identically. The 5s `Cache-Control` + ETag on the server collapse unchanged polls into 304s.

## Session and profile hooks

- `useMe` — `GET /me` with credentials; null login = signed out. Drives the header auth state and owner detection.
- `useProfile` — one-shot `GET /profile/:login` with credentials, with a background refetch after consent toggles (stale-while-revalidate, no skeleton flash).

Telemetry: a fire-and-forget `POST /telemetry` (`web_visit` with the `?ref` channel) on load; failures are swallowed — analytics must never break the page.
