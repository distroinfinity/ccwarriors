# Warrior Profile Page — Design Spec

Date: 2026-06-07
Status: approved pending final user review
Branch: profile-page

## 1. Story and scope

**Pitch:** YC built paxel to show founders how they really build with AI. CCWarriors extends it to every Claude Code warrior — and gives it a public face. Your leaderboard rank says how much you fight; your profile says *how* you fight.

**Launch shape: big bang (Approach B).** One release, one X announcement, archetype card as the hero image. The CLI self-update mechanism (`packages/cli/src/selfupdate.ts`) delivers the new build fleet-wide within roughly one sync heartbeat of deploy, so capability is universal at announcement time. No data seeding of any kind; profiles missing behavioral data show a locked archetype panel that nudges unlock/update.

**Ships together in v1:**
1. CLI build with local session extraction (consent-gated)
2. Server: ingest v4 `insights` field, `user_insights` table, scoring, profile API, OG support
3. Web: public profile page at `ccwarriors.xyz/u/<login>`, linked from leaderboard rows
4. Share card export (square + 1200×675 X crop) with prefilled tweet intent

**Out of v1:** LLM deep-dive analysis tier (future opt-in, separate issue), profile bios/editing, follower mechanics, org-scoped profile variants.

**Differentiation vs competitors:** viberank profiles show generic spend stats (cost, tokens, daily chart, model breakdown). We show identity (archetype), efficiency (actionable savings), and behavior (habits) — insights a user can act on, computed deterministically in seconds where paxel needs a 15-30 minute Docker+LLM run.

## 2. Scoring framework

### 2.1 Axes

Five axes, all computed deterministically from `~/.claude/projects/**/*.jsonl` session files by counting events. No LLM, no transcript text retained.

| Axis | Measures | Raw inputs |
|---|---|---|
| Planning | think-before-strike | plan-mode turn %, explore-tool calls (Read/Grep/Glob) before first Edit/Write per session |
| Autonomy | how far agents run unsupervised | avg agent turns between user messages; interrupt/abort rate (inverted) |
| Steering | command style | prompts per session, short-prompt ratio (≤10 words), correction cadence (user messages sent immediately after interrupting/aborting an agent turn) |
| Summoning | agent orchestration | subagent (Task/Agent) spawns per session, max parallel agents, concurrent sessions |
| Velocity | raw throughput | sessions per day, edit-tool calls per session, output tokens per active day |

### 2.2 Scores

- CLI uploads raw counts/histograms only.
- Server converts axis values to 0-100 percentiles against the consented population. No hardcoded thresholds.
- Cold start: until consented population ≥ 30, axis scores use fixed calibration constants (tuned on founder data); percentile display activates automatically at the threshold.
- Recomputed on each insights ingest, in-memory (same pattern as `LeaderboardStore`).

### 2.3 Archetypes (warrior classes)

Dominant axis (top-2 combo for flavor text) maps to a class:

| Class | Dominant axis |
|---|---|
| The Tactician | Planning |
| The Berserker | Velocity |
| The Summoner | Summoning |
| The Commander | Steering |
| The Falconer | Autonomy |

Mapping is purely dominant-axis (deterministic, no ties to secondary axes); the top-2 combo only shapes flavor text (e.g. Velocity + low Planning → "strikes first, plans never").

Plus a **trait line** from rhythm data (secondary flavor, not a class): Night Stalker / Dawn Raider / Weekend Warrior / Daily Grinder.

Archetype stored on the user row when recomputed (cheap to surface elsewhere later, e.g. leaderboard tooltips).

### 2.4 Habit stats (superlatives module)

Raw numbers behind the axes, phrased as self-insight: "82% of your prompts are under 10 words", plan-mode %, max parallel agents, interrupts per 100 turns, longest session.

### 2.5 Growth edge

One rule-based line per profile. Examples: low Planning + high interrupt rate → "You correct mid-flight often; plan mode would save you ~N interrupts/week." Low cache-read ratio → cache hygiene tip. Deterministic rule table, no LLM.

## 3. CLI: extraction, consent, payload

### 3.1 Delivery

Normal build shipped via existing self-update (download → validate → atomic swap, rollback marker, `CLI_UPDATE_ENABLED` server kill switch, `CCWARRIORS_NO_UPDATE=1` user opt-out). No installer changes.

### 3.2 Consent

Extraction is **off by default for everyone**. The autosync daemon is headless, so consent is a server-side flag the CLI obeys:

- **Web (primary):** owner's profile shows locked archetype panel with "Unlock your archetype" → sets `insightsConsent` on the user row → next CLI heartbeat reads the flag (returned by `/ingest` response or `/cli/version` check) → extraction runs on that sync.
- **Terminal:** `ccwarriors insights on|off` sets/clears the flag; `on` triggers an immediate sync.
- **Revoke:** `off` (or web toggle) clears the flag and the server deletes that user's `user_insights` rows; profile panel relocks.
- `ccwarriors insights --dry-run` prints the exact payload locally without sending — transparency feature.

### 3.3 Extraction

- Source: `~/.claude/projects/**/*.jsonl` (same files paxel reads; we count events instead of LLM-summarizing).
- Per session: user-message count and word-length buckets, plan-mode turns, explore-vs-edit tool ordering, Task/subagent spawns, interrupt/abort events, session start hour (machine-local time), session duration, edit-tool call counts.
- Aggregated into one compact stats object before upload. Raw counts and histograms only.
- **Never leaves the machine:** prompt text, file paths, project names, code.
- Incremental: persist last-processed offset per file; only parse new sessions each sync. First run parses the full 40-day window.
- Runtime target: seconds, not minutes; runs inside the normal sync.

