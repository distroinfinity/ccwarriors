---
title: Profile and Story Pipeline
description: What a profile aggregates, the hire-grade metrics, and the transcript-to-story lifecycle.
---

# Profile and Story Pipeline

`GET /profile/:login` (`routes/profile.ts`) assembles everything a profile page shows in one response. Owner requests (session cookie matches) get `private, no-store` and extra owner state; public requests get `public, max-age=30`.

## Profile assembly

- **Identity + board state** from the leaderboard store: tier, card scene, cost30d/allTime, ranks, plus `tokensAllTime`.
- **Rhythm** from `usage_days`: daily costs (up to 53 weeks) plus current/longest streaks.
- **Efficiency** (`lib/efficiency.ts`) from the 30-day window: cache-read ratio (`cacheRead / (input + cacheCreation + cacheRead)`), cost-weighted model mix by family (regex: opus/sonnet/haiku/openai/gemini/other), opus share, tokens per active day. The **grade is cache-based only** — A+ ≥95%, A ≥90%, B ≥80%, C ≥65%, else D. Production data showed the median user is ~90% Opus and ~96% cache-read, so model-mix grading and the old "move to Sonnet" nudge were removed (`estSavingsPerMonth` is always null; `opusShare`/`modelMix` are informational).
- **GitHub stats** (`lib/github-stats.ts` + `github-stats-service.ts`): public footprint fetched with the user's own `read:user` OAuth token, falling back to the server `GITHUB_TOKEN` PAT. 6h fresh TTL, 30m error retry, serve-stale-forever (`github-stats-service.ts:11`).
- **Insights** (locked or unlocked): axes, archetype, trait, habits, growth edge, insight cards (with `featuredCardKeys` + `deckMonth` for the monthly deck), Craft Score + pillars + tier, trust tier, `tagline`, and the three hire-grade blocks below. A locked block's `reason` is `no_consent` (never given or revoked — deliberately indistinguishable) or `forging` (consented, no data landed yet).

### Hire-grade metric blocks

The metrics-audit round (#79) promoted three outcome-coupled blocks to first class, all derived from the deep session records:

- **Outcome economics** (`outcomeEconomics`, `lib/craft-score.ts`): `survivingLoc` = Σ `max(0, linesAdded − revertedLinesWithin14d)` over sessions with git; `costPerSurvivingLoc = windowCostUsd / survivingLoc` (null below `MIN_SURVIVING_LOC_FOR_ECONOMICS = 50` or zero cost); `commitsPer100Usd` (null below `MIN_COST_USD = 1` or `MIN_COMMITS = 3`). Honest window mismatch, labeled not hidden: sessions span the deep window (≤60d, typically 40d) while `windowCostUsd` is the 30-day usage figure.
- **Session depth**: counts, plan-mode %, subagent spawns/peak parallel, max concurrent, active hours, avg/longest session.
- **Stack** (`buildStack`, `lib/stack.ts`): "builds with" languages from the file extensions the agents actually edited (`SessionRecord.extensions`), mapped via `EXT_LANGUAGE` — `md`/`json`/`yaml`/`toml` are deliberately unmapped so README/CI tweaks can't outrank real languages — plus the model mix and the user's top GitHub languages.

## Craft Score (`lib/craft-score.ts`)

Six outcome-coupled pillars, each 0–100: **verification (0.22)**, **yield (0.22)**, **direction (0.16)**, **autonomy (0.16)**, **orchestration (0.12)**, **throughput (0.12)** — verification and yield carry the load because they're hardest to game. Three pillars are *outcome* (verification, yield, throughput — measured against real git results), three are *behavioral* (direction, autonomy, orchestration — how sessions are run). The composite is min-pulled: `craftScore = weightedMean − 0.25 × (max − median)` — a spiky profile is only as strong as its weakest craft. Tiers: Mastersmith ≥80, Artisan 60–79, Journeyman 40–59, else Apprentice.

Insights render **from session #1**. `MIN_SESSIONS = 10` and `PERCENTILE_MIN_POPULATION = 30` only gate *percentile* scoring: under 10 sessions a profile shows EARLY READ and isn't in the pool; at ≥10 sessions but a consented population under 30, scores use fixed calibration anchors and show CALIBRATED; at/after 30, percentiles take over. Every numeric constant is a v1 placeholder (issue #51) — the **shape** of each formula is the contract, not the magic numbers. The pipeline is deterministic and pure; the only LLM anywhere is the user's own.

`craft-score-service.ts` recomputes the score eagerly on every `/insights/deep` upload and persists it to `users.craftScore`/`trustTier` (0 unverified, 1 local-git verified), so reads never replay pillar math. The deep upload also derives the aggregate `user_insights` row from the session records — one upload feeds the archetype/efficiency paths and Craft Score alike.

## Story pipeline (`lib/story-service.ts`, `lib/story.ts`)

An LLM-written, person-first narrative generated from redacted transcripts the CLI uploads under consent v2.

1. CLI posts redacted sessions to `/insights/transcripts` → upserted into `story_sources` (one transient row per user). The route caps at 300 sessions with an 800k-char guard.
2. Generation requires `ANTHROPIC_API_KEY` + `STORY_MODEL` (`STORY_MODEL = "claude-opus-4-8"`); without them transcripts sit dormant (`app.ts` wires `storyGenerate` only when configured).
3. Throttle: at most one generation per user per `STORY_REFRESH_MS = 24h`, with in-flight dedup.
4. Input is trimmed to `SERVER_INPUT_CHAR_CAP = 600_000` by **dropping whole oldest sessions**, never slicing mid-JSON. The model gets session timings, tool-call names, hashed git outcomes, and client-side-redacted prompts — never code, paths, commit messages, or SHAs.
5. The `StoryDoc` schema is person-first: `tagline` (one-sentence identity line, also seeds the profile masthead verdict) and `arc` (how they changed over the window — empty string when no real trajectory; never invented) alongside narrative, decision patterns, strengths, growth areas, AI archetypes, and the cryptic prompt.
6. `sessionsAnalyzed` and `windowDays` are **server-stamped from the actual count sent** (`sessionsUsed`), never trusted from the LLM; a `sessionsUsed` vs `sessionsReceived` gap is the truncation canary. The story header discloses the window ("N SESSIONS · LAST 40 DAYS").
7. Output is stored in `user_stories.doc`; the `story_sources` row is **deleted immediately after successful generation** — a user-facing promise.

`GET /profile/:login/story` serves the doc — owner `private, no-store`, public `public, max-age=300`, and only when the user's insights are public or it's the owner asking.
