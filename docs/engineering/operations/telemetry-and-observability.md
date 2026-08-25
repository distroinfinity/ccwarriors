---
title: Telemetry and Observability
description: The event pipeline, the named signals, and how to triage with them.
---

# Telemetry and Observability

## Pipeline (`routes/telemetry.ts`)

`POST /telemetry` accepts anonymous events from the installer, the CLI, and the web. Every event logs to stdout; with `POSTHOG_API_KEY` set it also forwards to PostHog (`POSTHOG_HOST`, default `https://us.i.posthog.com`). No key, no forward — the endpoint never errors on clients. `GET /telemetry/failures` exposes a rolling in-memory failure window for quick triage without log access.

Server-side code emits through the same `captureEvent()`, including `app.onError` → `server_error` with path, method, and a 200-char message clamp.

CLI beacons are fire-and-forget (4s await only on rollback, since the process is exiting); users opt out with `CCWARRIORS_TELEMETRY=0`, which also silences the installer.

## OpenTelemetry → sigiro (`apps/server/src/otel.ts`)

Separate pipeline from `captureEvent()` above, and complementary: product events go to PostHog, request/runtime telemetry goes to sigiro. `otel.ts` is loaded by `node --import` in the `start` script (and `tsx --import` in `dev`), before any app module, so `@opentelemetry/auto-instrumentations-node` can patch `http`, `dns`, `ws`, `fs` and friends. Traces, metrics and logs all export over OTLP/HTTP.

The whole thing is dormant unless `SIGIRO_API_KEY` is set — tests, CI and local dev pay nothing. With it set, `otel.ts` derives `OTEL_EXPORTER_OTLP_ENDPOINT` (default `https://api.sigiro.com`; hosted sigiro terminates OTLP on **443**, not the conventional `:4318`), `OTEL_EXPORTER_OTLP_HEADERS` (`Authorization: Bearer $SIGIRO_API_KEY`) and `OTEL_SERVICE_NAME=ccwarriors-server`. Any of those already present in the environment wins, so the standard OTel env vars still work for overrides.

Two gaps worth knowing: `console.*` has no upstream auto-instrumentation, so `otel.ts` bridges it into the OTLP logs pipeline by hand; and DB calls are **not** traced — the OTel `pg` instrumentation only patches `node-postgres`, and this server uses `postgres.js` via drizzle. Queries show up inside their HTTP server span, not as spans of their own.

## Named signals

**Funnel:** `web_visit` (with `?ref` channel) → `install_started` / `install_completed` / `install_failed` (with the failing step: `node_missing`, `node_old`, `download`, …) → `user_enlisted` / `enlist_failed`.

**Sync health:** `sync_failed` (CLI, after 3 consecutive hard failures — fleet signal, not per-failure spam), `tool_collection_failed` (one agent's ccusage read broke), `ccusage_fallback` (pinned version crashed, fell back to `20.0.6`), `insights_received` / `deep_insights_received` / `story_transcripts_received` / `transcripts_rejected`, `insights_extract_error`.

**Integrity:** `plausibility_flagged` (reason + detail — the quarantine feed to watch), `unknown_model_priced` (LiteLLM lagging a new model — expect totals to shift when real prices land), `estimate_mismatch` (client estimate vs server math diverged >25% — tampered client *or* stale pricing table), `price_override_active` (`{ model }`, distinctId `system`, on boot + each 24h refresh — a hand-priced override in `lib/pricing.ts` is still shadowing LiteLLM; when it stops firing, upstream has priced the model and the override entry can be deleted), `admin_flag` / `admin_unflag`.

**Self-update fleet:** `self_update_applied`, `self_update_failed`, `self_update_rollback` (from/to build ids — a spike here means a bad release went out; flip `CLI_UPDATE_ENABLED=0` while you fix it).

**Stories/insights:** `story_generated`, `story_generate_failed`, `insights_consent`, `insights_mode`, `github_stats_fetch_failed`.

## Health and triage

- `GET /health` — Railway's healthcheck; restart-on-failure handles crashes.
- **Autosync daemons going dark:** `GET /telemetry/stale-daemons` reports daemon-like users (≥ `DAEMON_MIN_SYNCS_7D` syncs in 7d) whose last sync has gone stale (`silent2h`/`silent12h`/`silent24h` counts + a worst-first sample with their stuck build). The scheduled health workflow polls it and pages only on a spike (≥5 daemons AND ≥40% silent >12h) — the signature of a release-wide self-update relaunch failure (issue #91). A silently-dead daemon emits no client beacon, so this server-side view is the only way to see it.
- **Board looks stale:** the global board is WS-pushed, org boards poll REST every 10s. Confirm which transport before digging — an org board lagging ≤10s is working as designed.
- **User says their number is wrong:** check `unknown_model_priced` (new model at default price) and `estimate_mismatch` first; then `usage_days` for their machineId split.
- **User vanished from the board:** `plausibility_flagged` has the reason; `users.flagReason` has the first three signals; `/admin/unflag` restores after review.
- **Installs failing:** `install_failed` carries the step; check `get.ccwarriors.xyz` health if the step is `download`.
- **Update spike:** watch `self_update_rollback` after every deploy; the kill switch is `CLI_UPDATE_ENABLED=0`.
