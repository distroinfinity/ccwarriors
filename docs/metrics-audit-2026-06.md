# Metrics Audit — June 2026

A full audit of how ccwarriors calculates, tracks, and delivers its metrics, with
the fixes shipped in this branch and the items deliberately deferred. Framed by two
goals: (1) accuracy and exhaustiveness of what we already show, and (2) the pivot
from "token burn leaderboard" toward a platform that profiles how developers work
with AI agents — the post-LeetCode, hire-and-discover use case.

## How the pipeline works (verified)

- **CLI** (`packages/cli`) shells out to `ccusage` (pinned `ccusage@20`, fallback
  `@20.0.6`) and reads daily per-model token counts for every detected agent
  (claude, codex, gemini, copilot, opencode, amp, and ~9 more). It ships a 40-day
  window of raw token counts + a client-side cost estimate (display only). The
  server prices the truth from a committed LiteLLM snapshot — client dollar
  figures are never trusted.
- **Server** (`apps/server`, Hono + Postgres/Drizzle) stores per
  (user, machine, tool, day) rows in `usage_days` with server-computed cost, runs
  plausibility gates (shadow-quarantine, not rejection), and keeps an in-memory
  `LeaderboardStore` broadcast over WebSocket (top-100, 1 Hz, permessage-deflate)
  and served via REST.
- **Story / deep insights** are consent-gated. The CLI uploads redacted session
  transcripts (prompt text + tool-call *names* only — never code, paths, or repo
  names); the server derives a narrative via Claude Opus and then purges the raw
  source. Per-session behavioral records drive the Craft Score and archetype.

## The "30 sessions" finding (distroinfinity verification)

The story claim — "written from 30 sessions" — was **true, and it was a hard cap he
hit, not his real volume**:

- `packages/cli/src/transcripts.ts` previously took the **30 most recent** parseable
  sessions by file mtime (`MAX_STORY_SESSIONS = 30`), and the server mirrored it
  (`.max(30)` on the transcripts route).
- His machine actually had **~300 eligible main sessions** in the 40-day window
  (plus ~1,360 `agent-*.jsonl` subagent transcripts, correctly skipped). Story
  coverage was **~10%, pure recency bias** — a burst of activity in the last few
  days could crowd out a month of substantive work, and a long-dead repo opened
  once could be over-represented.
- His 30-session payload serialized to **~84k characters** — far under the 600k
  LLM input cap. There was ample headroom (~200 sessions/call) being left unused.

**Fixed** (this branch): the collector now packs sessions into a ~500k-char budget
(recency-greedy for 85%, then a stratified older-sample so the window's start isn't
invisible), filters trivial sessions (<2 prompts / <2 min), and deprioritizes
stale one-off projects — "most recent or most active work," not "whatever was newest."
The server cap rose to 300 with an 800k-char guard; `sessionsAnalyzed` is now
**server-stamped from the actual count** instead of being whatever number the LLM
reported; and truncation drops whole oldest sessions instead of slicing mid-JSON.
The story page now discloses the window ("N SESSIONS · LAST 40 DAYS").

## Findings → status

