---
title: Invariants and Gotchas
description: The rules that must hold, and the traps that have already bitten.
---

# Invariants and Gotchas

## Invariants

Each of these is load-bearing. Breaking one isn't a style regression — it corrupts data, breaks deployed clients, or voids a user-facing promise.

1. **Server-authoritative pricing.** Client dollars are never stored or ranked; only raw token counts cross the wire (`lib/pricing.ts`, `services/ingest.ts`). ccusage's `costEstimate` is a cross-check signal, nothing more.
2. **Gates never 4xx.** Plausibility violations flag into shadow quarantine while the sync returns 200 — probing cheaters must learn nothing (`lib/plausibility.ts:3-6`).
3. **v1 ingest is accepted forever.** `{cost30d, costAllTime}` clients predate self-update reliability; they sync until they die of natural causes (`routes/ingest.ts`).
4. **WS legacy keys are byte-compatible.** `count`/`top30d`/`topAllTime` feed pages deployed before multi-tool; new fields are additive only (`ws/broadcast.ts`).
5. **machineId is deterministic.** `sha256(hostname|user|platform|arch)` — reinstalls must map to the same per-machine ledger or users double-count (`packages/cli/src/config.ts:42-67`).
6. **The usage ledger dedups on `(userId, machineId, tool, day)`.** Multi-machine users aggregate by sum; last-write-wins would flip-flop totals *and* false-trip the history gate (`db/schema.ts:170`).
7. **Settled days are append-only.** Days older than 2 days growing >10% means rewritten logs → `history_rewrite` flag. Don't "fix" user history server-side; you'll quarantine them.
8. **`insightsSalt` never leaves the machine.** It's what makes git hashes irreversible. There is no legitimate reason to upload it.
9. **`story_sources` rows are purged after generation.** Documented user promise (`lib/story-service.ts`). Retention "for debugging" is a privacy incident.
10. **Demo data never reaches production.** `SEED_DEMO`/`SIMULATE` are local-only; the prod board fills with real syncs only.
11. **Tool keys are forever.** They're ccusage subcommand names *and* `usage_days.tool` values; renaming one orphans history. Add, don't rename (`lib/tools.ts`).
12. **Craft never leaks to the public stream.** A leaderboard entry gets `craft` only through `craftEntryFor()` — `insightsConsent === true AND insightsVisibility === "public" AND craftScore != null`. A private user's craft must never reach the WS/REST board; revoking either flag strips it via `setCraft(id, undefined)`.
13. **`sessionsAnalyzed` is server-stamped.** The story's session count comes from the actual sessions used, never the LLM's self-report (`lib/story.ts`).

## Gotchas

- **Two state directories.** CLI bundle + installer assets live in `~/.ccwarriors`; auth/config/caches live in `~/.claude-warriors`. Support cases regularly involve a user deleting one and not the other.
- **`CCWARRIORS_HOME` means two different directories.** `core.ts:18` resolves it for the ref file (`~/.ccwarriors`); `insights.ts:330` resolves it for the insights cache (`~/.claude-warriors`). Setting it redirects *both* families into one directory. Known wart — fix it deliberately or leave it alone, don't half-fix it.
- **Org boards poll REST; the global board is WS.** "Apex board is live but the org board lags" is normal (≤10s) — and when debugging freshness, check the right transport.
- **The OG rewrite covers only `/u/:login` for bot UAs.** Short `/:login` links work for humans but won't unfurl — share buttons must emit `/u/` URLs (`vercel.json`).
- **`/:login/story` uses a static suffix on purpose** — a parameterized second segment collided with the Vercel rewrites (issue #62). Mirror the pattern for future sub-pages.
- **Classic GitHub OAuth apps take exactly one callback URL.** Local OAuth needs a second app pointing at `http://localhost:8787/cli/callback`.
- **The Railway build must build the CLI too.** `railway.json` runs `pnpm --filter claude-warriors build` because the server serves `/cli.js` as the installer fallback (`get.ccwarriors.xyz`). Trim the build command and the fallback 503s.
- **Unknown models price at the ≈Sonnet default** until the LiteLLM refresh catches up — totals for brand-new models shift slightly when real prices land. `unknown_model_priced` telemetry is the early warning, not a bug report.
- **`launchctl unload` can silently fail on newer macOS.** Teardown uses `bootout` first and *verifies* the job is gone, throwing with the manual command if not (`autosync.ts`).
- **Rollback tolerance is deliberate.** The self-updater only rolls back after 5 boots with no completed sync *attempt* — network or upstream-ccusage breakage must not revert a healthy CLI (`selfupdate.ts`).
- **PGlite ≠ Postgres.** Close enough for dev, but migrations and concurrency behavior differ; anything touching transactions or indexes needs a real-Postgres check before shipping.
- **`/legal` is built but hidden** behind `HIDE_LEGAL = true` in `App.tsx` until Razorpay international activation needs it (issue #8).
- **`config.ts` doesn't parse every env var.** `GATE_*`, `ADMIN_TOKEN`, `POSTHOG_*`, `NS_GUILD_ID`, `CLI_UPDATE_ENABLED` are read at their call sites — grep before assuming a var is dead.
- **Deploy the server before the CLI** when changing the transcripts payload. The server caps sessions at 300; a newer CLI sending more to an old server 400s, while old CLI → new server is always safe. The CLI self-updates once the server is live.
- **Story sampling is char-budget, not a session cap.** `transcripts.ts` packs to a ~500k-char budget (85% recent + 15% stratified older), not "the 30 newest" — the old cap gave active users ~10% coverage. Don't reintroduce a flat recency cap.
- **`stack.ts` deliberately omits `md`/`json`/`yaml`/`toml`.** Mapping them would let README and CI edits outrank real languages on the "builds with" panel. The unknown-extension path is "omit", not "guess" — keep it that way.
