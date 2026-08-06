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
