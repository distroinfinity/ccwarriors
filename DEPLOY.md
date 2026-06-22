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
