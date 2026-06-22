---
title: Profile Pages
description: Every metric on ccwarriors.xyz/you — from spend alone, and with deep mode on.
---

# Profile Pages

Your profile lives at `ccwarriors.xyz/<your-github-login>`. Top to bottom, it's a field report: a masthead, the numbers behind you, your insight deck, your rhythm, and a way into your story.

## The masthead

The header card leads with your identity (avatar, login, rank, member-since year, all-time spend) and — once deep mode is on — your **Craft Score**: a single 0–100 number with its forge tier, your top pillar, and trust badges. Below it, "full score breakdown" expands the six pillars.

**Craft Score** is a weighted blend of six pillars, and a spiky profile is pulled down — being elite at one can't hide a weak one:

| Pillar | Weight | Measured from |
|---|---|---|
| Verification | 22% | real git results — tests in shipping sessions, how little gets reverted |
| Yield | 22% | real git results — surviving lines and commits per dollar |
| Direction | 16% | how you work — crisp specs, exploring before shipping |
| Autonomy | 16% | how you work — how long the agent runs unsupervised, counted only when the work survives |
| Orchestration | 12% | how you work — parallel subagents and model range that lead to shipped work |
| Throughput | 12% | real git results — surviving lines and commits per active day |

Forge tiers: **Apprentice** (under 40), **Journeyman** (40–59), **Artisan** (60–79), **Mastersmith** (80+).

Trust badges tell you how grounded the score is: **VERIFIED** (outcomes came from real commits on your machine, uploaded as counts and salted hashes — never code), **GITHUB** (your public GitHub activity corroborates the same window), **EARLY READ** (fewer than 10 sessions — real but not yet rank-stable), **CALIBRATED** (enough sessions to be meaningful, but the opted-in population is still too small for percentile ranking, which switches on at 30 warriors). A provenance line always states how many sessions and how many days the score is based on.

## By the numbers

A four-group panel, each with a "more" expander for the deeper cut.

**Outcomes** — the anti-burn metrics. Cost **per surviving line** of code, and your cache-efficiency grade; expand for commits per $100, what share of your context came from cache, and your model mix. Outcomes come from local-git hashes and server-priced spend over the last 30 days.

**Sessions** — how you actually work. Session count over the window and the share run **in plan mode**; expand for total active hours, average and longest session, subagent spawns per session with your peak parallel count, and max concurrent sessions when that optional signal is available.

**GitHub · verified** — your public footprint: stars and merged public PRs, with a link to your profile; expand for repos contributed to, longest streak, top languages, and account age.

**Builds with** — your real stack, inferred from the file types your agents actually edited (not GitHub's repo labels): top languages with shares, plus your primary models.

## Insight deck

A deck of shareable "wrapped"-style cards, each emitted only when there's real data behind it. A featured monthly set leads, with a "see all" expander; you can pin up to four cards to the front of your own deck.

## Rhythm

A daily-burn heatmap of the past year, plus your current and longest streaks.

## Your story

If you've unlocked it, a closer invites visitors into your [story page](deep-insights.md#your-story) — the narrative of how you work.

## What needs deep mode

From your **default sync** alone: rhythm, cache-efficiency grade and model mix, GitHub stats, your card, rank, and all-time spend. Everything outcome-, session-, stack-, and craft-related — Craft Score, archetype, session depth, cost-per-surviving-line, and the builds-with stack — comes from opting into [deep mode](deep-insights.md). It's off by default.

## You're in control

On your own profile you can unlock or disable insights, flip them public or private without deleting anything, see exactly what's stored, and purge your deep data in one click. To a visitor, "private" and "never opted in" look identical — locked is locked.
