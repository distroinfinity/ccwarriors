---
title: Deep Insights Extraction
description: Opt-in session analysis — what's extracted, what's redacted, what never leaves.
---

# Deep Insights Extraction

Everything here is opt-in and consent-versioned. Default mode sends token counts only; this page is the machinery behind `ccwarriors insights`.

## Consent ladder (`src/config.ts:16-22`, `src/cli.ts`)

`CONSENT_VERSION = 2`. The config stores `ackConsentVersion` — the disclosure version the user actually saw and accepted:

- **Deep mode, v1:** per-session counts, timing summaries, model names, salted-hash git outcomes.
- **v2 adds text:** redacted transcripts for story generation. The extractor can compute a top repeated short prompt too, and the server schema can accept it, but the current `postInsightsDeep()` request body does not send that separate `topPrompt` field. Pre-v2 deep users stay counts-only until they see the v2 disclosure; if the server reports a newer acknowledged version (the user clicked "GO ALL-IN" on the web), the CLI adopts it without re-prompting. The consent prompt is interactive-only — no TTY, no prompt, no text extraction.

`ccwarriors insights on` prints the full plain-text disclosure before asking. `insights off` calls the server to disable the mode and purge server-side deep data. `insights --dry-run` extracts and prints the exact payload locally without sending anything.

## Extraction (`src/insights.ts`)

Source: session JSONL files under `~/.claude/projects` (`CCWARRIORS_CLAUDE_DIR` override), last 40 days. Per session it counts prompts, interrupts, assistant turns, edit calls, subagent spawns, max parallelism, plan-mode usage, word-length buckets, session start hour and duration, recovery loops (≥3 consecutive error tool-results and time-to-breakout), and a top-10 file-extension histogram of edited files.

Git outcomes (`src/git.ts`): per-repo commits, lines added/deleted, files changed, test files touched, reverted-lines-within-14d, squash/rebase detection — with repo and branch identified only by salted hashes. The salt is `insightsSalt` from config: 16 random bytes that **never upload**, so nobody (including the server) can reverse a repo identity, but the same repo hashes consistently across uploads. Git subprocess concurrency is capped at 6.

What stays local, always: cwd, branch names, file paths, file contents, tool inputs, raw event-gap arrays, the salt itself.

**Cache:** `~/.claude-warriors/insights-cache.json` (mode 0600) keyed by file path/size/mtime so unchanged session files aren't re-parsed; cache format version 4 — a bump discards stale shapes wholesale (`insights.ts:294`). **Throttle:** uploads at most every 6h (`SEND_INTERVAL_MS`, `insights.ts:639`); a fresh consent acknowledgment bypasses the throttle once so "unlock my story" on the web takes effect immediately.

## Transcripts (`src/transcripts.ts`, v2 only)

Per session: start day, duration, model, interrupt count, up to 60 user prompts (each redacted, truncated to 2000 chars), and tool-call **names** with counts — never inputs, paths, or commands. Subagent sidechains (`isSidechain`) are skipped. Uploads to `/insights/transcripts` alongside a successful deep upload, riding the same 6h window.

Selection is **char-budget packed, not a recency cap** (the old `MAX_STORY_SESSIONS = 30` over-indexed on the last few days — ~10% coverage for active users). The collector parses every in-window file (files >50MB skipped), filters trivial sessions (`MIN_SESSION_PROMPTS = 2`, `MIN_SESSION_MINUTES = 2`), then packs toward `STORY_CHAR_BUDGET = 500_000`: 85% recency-greedy over "active" projects, then a stratified older sample across four 10-day slices of the 40-day window (scored so dense projects with real edits beat one-off pokes at dead repos). Stale projects (`STALE_PROJECT_DAYS = 14` with ≤2 sessions) are deprioritized; sparse users (<5 eligible sessions) keep everything. Hard ceiling `MAX_STORY_SESSIONS = 250` client-side (the server allows 300). Project directory names are used for local scoring only and never leave the machine.

Redaction (`src/redact.ts`) strips API keys (`sk-`, `ghp_`, `xox-`), AWS `AKIA` keys, JWTs, URL credentials, `secret=`-style assignments, long hex/base64 blobs, and email addresses. Fail-open in the safe direction: over-redaction is acceptable, under-redaction is not.

## Server counterpart

`POST /insights/deep` (403 `mode_off` unless the server has the user in deep mode), `POST /insights/transcripts`, `GET/POST /insights/mode`. The server re-validates everything (caps in `routes/insights.ts`), recomputes Craft Score on each deep upload, and runs its own deep-mode plausibility gates — see [Ingest Pipeline](../server/ingest-pipeline.md).
