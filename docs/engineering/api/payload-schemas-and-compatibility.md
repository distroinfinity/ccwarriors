---
title: Payload Schemas and Compatibility
description: Wire contracts — ingest versions, WS messages, and the fields that can never change.
---

# Payload Schemas and Compatibility

The fleet is never homogeneous: self-update converges clients over hours-to-days, badges are cached by GitHub's camo proxy, and old profile links live forever. Every shape on this page is load-bearing.

## Ingest: two payload generations

`POST /ingest` (`routes/ingest.ts`) accepts both, discriminated by shape:

**v1 (legacy, accepted forever):**

```json
{ "cost30d": 12.34, "costAllTime": 456.78, "ccusageVersion": "..." }
```

Both cost fields required, `≥ 0`, capped at $1,000,000 (over → 422). Since ccusage v20 reports all agents lumped, the server subtracts known non-claude slices before writing the claude share — see `services/ingest.ts` (`ingestLegacy`).

**v3 (current, raw tokens):**

```json
{
  "tools": {
    "claude": [
      { "date": "2026-06-04",
        "models": [{ "modelName": "claude-opus-4-8", "inputTokens": 1024,
                     "outputTokens": 512, "cacheCreationTokens": 2048,
                     "cacheReadTokens": 4096 }],
        "costEstimate": 0.12 }
    ]
  },
  "machineId": "a1b2c3d4e5f60718",
  "clientBuildId": "…",
  "ccusageVersion": "…"
}
```

Constraints (zod, `routes/ingest.ts`): ≤24 tool keys; ≤45 days per tool; `date` is `YYYY-MM-DD`; token counts are non-negative ints ≤50B/day; `machineId` **required** with `tools` (hex 8–64 chars, lowercased server-side) — without it per-machine dedup collapses. `costEstimate` is ccusage's own price for the day; it is a display hint and cross-check only, never stored as truth.

Tool keys must match the registry (`lib/tools.ts`, mirrored in `packages/cli/src/tools.ts` — `ccusage <key> daily` subcommand names). Unknown keys are normalized into `"other"`, not dropped.

**Response:** `{ ok: true, tier, rank30d, rankAllTime, insightsRequested, insightsMode, consentVersion }`. `insightsRequested` is back-compat sugar (`mode === "deep"`); new clients read `insightsMode`. Errors: `{ ok: false, error: "unauthorized" | "implausible" | "rate_limited" }`.

## WebSocket broadcast

`ws/broadcast.ts` sends a full snapshot on connect and on every ingest (1s debounce, top-100 per board):

```json
{
  "type": "snapshot" | "update",
  "count": 1234,
  "top30d": [Entry, …],
  "topAllTime": [Entry, …],
  "byTool": { "claude": { "top30d": [Entry, …] } },
  "tools": [{ "key": "claude", "label": "Claude Code", "count": 900 }],
  "totals": { "burned30d": 123456.78, "count": 1234 }
}
```

`count` / `top30d` / `topAllTime` are **byte-compatible legacy keys** — deployed pages from before the multi-tool era read exactly these. `byTool` / `tools` / `totals` are additive; the client treats their absence as "old server" and hides the chips (`apps/web/src/useLeaderboard.ts`). `Entry`: `{ id, githubLogin, avatarUrl, xHandle?, tier, cardScene, cost30d, costAllTime, breakdown?, orgs? }`.

## Self-update contract

- `GET /cli/version` → `{ buildId, updateEnabled }`. `buildId` is read from the served bundle's `// ccw-build:<id>` banner (cached per mtime). `updateEnabled: false` (`CLI_UPDATE_ENABLED=0`) halts the entire fleet's updates without a deploy.
- `GET /cli.js` → the bundle. The CLI verifies the downloaded file contains `ccw-build:<target>` before swapping — a stale CDN or mismatched deploy fails closed.

## Badge and OG contracts

- `/badge/:login.svg` is embedded in third-party READMEs; the URL format and SVG-ness are permanent. Content degrades to "enlist →" for unknown/flagged users rather than 404ing (camo caches errors).
- `/og/u/:login` returns crawler-targeted HTML with meta tags plus a meta-refresh redirect to the profile for any human who lands there.

## Never rename

- Ingest v1 fields (`cost30d`, `costAllTime`) — pre-v3 clients sync forever.
- WS keys `count`, `top30d`, `topAllTime`.
- Ingest response `insightsRequested` (until pre-mode clients are extinct).
- Tool registry keys — they are both ccusage subcommand names and `usage_days.tool` values; renaming orphans history.
- `/cli/version` response fields and the `ccw-build:` banner format — the deployed fleet's updater parses both.
- Config file paths (`~/.claude-warriors/config.json`, `~/.ccwarriors/cli.js`) — self-update and support flows assume them.
