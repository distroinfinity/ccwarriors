---
title: Metrics Glossary
description: Every number on the site, defined in a line or two.
---

# Metrics Glossary

**30-day burn** — your AI coding usage over the last 30 days, priced in API dollars by the server. The default board metric.

**All-time** — career total, accumulated from daily deltas since you enlisted. Drives your tier, and has its own board.

**40-day window** — how much history the CLI uploads each sync. Ten days wider than the board's 30-day ranking window, so day-boundary and timezone drift never clip your total.

**Archetype** — the working-style label derived from your dominant axis (deep mode).

**Builds with** — your real stack, inferred from the file types your agents actually edited, not GitHub's repo language labels. Top languages with shares, plus your primary models.

**Cache hit ratio** — cache reads ÷ all input-side tokens. The basis of your efficiency grade: a warm prompt cache means context is reused, not re-sent and re-billed.

**CALIBRATED** — a score badge: you have enough sessions to be meaningful, but the opted-in population is still under 30, so scores use fixed calibration anchors instead of live percentiles.

**Commits per $100** — shipped commits per $100 of spend; a verified-throughput-per-dollar signal (deep mode).

**Cost per surviving line** — spend ÷ lines of code that survived (added, minus what got reverted within two weeks). The anti-burn metric: what a dollar actually buys in lasting code (deep mode).

**Craft chip** — the small Craft Score badge shown on a leaderboard row, for warriors who opted into deep mode and made their insights public.

**Craft Score** — deep-mode composite, 0–100: six pillars (**Direction, Verification, Autonomy, Yield, Orchestration, Throughput**) combined so one weak pillar drags the total. Outcome pillars (Verification, Yield, Throughput) are measured against real git results; behavioral pillars (Direction, Autonomy, Orchestration) from how you run sessions.

**Craft tiers** — Apprentice (under 40), Journeyman (40–59), Artisan (60–79), Mastersmith (80+).

**EARLY READ** — a score badge: fewer than 10 sessions, so the score is real but not yet rank-stable, and the profile isn't in the percentile pool yet.

**Efficiency grade** — A+ to D from your cache hit ratio (A+ is roughly 95%+). Not affected by which model you use.

**GITHUB (badge)** — your public GitHub commits corroborate the same window your local-git outcomes cover.

**Org pill** — the badge on a global-board row showing verified org membership.

**Other** — the bucket for any agent ccusage reads that isn't in the named registry yet. Still counts fully in your total.

**Quarantine** — where implausible numbers go: the account stays intact but leaves every board until a human reviews it. See [Fairness](../privacy-and-trust/fairness-and-plausibility.md).

**Rank** — your position on a board (30-day, all-time, per-tool, or org-scoped). Recomputed live on every sync; ties break by all-time spend, then who synced first.

**Rhythm** — the daily-burn heatmap on your profile, with current and longest streaks.

**Session depth** — the behavioral panel: session count, share run in plan mode, active hours, session lengths, subagent spawns, and max concurrent sessions when that optional signal is available (deep mode).

**Sparkline** — the little 8-bar trend next to a leaderboard row: your real 30-day spend shape, omitted when there's no spend in the window.

**Surviving lines** — lines your agents added that weren't reverted within two weeks. The denominator behind cost-per-surviving-line and an input to the Yield and Throughput pillars.

**Tier** — the Minecraft-style ladder from all-time spend: Stone → Iron → Gold → Diamond → Netherite. (Sponsor tiers are a separate ladder, Wood → Netherite.)

**Tokens per active day** — total tokens ÷ days you actually burned, over the 30-day window.

**Trust tier / VERIFIED** — whether your Craft Score outcomes were verified against a real local git repository (uploaded as counts and salted hashes, never code).
