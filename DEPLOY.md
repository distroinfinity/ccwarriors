# CCWarriors — Deploy & Setup

```
ccwarriors.xyz        →  Vercel   (frontend, apps/web — also serves /install.sh + /cli.js)
api.ccwarriors.xyz    →  Railway  (backend, apps/server) + Railway Postgres
get.ccwarriors.xyz    →  Railway  (installer fallback host)
CLI                   →  curl -fsSL https://ccwarriors.xyz/install.sh | bash   (no npm)
```

Production has **no seed/dummy data** — the board fills as real people run the CLI.
Both builds are config-as-code: `railway.json` and `vercel.json` at the repo root.

The full guides live in the engineering docs:

- **[Deployment and Environment](docs/engineering/operations/deployment-and-environment.md)** —
  accounts and secrets, DNS, the complete env var reference, go-live checklist.
- **[Testing and Local Development](docs/engineering/operations/testing-and-local-development.md)** —
  the two-terminal dev loop and running the real CLI against a local server.
- **[Telemetry and Observability](docs/engineering/operations/telemetry-and-observability.md)** —
  named signals and the triage playbook.
- **[Invariants and Gotchas](docs/engineering/invariants-and-gotchas.md)** — operator traps
  (two CLI state dirs, WS vs org polling, the self-update kill switch).

## Hosting-cost knobs (memory is the bill)

Railway bills ~$10/GB-month of actual RSS; memory-minutes are ~90% of this
project's cost (CPU/egress are cents). Two manual steps finish the 2026-08
cost-reduction work after the code changes bake:

1. **api heap cap** — once `/health` shows a stable `heapUsed` peak under
   ~180MB for 24–48h, set on the Railway api service:
   `NODE_OPTIONS=--max-old-space-size=320 --max-semi-space-size=8`
   (drop to 256 after a clean week). Without a cap V8 lets old-space drift up
   for no benefit. If the service ever OOMs at boot, raise the cap first.
2. **Postgres tuning** — after the snapshots retention job has done its first
   purge: `railway connect postgres`, then
   `ALTER SYSTEM SET shared_buffers='64MB'; ALTER SYSTEM SET max_connections='30'; ALTER SYSTEM SET work_mem='4MB';`
   and restart the service from the dashboard (shared_buffers needs a restart).
   ⚠ These live on the DB volume — a volume re-provision silently reverts them.

Standing invariants: `snapshots` is pruned to 14 days by
`apps/server/src/services/retention.ts` (the stale-daemons report reads a 7-day
window — keep retention above that), and the daemon heartbeat is floored at
15 min in `packages/cli/src/daemon.ts` so old 5-min plists/crontabs calm down
via self-update.

## Sync write volume (2026-08)

Memory stayed the bill, and the row rate was the driver: `snapshots` was 87MB of
a 102MB database because the daemon syncs on `fs.watch`, not on the heartbeat —
400-900 syncs/user/day. Two floors now bound it, both env-overridable:

- **Server**: `SNAPSHOT_INTERVAL_MS` (`services/ingest.ts`) writes at most one
  `snapshots` row per user per hour. `users.last_synced_at` is still stamped on
  every sync — that, not the row count, is the freshness signal the
  stale-daemon report reads.
- **Client**: `packages/cli/src/backoff.ts` floors watch-driven syncs at 5 min
  (`CCWARRIORS_MIN_SYNC_GAP_MIN` overrides). Reaches the fleet via the
  self-update bundle swap. Nothing is lost when a sync is deferred — ccusage
  totals are cumulative.

## Anti-gaming gates (2026-08)

The plausibility gates compared **dollars**, and dollars are recomputed on every
ingest from a LiteLLM table that changes upstream. Cache reads are ~94% of a real
agentic day, so one upstream `cache_read_input_token_cost` change swung a settled
day 30-40% — which quarantined **31 of 77 users**, 15 of them still actively
syncing. Every gate is now denominated in **tokens** (`lib/plausibility.ts`).

- `history_rewrite` and `burn_rate` are **observation-only**: they still emit
  `plausibility_signal` telemetry, they never hide a user. They were the two that
  price drift moved.
- Everything else still quarantines, on token-denominated thresholds sized above
  the observed population maximum (daily 20B tokens vs a 15.6B population max;
  new-tool window 150B vs 83B).
- Two escape hatches, no deploy needed: `GATE_QUARANTINE_ENABLED=0` lifts every
  gate, `GATE_QUARANTINE_REASONS=a,b` replaces the allowlist.
- `ADMIN_TOKEN` **must** stay set on the api service or `/admin/flag` and
  `/admin/unflag` are mounted but reject everything — there is then no way to
  clear a false positive.

Keep the committed price snapshot fresh — it is what prices models between boot
and the first background refresh, and a stale one makes the same day price twice:

    pnpm --filter server exec tsx scripts/refresh-price-snapshot.ts

## Health checks

`/telemetry/stale-daemons` is a 7-day aggregate over `snapshots`. It is computed
on a **timer** (`routes/daemon-health.ts`), never on the request path: it used to
be a 30-min request cache while the workflow polled hourly, so every poll paid
for a full parallel seq scan and intermittently blew the check's timeout — 8
false "prod health check failing" alerts in Aug 2026 (#110-#117), all auto-closed
within two hours. The workflow now allows 30s for that one check and reports a
timeout distinctly from a genuine failure.