### 3.4 Payload (ingest v4, additive)

```json
{
  "insights": {
    "windowDays": 40,
    "sessions": 142,
    "promptWordHistogram": {"1-5": 310, "6-10": 220, "11-25": 90, "26+": 41},
    "planModeTurnsPct": 14.2,
    "exploreBeforeEditRatio": 0.61,
    "avgTurnsBetweenUserMsgs": 9.3,
    "interruptsPer100Turns": 6.1,
    "subagentSpawnsPerSession": 1.8,
    "maxParallelAgents": 6,
    "hourHistogram": [/* 24 buckets, session-start counts */],
    "editToolCallsPerSession": 22.4
  }
}
```

Old clients omit the field; ingest is backward compatible.

## 4. Server: storage, scoring, API

### 4.1 Schema

- New table `user_insights`: `(userId, machineId, payload JSONB, windowDays, capturedAt)`, unique on `(userId, machineId)`, updated in place per sync (mirrors `usage_days` conventions). Multi-machine merge at read time, weighted by session counts.
- `users` gains: `insightsConsent` (bool), `insightsVisibility` (`public` | `private`), `archetype` (text, nullable).

### 4.2 Derived modules from existing data

Computed from `usage_days` at request time, cacheable with ETag (consistent with the perf-audit conventions):
- **Rhythm:** daily cost/token series for contribution heatmap, current/longest streak.
- **Efficiency scorecard:** per-model mix, cache-read ratio, model-mix grade with estimated monthly savings ("62% Opus on Sonnet-shaped work; right-sizing saves ~$X/mo"), tokens per active day.

### 4.3 API

`GET /profile/:login` → single payload:
- Identity: login, avatarUrl, xHandle, tier, rank (30d + allTime), orgs, memberSince, lastSyncedAt.
- Rhythm series + efficiency scorecard (always present — derived from token data).
- `insights`: full axes/archetype/habits/growth-edge object when consented AND (`public` or requester is owner); else `{ locked: true }`.
- Owner extras (session cookie): consent state, visibility toggle, machine count.
- Unknown login → 404 with structured body; web renders enlist page.

### 4.4 Routing and OG

- Real path `/u/<login>`: Vercel rewrite `/u/* → index.html`; SPA reads `location.pathname` (no router library added).
- Profile-specific OG tags for `/u/*` with a server-generated OG card image endpoint. Fallback if image generation proves heavy in v1: brand OG image + dynamic title/description text; in-page share-card download carries the viral load.

## 5. Profile page UI

### 5.1 Layout — "The Dossier" (option A)

- **Hero left:** archetype card — avatar, login, rank, tier; archetype name (Pixelify Sans); trait line; five axis bars (Geist Mono labels, scores); growth edge line; share buttons. The hero panel IS the share card.
- **Right column:** Habits panel, Efficiency scorecard panel.
- **Full width below:** Rhythm — contribution heatmap + streaks (+ time-of-day pattern once insights exist).
- Linked from every leaderboard row.

### 5.2 Visual treatment — "Paper Dossier" (palette option 1)

- Light mode is the signature: warm book-paper background (existing `#FAFAF8` family), white card with one soft elevation shadow, hairline warm lines, terracotta `#C2683E` spent only on the archetype name and top axis bars (descending intensity by score), tier in bronze.
- Dark mode: graphite twin with the same restraint — near-black, hairline strokes, terracotta `#CC785C` confined to axis bars, metallic gradient tier text.
- Existing design language holds: Geist/Geist Mono/Pixelify Sans, vanilla CSS with existing tokens (extend, don't fork), pixel glyphs, no literal emojis, no em-dashes in UI copy, one-liner copy.

### 5.3 Share mechanics

- html-to-image export (existing machinery) in two crops: square and 1200×675.
- "Share on X" opens a prefilled tweet intent: `I'm THE SUMMONER on @ccwarriors — Summoning 96 · Steering 82. What class are you? ccwarriors.xyz/u/<login>`.

## 6. Edge cases and error handling

| Case | Behavior |
|---|---|
| Visitor on locked profile | "This warrior hasn't revealed their archetype" + enlist CTA; rhythm/efficiency modules still render |
| Owner on own locked profile | Unlock button (consent flow); "appears within the hour" copy, or `ccwarriors sync` for instant |
| Unknown login (404) | "No such warrior — enlist" page with install command |
| < ~10 sessions in window | Axes show "forging…" state; no archetype assigned |
| Consented population < 30 | Calibration-constant scores; percentile display auto-activates at threshold |
| Flagged/quarantined user | Profile renders; rank shows "—" while under review (consistent with board exclusion) |
| Client opted out of updates | Locked panel nudges manual update |
| Consent revoked | Server deletes `user_insights` rows; panel relocks |
| ingest with insights but no consent flag | Rejected (flag is source of truth; prevents stale clients pushing data post-revoke) |

## 7. Verification plan (no automated tests, per project rule)

- Dev servers with `SEED_DEMO` data; screenshot checklist: full profile, locked profile (visitor + owner views), 404, sparse-data state, light + dark, mobile + desktop.
- One real end-to-end run against founder's own `~/.claude` before deploy: CLI extraction → ingest → profile render → share card export.
- `ccwarriors insights --dry-run` payload inspection for privacy verification.
- Self-update path verified on one machine before fleet rollout (kill switch armed).

## 8. Launch

- Deploy server first, then CLI build (respect the deploy-race lesson: server must accept v4 payloads before any client can send them).
- Announce on X once founder's own profile is fully lit with real data: paxel-extension story, archetype card image, profile link.
- All other warriors' profiles show live efficiency/rhythm modules + locked archetype panel with unlock nudge — no seeded or placeholder data anywhere.
