---
title: Profile and Story Pipeline
description: What a profile aggregates, how Craft Score works, and the transcript-to-story lifecycle.
---

# Profile and Story Pipeline

`GET /profile/:login` (`routes/profile.ts`) assembles everything a profile page shows in one response. Owner requests (session cookie matches) get `private, no-store` and extra owner state; public requests get `public, max-age=30`.

## Profile assembly

- **Identity + board state** from the leaderboard store: tier, card scene, cost30d/allTime, ranks.
- **Rhythm** from `usage_days`: daily costs (up to 53 weeks) plus current/longest streaks.
- **Efficiency** (`lib/efficiency.ts`) from the 30-day window: cache-read ratio (`cacheRead / (input + cacheCreation + cacheRead)`), cost-weighted model mix by family (regex: opus/sonnet/haiku/openai/gemini/other), opus share, tokens per active day. The **grade is cache-based only** — A+ ≥95%, A ≥90%, B ≥80%, C ≥65%, else D. Production data showed the median user is ~90% Opus and ~96% cache-read, so model-mix grading and the old "move to Sonnet" savings nudge were removed (`estSavingsPerMonth` is always null now; `opusShare`/`modelMix` are informational).
- **GitHub stats** (`lib/github-stats.ts` + `github-stats-service.ts`): public footprint fetched with the user's own `read:user` OAuth token, falling back to the server `GITHUB_TOKEN` PAT for pre-#48 logins or revoked tokens. 6h fresh TTL, 30m error retry, serve-stale-forever (`github-stats-service.ts:11`).
- **Insights** (locked or unlocked): axes, archetype, habits, insight cards (`lib/insight-cards.ts` — cards self-guard, emitting only when the underlying signal is real; the owner can pin up to 4 via `/insights/pins`), Craft Score, trust tier, growth edge. A locked block returns reason `no_consent` whether consent was never given or revoked — the two are deliberately indistinguishable.

## Craft Score (`lib/craft-score.ts`)

Six outcome-coupled pillars, each 0–100: **verification (0.22)**, **yield (0.22)**, **direction (0.16)**, **autonomy (0.16)**, **orchestration (0.12)**, **throughput (0.12)** — verification and yield carry the load because they're the hardest to game. The composite is min-pulled: `craftScore = weightedMean − 0.25 × (max − median)` — a spiky profile is only as strong as its weakest craft. Tiers: Mastersmith ≥80, Artisan ≥60, Journeyman ≥40, else Apprentice.

Two scoring modes: below `PERCENTILE_MIN_POPULATION = 30` consented deep-mode users, pillar scores sit on fixed calibration anchors and are badged **provisional**; at/after 30, population percentiles take over. Every numeric constant is a v1 placeholder calibrated on founder/synthetic data (issue #51) — the **shape** of each formula is the contract, not the magic numbers. The whole pipeline is deterministic and pure; the only LLM involved anywhere is the user's own.

`craft-score-service.ts` recomputes the score eagerly on every `/insights/deep` upload and persists it to `users.craftScore`/`trustTier` (0 = unverified, 1 = local-git verified), so reads never replay pillar math. The deep upload also derives the aggregate `user_insights` row from the session records — one upload feeds both the archetype/efficiency code paths and Craft Score.

## Story pipeline (`lib/story-service.ts`, `lib/story.ts`)

The story page is an LLM-written narrative generated from redacted transcripts the CLI uploads under consent v2.

Lifecycle:

1. CLI posts redacted sessions to `/insights/transcripts` → upserted into `story_sources` (one transient row per user).
2. Generation requires `ANTHROPIC_API_KEY` + `STORY_MODEL`; without them transcripts sit dormant (`app.ts` wires `storyGenerate` only when configured).
3. Throttle: at most one generation per user per `STORY_REFRESH_MS = 24h`, with in-flight dedup so concurrent triggers don't double-spend.
4. The model receives session timings, tool-call names, hashed git outcomes, and client-side-redacted prompts — never code, paths, commit messages, or SHAs. Prompt voice: sharp staff engineer, quote real prompts, count real occurrences (`lib/story.ts`).
5. Output is validated against `StoryDocSchema` and stored in `user_stories.doc`; the `story_sources` row is **deleted immediately after successful generation**. That purge is a user-facing promise.

`GET /profile/:login/story` serves the doc — owner `private, no-store`, public `public, max-age=300`, and only if the user's insights are public or it's the owner asking.
