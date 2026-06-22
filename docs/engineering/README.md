---
title: Engineering Docs
description: Internal architecture and onboarding docs for CCWarriors contributors.
---

# Engineering Docs

CCWarriors is a pnpm monorepo with three deployables: `packages/cli` (the `ccwarriors` binary, shipped by the website itself — no npm), `apps/server` (Hono API on Railway), and `apps/web` (Vite + React on Vercel, which also serves the CLI installer). Postgres via Drizzle in production, in-memory PGlite for zero-setup local dev.

Start with [Architecture and Data Flow](system-overview/architecture-and-data-flow.md) to see how a sync travels from a user's machine to the live board. [Invariants and Gotchas](invariants-and-gotchas.md) is required reading before touching the ingest pipeline or the CLI self-updater — both have compatibility contracts that are easy to break silently.