| # | Area | Finding | Status |
|---|------|---------|--------|
| 1 | Story sampling | 30-session hard cap, recency-only → ~10% coverage for active users | **Fixed** — char-budget + relevance selection (Task 1/2) |
| 2 | Story accuracy | `sessionsAnalyzed` was LLM-reported, never validated | **Fixed** — server-stamped from `sessions.length` |
| 3 | Story accuracy | 600k input truncated mid-JSON, silently corrupting large payloads | **Fixed** — drops whole oldest sessions, counts what was sent |
| 4 | Leaderboard | Tie-break was Map insertion order (nondeterministic across restarts) | **Fixed** — metric → costAllTime → lastSyncedAt → login |
| 5 | Leaderboard | Sparkline was a hash of the user id presented as activity data | **Fixed** — real 8-bucket 30-day cost spark, omitted when no spend |
| 6 | Copy honesty | Marquee said "this month" for a rolling 30-day window | **Fixed** — "in the last 30 days" |
| 7 | Confidence | Scores rendered without sample size; "EARLY READ" was ambiguous | **Fixed** — provenance line, EARLY READ tooltip, CALIBRATED badge |
| 8 | Hiring signal | No outcome-per-dollar metric — burn alone rewards inefficiency | **Added** — $/surviving-line + commits/$100 (Task 6) |
| 9 | Hiring signal | Session depth (counts, plan-mode, orchestration) buried in cards | **Added** — first-class Session Stats panel (Task 5) |
| 10 | Hiring signal | No "what they build with" — repo labels, not verified edits | **Added** — Stack panel from agent-edited file extensions (Task 7) |
| 11 | Hiring signal | Craft Score (the hire-grade number) absent from the leaderboard | **Added** — consent+public-gated craft chip (Task 8) |
| 12 | Coverage | All-time board hidden; profile lacked all-time rank/tokens | **Re-enabled** with honest labeling + profile all-time stats (Task 9) |
| 13 | Rank delta | `▲` shows improvements only, never declines (asymmetric) | **Deferred** — intentional optimism; revisit if it reads as misleading |

## Positioning shift

Burn rate stays the **viral hook** — it's what drives sign-ups and the marquee. But
every hire-grade signal was promoted toward the surface this round: Craft Score now
appears on the leaderboard for consented public warriors, outcome-per-dollar and
verified session depth are first-class profile panels, and the "Builds with" stack
comes from *real agent edits*, not GitHub repo language labels. The throughline for
the discovery/hiring vision: **what a developer actually does with AI agents, priced
and verified, beats a raw spend number.**

## Privacy invariants (held)

- No code, file paths, or repo names ever leave the machine — extensions and
  tool-call names only.
- All deep/behavioral data (depth, economics, stack, craft) is gated on
  `insightsConsent === true AND insightsVisibility === "public"`; a private user's
  craft never reaches the public WS/REST stream (centralized in `craftEntryFor()`,
  adversarially reviewed for leak paths).
- Raw story transcripts are purged after the narrative is generated.

## Deliberately deferred

- **Tier-threshold calibration.** `lib/tier.ts` thresholds (Netherite ≥ $6000,
  Diamond ≥ $2000, Gold ≥ $500, Iron ≥ $100) and the craft percentile pool
  (`PERCENTILE_MIN_POPULATION = 30`, `MIN_SESSIONS = 10`) are documented v1
  placeholders — tune against the real consented population once it's large enough,
  not by guess.
- **Rank-delta asymmetry** (finding #13).
- **Timezone normalization** of hour-of-day / day-of-week stats (currently
  machine-local, which skews cross-timezone comparison).
- **Badge staleness** — GitHub's Camo can serve a cached badge up to 24h despite
  the 1h `max-age`; "refreshed hourly" is best-effort.
- **Per-tool all-time breakdown** on the leaderboard. `Entry.breakdown` is 30-day
  cost only, so tool chips are hidden on the all-time board; `users.toolBreakdown`
  already stores per-tool `costAllTime` if we later want it.
- **Outcome window mismatch** — outcome-per-dollar divides a 30-day spend figure by
  a session window that can be up to ~40 days; labeled honestly now, align the
  windows in the next craft refit.
- **Sparkline boundary day** — `computeSpark` filters by millisecond `windowStart`
  while `cost30d` includes the boundary day by date-string, so the day exactly 30
  days ago can be absent from the oldest spark bucket. Cosmetic (far-left bar of a
  decorative sparkline); aligning it shifts the 3.75-day bucket math and isn't worth
  churning the bucket tests for now.

## Rollout note

Deploy **server before CLI**: a new CLI sending >30 sessions to an old server would
400, but the reverse (old CLI → new server) is safe. The CLI self-updates after the
server is live.
